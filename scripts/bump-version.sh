#!/usr/bin/env bash
# 一次把四处版本号改齐：package.json / tauri.conf.json / Cargo.toml / Cargo.lock。
#
# 为什么值得有个脚本：这四处分散在两种语言的四种文件里，而漏掉任何一处的代价都不
# 对称——漏 tauri.conf.json，release workflow 会在 30 秒的校验那步失败，可那时 tag
# 已经推出去了，只能删掉重来；漏 Cargo.lock，CI 不管，但本地下次 cargo build 会自动
# 改写它，工作区凭空变脏。手工 sed 每次都得重新想一遍怎么定位（尤其 Cargo.lock 里
# mdnotate 只是几百个 package 中的一个，`version = ` 那行满地都是），不如固化下来。
#
# 用法：scripts/bump-version.sh 0.4.2
# 只改文件，不 commit、不打 tag —— 那两步是有意留给人确认的。
set -euo pipefail
cd "$(dirname "$0")/.."

NEW="${1:-}"
if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "用法: $(basename "$0") <新版本号，形如 0.4.2>" >&2
  exit 1
fi

# 每处版本号 = 文件 + 行前缀（含左引号）+ 定位行。前缀在文件里不唯一时靠定位行
# 缩小范围：Cargo.toml 认 [package] 段，Cargo.lock 认 mdnotate 自己那个 package 块。
FIELDS=(
  'package.json|  "version": "|'
  'src-tauri/tauri.conf.json|  "version": "|'
  'src-tauri/Cargo.toml|version = "|[package]'
  'src-tauri/Cargo.lock|version = "|name = "mdnotate"'
)

read_version() { # <file> <prefix> <guard>
  awk -v prefix="$2" -v guard="$3" '
    guard != "" && index($0, guard) == 1 { armed = 1 }
    (guard == "" || armed) && index($0, prefix) == 1 {
      rest = substr($0, length(prefix) + 1)
      sub(/".*/, "", rest)
      print rest
      exit
    }
  ' "$1"
}

# 只改第一处匹配，改不到就报错退出 —— 静默跳过一个文件正是这个脚本要防的事。
write_version() { # <file> <prefix> <guard> <new>
  local tmp
  tmp=$(mktemp)
  if awk -v prefix="$2" -v guard="$3" -v new="$4" '
    guard != "" && index($0, guard) == 1 { armed = 1 }
    !done && (guard == "" || armed) && index($0, prefix) == 1 {
      rest = substr($0, length(prefix) + 1)
      sub(/^[^"]*/, new, rest)
      $0 = prefix rest
      done = 1
    }
    { print }
    END { exit (done ? 0 : 1) }
  ' "$1" > "$tmp"; then
    mv "$tmp" "$1"
  else
    rm -f "$tmp"
    echo "在 $1 里找不到版本号那一行（前缀 '$2'${3:+，定位行 '$3'}）" >&2
    return 1
  fi
}

echo "bump → $NEW"
for field in "${FIELDS[@]}"; do
  IFS='|' read -r file prefix guard <<<"$field"
  old=$(read_version "$file" "$prefix" "$guard")
  if [[ -z "$old" ]]; then
    echo "读不出 $file 的当前版本号，中止" >&2
    exit 1
  fi
  write_version "$file" "$prefix" "$guard" "$NEW"
  printf '  %-28s %s → %s\n' "$file" "$old" "$NEW"
done

# 自校验：改完再读一遍，四处必须都等于 NEW。上面每一步都会失败退出，这里兜的是
# 「改到了别的行」这种 sed 类操作最典型的错法。
fail=0
for field in "${FIELDS[@]}"; do
  IFS='|' read -r file prefix guard <<<"$field"
  got=$(read_version "$file" "$prefix" "$guard")
  if [[ "$got" != "$NEW" ]]; then
    echo "校验失败: $file 读回来是 '$got'，期望 '$NEW'" >&2
    fail=1
  fi
done
[[ $fail -eq 0 ]] || exit 1

# 注意 ${NEW} 的花括号：紧跟中文标点时 bash 会把多字节字符当成变量名的一部分。
echo "四处已一致。接下来：把版本改动和功能改动放进同一个 commit，再打 tag v${NEW}"
