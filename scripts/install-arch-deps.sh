#!/usr/bin/env bash
# Installs platform-specific native packages (koffi, sharp) for a TARGET
# os/cpu into node_modules, without touching package.json.
#
# Why: koffi and sharp deliver their native binaries as platform-scoped
# optional dependencies (@koromix/koffi-<os>-<cpu>, @img/sharp-<os>-<cpu>).
# npm only installs the ones matching the HOST platform, so cross-building
# (e.g. a macOS x64 DMG on an Apple Silicon machine) would otherwise ship an
# app whose native modules are missing. Versions are taken from the parent
# packages' own optionalDependencies specs, so they always match.
#
# Usage: scripts/install-arch-deps.sh <os> <cpu>   e.g. darwin x64
set -euo pipefail
cd "$(dirname "$0")/.."

os="$1"
cpu="$2"

pkgs=("@koromix/koffi-$os-$cpu" "@img/sharp-$os-$cpu")
case "$os" in
  darwin | linux) pkgs+=("@img/sharp-libvips-$os-$cpu") ;;
esac

specs=()
for pkg in "${pkgs[@]}"; do
  spec=$(node -p "((require('./node_modules/koffi/package.json').optionalDependencies ?? {})['$pkg'] ?? (require('./node_modules/sharp/package.json').optionalDependencies ?? {})['$pkg'] ?? '')")
  if [ -z "$spec" ]; then
    echo "warning: no version spec found for $pkg, skipping" >&2
    continue
  fi
  specs+=("$pkg@$spec")
done

if [ "${#specs[@]}" -eq 0 ]; then
  echo "nothing to install for $os/$cpu" >&2
  exit 1
fi

echo "Installing native deps for $os/$cpu: ${specs[*]}"
# Install into a staging prefix, then copy the package directories into
# node_modules by hand. A direct `npm install` into the project always
# recalculates the tree and prunes platform-incompatible packages — which is
# exactly what we are trying to keep.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
npm install --prefix "$stage" --no-save --no-audit --no-fund --force --ignore-scripts "${specs[@]}" >/dev/null
for pkg in "${pkgs[@]}"; do
  if [ -d "$stage/node_modules/$pkg" ]; then
    mkdir -p "node_modules/$(dirname "$pkg")"
    rm -rf "node_modules/$pkg"
    cp -R "$stage/node_modules/$pkg" "node_modules/$pkg"
    echo "installed node_modules/$pkg"
  fi
done
