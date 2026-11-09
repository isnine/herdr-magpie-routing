#!/usr/bin/env bash
set -euo pipefail

repo=isnine/herdr-magpie-routing
config="$HOME/.config/herdr-app"

command -v herdr-app >/dev/null || { echo "error: herdr-app not found" >&2; exit 1; }

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
if [ ! -f "$source_dir/mods/routing/main.js" ]; then
  source_dir="$(mktemp -d)"
  trap 'rm -rf "$source_dir"' EXIT
  git clone --quiet --depth 1 "https://github.com/$repo.git" "$source_dir"
fi

mkdir -p "$config/mods" "$config/layouts"
for mod in routing tabs-routing; do
  mkdir -p "$config/mods/$mod"
  # Herdr docks a mod it first sees without mod.json as an extra panel.
  cp "$source_dir/mods/$mod/mod.json" "$config/mods/$mod/"
  cp -R "$source_dir/mods/$mod/." "$config/mods/$mod/"
done
cp "$source_dir/layouts/main-routing.json" "$config/layouts/"

herdr-app check "$config/mods/routing"
herdr-app do layout.switch --name main-routing
echo "Installed. ctrl-shift-l switches back to your previous layout."
