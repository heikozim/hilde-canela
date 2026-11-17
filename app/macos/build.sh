#!/usr/bin/env bash
#
# Part of Canela, a live Markdown editor in Hilde.
#
# SPDX-FileCopyrightText: 2026 Heiko Zimmermann
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#
# Builds Canela.app on macOS: the window layer of Wolly, the app with the
# core of Wolly, and a bundle that carries the libraries it needs beyond
# macOS itself (HarfBuzz, FreeType and what they load), so that a user
# installs nothing.
#
#     bash app/macos/build.sh <wolly tree> <hilde tree> <output directory>
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ABORT: bash ${BASH_VERSION} too old" >&2; exit 9; }
set -u
[ "$(uname -s)" = Darwin ] || { echo "ABORT: Canela.app builds on macOS only -- nothing ran" >&2; exit 9; }
here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$here/.." && pwd)
wolly=${1:?wolly tree}
hilde=${2:?hilde tree with a built hilde}
out=${3:?output directory}
[ -x "$hilde/hilde" ] || { echo "ABORT: no $hilde/hilde -- nothing ran" >&2; exit 9; }
[ -r "$wolly/platform/macos/build.sh" ] || { echo "ABORT: $wolly has no platform/macos -- nothing ran" >&2; exit 9; }
command -v perl > /dev/null 2>&1 || { echo "ABORT: no perl -- nothing ran" >&2; exit 9; }
mkdir -p "$out" || exit 9
out=$(cd "$out" && pwd)
# The version: the one line of VERSION; the build number: the commits of
# the repository, so that it grows with every build of a newer state.
root=$(cd "$app/.." && pwd)
version=$(perl -ne 'print $1 if /^([0-9]+\.[0-9]+\.[0-9]+)$/' "$root/VERSION" 2> /dev/null)
[ -n "$version" ] || { echo "ABORT: $root/VERSION holds no version x.y.z -- nothing ran" >&2; exit 9; }
build=$(git -C "$root" rev-list --count HEAD 2> /dev/null)
[ -n "$build" ] || { echo "ABORT: no build number, $root is no git checkout -- nothing ran" >&2; exit 9; }
mkdir -p "$out/gen/Canela" || exit 9
perl -e 'my ($v, $dir) = @ARGV;
open(my $h, ">", "$dir/Version.hih") or die;
print $h "--\n-- Part of Canela, a live Markdown editor in Hilde.\n--\n-- SPDX-FileCopyrightText: 2026 Heiko Zimmermann\n-- SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception\n--\n\"\"\"\nThe version of Canela, written by app/macos/build.sh from VERSION.\n\"\"\"\nmodule Canela.Version is\n    \"\"\"\n    The version, x.y.z.\n    \"\"\"\n    function canelaVersion(): Span[Nat8, Static]\n        ensures spanLength(result) > 0;\nend module.\n";
close $h or die;
open(my $b, ">", "$dir/Version.hiq") or die;
print $b "--\n-- Part of Canela, a live Markdown editor in Hilde.\n--\n-- SPDX-FileCopyrightText: 2026 Heiko Zimmermann\n-- SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception\n--\nmodule body Canela.Version is\n    function canelaVersion(): Span[Nat8, Static] is\n        return \"$v\";\n    end;\nend module body.\n";
close $b or die;' "$version" "$out/gen/Canela" || exit 9
bash "$wolly/platform/macos/build.sh" "$out/window" || exit 1
export PKG_CONFIG_PATH="$out/window${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
pkg-config --exists wollywindow harfbuzz freetype2 || { echo "ABORT: pkg-config does not find wollywindow, harfbuzz or freetype2" >&2; exit 9; }
"$hilde/hilde" compile "$app/Canela/App.hih,$app/Canela/App.hiq" \
	--modules="$app:$out/gen:$wolly/src:$hilde/standard/src:$hilde/bindings/generated" \
	--entrypoint=Canela.App:main --output="$out/canela" || exit 1
bundle="$out/Canela.app"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Frameworks" "$bundle/Contents/Resources" || exit 9
cp "$out/canela" "$bundle/Contents/MacOS/canela" || exit 9
perl -pe "s/\@VERSION\@/$version/g; s/\@BUILD\@/$build/g" "$here/Info.plist" > "$bundle/Contents/Info.plist" || exit 9
cp "$here/Canela.icns" "$bundle/Contents/Resources/Canela.icns" || exit 9
perl "$here/bundle-dylibs.pl" "$bundle/Contents/MacOS/canela" "$bundle/Contents/Frameworks" || exit 1
codesign --force --sign - --deep "$bundle" > /dev/null 2>&1 || { echo "ABORT: codesign failed" >&2; exit 1; }
echo "built $bundle $version ($build)"
