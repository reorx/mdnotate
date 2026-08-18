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
# 临时 keychain 与临时 p12 都不留下——密钥材料不该在磁盘上活过这次构建。
cleanup() {
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

# 用指纹而不是证书名字：同一台机器上可能装着多张 Developer ID 证书，名字会撞。
IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN" |
  awk '/Developer ID Application/ { print $2; exit }')
if [[ -z "$IDENTITY" ]]; then
  echo "build-cli: 导入的证书里没有 Developer ID Application 身份" >&2
  security find-identity -v -p codesigning "$KEYCHAIN" >&2
  exit 1
fi

# security 认得不带 -db 后缀的名字，codesign 不一定，所以给它落在盘上的那个。
KEYCHAIN_FILE="$KEYCHAIN"
[[ -f "$KEYCHAIN-db" ]] && KEYCHAIN_FILE="$KEYCHAIN-db"

codesign --force --keychain "$KEYCHAIN_FILE" --sign "$IDENTITY" \
  --options runtime --timestamp "$OUT"
codesign --verify --strict "$OUT"
echo "build-cli: 已签名 $OUT"
codesign -dvv "$OUT" 2>&1 | grep -E 'Authority=Developer ID|runtime|Timestamp' || true
