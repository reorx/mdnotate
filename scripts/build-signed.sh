#!/usr/bin/env bash
# 本地一条龙：构建 + Developer ID 签名 + 公证 + staple，产出可直接拖进 /Applications 的 .app 与 .dmg。
# 凭据与 CI 同一套（见 .github/workflows/release.yml），来自 ~/Sync/apple-developer/secrets.env。
# 注意：公证要上传 Apple 服务器，通常多等 1~5 分钟。
set -euo pipefail
cd "$(dirname "$0")/.."

SECRETS="${APPLE_SECRETS_ENV:-$HOME/Sync/apple-developer/secrets.env}"
if [[ ! -f "$SECRETS" ]]; then
  echo "signing secrets 不存在: $SECRETS" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$SECRETS"
set +a

# Tauri CLI 检测到这些变量后自动完成：临时 keychain 导入证书、codesign
# （hardened runtime + timestamp）、notarytool 公证、staple。
APPLE_CERTIFICATE=$(base64 -i "$CERT_P12_PATH")
export APPLE_CERTIFICATE
export APPLE_CERTIFICATE_PASSWORD="$CERT_P12_PASSWORD"
export APPLE_API_KEY="$ASC_KEY_ID"
export APPLE_API_ISSUER="$ASC_ISSUER_ID"
export APPLE_API_KEY_PATH="$ASC_PRIVATE_KEY_PATH"

# 本机使用无需 universal，默认 host target（arm64），比 CI 快一半。
# CI=true 让 Tauri 给 bundle_dmg.sh 传 --skip-jenkins，跳过用 AppleScript 驱动
# Finder 摆 dmg 图标的装饰步骤——本地从后台 shell 跑没有 TCC 授权，这步必挂。
CI=true pnpm tauri build

# target 目录被 ~/.cargo/config.toml 的 build.target-dir 指到了机器级共享目录，
# 所以问 cargo 要真实路径，不能写死 src-tauri/target（CI 上没有那份配置，
# cargo metadata 会照样返回项目内的默认路径，两边都对）。
TARGET_DIR=$(cargo metadata --no-deps --format-version 1 --manifest-path src-tauri/Cargo.toml | jq -r .target_directory)
BUNDLE="$TARGET_DIR/release/bundle"
APP=("$BUNDLE"/macos/*.app)
DMG=("$BUNDLE"/dmg/*.dmg)

echo
echo "== 签名自查 =="
codesign -dvv "${APP[0]}" 2>&1 | grep -E 'Authority=Developer ID|runtime|Timestamp'
spctl -a -vv -t exec "${APP[0]}"

# Resources 里的 mdnotate 命令是 bundle 里第二个 Mach-O，由 scripts/build-cli.sh
# 自己签（tauri 的签名扫描不递归 Resources，只按哈希 seal）。公证要求每一个
# Mach-O 都有 Developer ID 签名，漏了它整个 dmg 会被打回。
echo
echo "== CLI 签名自查 =="
codesign -dvv "${APP[0]}/Contents/Resources/bin/mdnotate" 2>&1 |
  grep -E 'Authority=Developer ID|runtime|Timestamp'

echo
echo "app: ${APP[0]}"
echo "dmg: ${DMG[0]}"
