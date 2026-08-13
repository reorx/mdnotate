#!/usr/bin/env bash
# 发版前的现实核对：一屏看清版本文件、本地 tag、origin 上的 tag、已发布的 release、
# 以及每个 tag 的 workflow 结论。
#
# 为什么需要它：这五者可以互相对不上，而最坑的一种是「tag 推了但 workflow 挂了」——
# 它没有 release，可 tag 还占着那个版本号。只看 `gh release list` 会以为那个号还空着，
# 于是定出一个比它小的新版本号，发出去看着像倒退。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 版本文件"
pkg=$(jq -r .version package.json)
conf=$(jq -r .version src-tauri/tauri.conf.json)
cargo=$(awk '/^\[package\]/{a=1} a && /^version = "/{gsub(/version = "|"/, ""); print; exit}' src-tauri/Cargo.toml)
lock=$(awk '/^name = "mdnotate"$/{a=1} a && /^version = "/{gsub(/version = "|"/, ""); print; exit}' src-tauri/Cargo.lock)
printf '  %-28s %s\n' package.json "$pkg" src-tauri/tauri.conf.json "$conf" \
  src-tauri/Cargo.toml "$cargo" src-tauri/Cargo.lock "$lock"
if [[ "$pkg" == "$conf" && "$conf" == "$cargo" && "$cargo" == "$lock" ]]; then
  echo "  → 一致：$pkg"
else
  echo "  → 不一致，发版前先跑 scripts/bump-version.sh 拉齐" >&2
fi

echo
echo "== tag（新版本号必须大于最高的那个，哪怕它没发成）"

remote_tags=$(git ls-remote --tags origin 2>/dev/null | sed 's#.*refs/tags/##; s#\^{}$##' | sort -u || true)
releases=$(gh release list --limit 30 --json tagName -q '.[].tagName' 2>/dev/null || true)
[[ -n "$releases" ]] || echo "  (gh 读不到 release 列表，release 一列不可信)" >&2

dead=()
for tag in $(git tag --sort=-v:refname | head -6); do
  on_remote=$(grep -qx "$tag" <<<"$remote_tags" && echo "origin ✓" || echo "仅本地 ")
  has_rel=$(grep -qx "$tag" <<<"$releases" && echo "release ✓" || echo "无 release")
  run=$(gh run list --branch "$tag" --limit 1 --json conclusion -q '.[0].conclusion // "无 run"' 2>/dev/null || echo "?")
  printf '  %-10s %-9s %-11s workflow %s\n' "$tag" "$on_remote" "$has_rel" "$run"
  [[ "$has_rel" == "无 release" ]] && dead+=("$tag")
done

highest=$(git tag --sort=-v:refname | head -1)
echo
echo "最高 tag：${highest:-（还没有）}"
if [[ ${#dead[@]} -gt 0 ]]; then
  echo "没有对应 release 的死 tag：${dead[*]}"
  echo "  发布失败留下的，占着版本号但没产物。确认不再需要后："
  for tag in "${dead[@]}"; do
    echo "    git push --delete origin $tag && git tag -d $tag"
  done
fi
