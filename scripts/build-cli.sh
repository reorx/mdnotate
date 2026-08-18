#!/usr/bin/env bash
# 构建 `mdnotate` 命令行二进制，放到 src-tauri/resources/bin/mdnotate，
# 由 tauri.conf.json 的 bundle.resources 收进 .app 的 Contents/Resources/bin/。
# 由 beforeBundleCommand 自动调用（cargo 编译完、收 resources 之前），也可以单独跑。
#
# 为什么不用 externalBin：那条路要为每个架构编一份再 lipo，还得赌 tauri#11992
# （sidecar + 公证 → "The signature of the binary is invalid"）已经修好。Resources
# 这条路里 tauri 只按哈希 seal、绝不重签（bundler 的签名扫描只覆盖 Contents 下的
# MacOS/Frameworks/Plugins/Helpers/XPCServices/Libraries，不递归 Resources），
# 所以这里先签好放进去，外层非 deep 签名不会破坏嵌入签名。
#
# 环境变量：
#   MDNOTATE_CLI_TARGETS  逗号分隔的 rust target triple；给了多个就 lipo 成
#                         universal。缺省只编宿主架构。
#   APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD
#                         有就签（Developer ID + hardened runtime + timestamp），
#                         没有就跳过——本地 `pnpm tauri build` 的 ad-hoc 产物本来
#                         就只能原地运行。变量名与 tauri CLI 一致，所以
#                         build-signed.sh 和 release workflow 不用额外传参。
#
# 幂等：重复跑就是重新编译、重新覆盖、重新签名。beforeBundleCommand 在
# universal target 下跑几次没有明说，所以不能假设只跑一次。
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST=src-tauri/Cargo.toml
OUT=src-tauri/resources/bin/mdnotate

command -v jq >/dev/null || {
  echo "build-cli.sh 需要 jq（读 cargo metadata 的 target_directory）" >&2
  exit 1
}

# target 目录可能被 ~/.cargo/config.toml 的 build.target-dir 指到机器级共享目录，
# 所以问 cargo 要，不能写死 src-tauri/target（CI 上没有那份配置，cargo metadata
# 会照样返回项目内的默认路径，两边都对）。
TARGET_DIR=$(cargo metadata --no-deps --format-version 1 --manifest-path "$MANIFEST" | jq -r .target_directory)

built=()
if [[ -z "${MDNOTATE_CLI_TARGETS:-}" ]]; then
  cargo build --release -p mdnotate-cli --manifest-path "$MANIFEST"
  built=("$TARGET_DIR/release/mdnotate-cli")
else
  IFS=',' read -r -a triples <<<"$MDNOTATE_CLI_TARGETS"
  for triple in "${triples[@]}"; do
    cargo build --release -p mdnotate-cli --manifest-path "$MANIFEST" --target "$triple"
    built+=("$TARGET_DIR/$triple/release/mdnotate-cli")
  done
fi

mkdir -p "$(dirname "$OUT")"
# 先删再写：签过名的旧文件被 mmap 着时原地覆盖会失败，而且 lipo 不会覆盖已存在的输出。
rm -f "$OUT"
if [[ ${#built[@]} -gt 1 ]]; then
  lipo -create -output "$OUT" "${built[@]}"
  echo "build-cli: lipo → $OUT (${#built[@]} 个架构)"
else
  cp "${built[0]}" "$OUT"
  echo "build-cli: $OUT"
fi
chmod +x "$OUT"

# --- 签名 ---------------------------------------------------------------------
#
# 公证要求 bundle 里每一个 Mach-O 都有 Developer ID 签名 + hardened runtime +
# timestamp，不分目录。tauri 不会碰 Resources 里的这个，所以自己签。

if [[ -z "${APPLE_CERTIFICATE:-}" || -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
  echo "build-cli: 没有签名凭据，跳过签名"
  exit 0
fi

WORK=$(mktemp -d)
KEYCHAIN="$WORK/mdnotate-cli.keychain"
KEYCHAIN_PASSWORD=$(uuidgen)

# 本机原有的搜索列表，等下要原样放回去（下面那段说明为什么非动它不可）。
# 读不出来就一个都不动：把搜索列表设成空的，代价是本机所有钥匙串访问都瞎掉。
ORIGINAL_KEYCHAINS=()
while IFS= read -r line; do
  # `list-keychains` 每行是缩进 + 带引号的路径。
  line=$(sed -e 's/^[[:space:]]*//' -e 's/^"//' -e 's/"$//' <<<"$line")
  [[ -n "$line" ]] && ORIGINAL_KEYCHAINS+=("$line")
done < <(security list-keychains -d user)
if [[ ${#ORIGINAL_KEYCHAINS[@]} -eq 0 ]]; then
  echo "build-cli: 读不出 keychain 搜索列表，不敢改它" >&2
  exit 1
fi

# 临时 keychain 与临时 p12 都不留下——密钥材料不该在磁盘上活过这次构建。
cleanup() {
  if [[ ${#ORIGINAL_KEYCHAINS[@]} -gt 0 ]]; then
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
  fi
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

printf '%s' "$APPLE_CERTIFICATE" | base64 --decode >"$WORK/cert.p12"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
# 默认 5 分钟无操作自动上锁；一次 universal 构建可能比这久。
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -f pkcs12 >/dev/null
# 这一步不做的话，codesign 取私钥时会弹「允许访问钥匙串」的对话框，
# 在 CI 上就是无限期挂起。
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# ⚠️ **`codesign --keychain` 不管用**，别拿它当隔离手段：codesign 认的是搜索列表，
# `--keychain` 顶多算个提示。实测在一台 login keychain 里本来就有这张证书的机器上，
# 把 --keychain 指向一个空钥匙串照样签得出来——也就是说本地"通过"完全可能是碰巧走了
# login keychain，而 CI 上没有那份，就只剩一句 `error: The specified item could not be
# found in the keychain.`（v0.7.0 第一次发版就是这么挂的）。所以必须真的把临时钥匙串
# 放进搜索列表，签完再放回去。tauri 自己签 app 时做的也是这件事。
security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" "$KEYCHAIN" >/dev/null

# 用指纹而不是证书名字：同一台机器上可能装着多张 Developer ID 证书，名字会撞。
IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN" |
  awk '/Developer ID Application/ { print $2; exit }')
if [[ -z "$IDENTITY" ]]; then
  echo "build-cli: 导入的证书里没有 Developer ID Application 身份" >&2
  security find-identity -v -p codesigning "$KEYCHAIN" >&2
  exit 1
fi

# 上面那条坑的前置断言：codesign 待会儿是**从搜索列表**里找这个指纹的，所以现在就用
# 搜索列表（不带 keychain 参数）问一遍。问不到就说清楚是搜索列表的问题，而不是把
# codesign 那句没头没尾的报错扔给下一个人。
if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  echo "build-cli: 证书导进来了，但搜索列表里看不到它——codesign 会找不到" >&2
  security list-keychains -d user >&2
  exit 1
fi

codesign --force --sign "$IDENTITY" --options runtime --timestamp "$OUT"
codesign --verify --strict "$OUT"
echo "build-cli: 已签名 $OUT"
codesign -dvv "$OUT" 2>&1 | grep -E 'Authority=Developer ID|runtime|Timestamp' || true
