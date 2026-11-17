#!/usr/bin/env bash
#
# Part of Canela, a live Markdown editor in Hilde.
#
# SPDX-FileCopyrightText: 2026 Heiko Zimmermann
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#
# Builds Canela on Linux with GTK 4: the window layer of Wolly
# (platform/linux), then the app with the core of Wolly.
#
#     bash app/linux/build.sh <wolly tree> <hilde tree or /opt/hilde> <output directory> [version]
#
# The hilde tree holds standard/src and bindings/generated; the compiler is
# the hilde of the PATH.  The version is the one of VERSION, or the fourth
# argument where there is no checkout.
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ABORT: bash ${BASH_VERSION} too old" >&2; exit 9; }
set -u
[ "$(uname -s)" = Linux ] || { echo "ABORT: this build is for Linux -- nothing ran" >&2; exit 9; }
command -v hilde > /dev/null 2>&1 || { echo "ABORT: no hilde in the PATH -- nothing ran" >&2; exit 9; }
command -v perl > /dev/null 2>&1 || { echo "ABORT: no perl -- nothing ran" >&2; exit 9; }
here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$here/.." && pwd)
wolly=${1:?wolly tree}
hilde=${2:?hilde tree}
out=${3:?output directory}
[ -r "$wolly/platform/linux/build.sh" ] || { echo "ABORT: $wolly has no platform/linux -- nothing ran" >&2; exit 9; }
[ -d "$hilde/standard/src" ] || { echo "ABORT: $hilde has no standard/src -- nothing ran" >&2; exit 9; }
mkdir -p "$out" || exit 9
out=$(cd "$out" && pwd)
root=$(cd "$app/.." && pwd)
version=$(perl -ne 'print $1 if /^([0-9]+\.[0-9]+\.[0-9]+)$/' "$root/VERSION" 2> /dev/null)
[ -n "${4:-}" ] && version=$4
[ -n "$version" ] || { echo "ABORT: no version x.y.z -- nothing ran" >&2; exit 9; }
mkdir -p "$out/gen/Canela" || exit 9
perl -e 'my ($v, $dir) = @ARGV;
open(my $h, ">", "$dir/Version.hih") or die;
print $h "--\n-- Part of Canela, a live Markdown editor in Hilde.\n--\n-- SPDX-FileCopyrightText: 2026 Heiko Zimmermann\n-- SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception\n--\n\"\"\"\nThe version of Canela, written by app/linux/build.sh from VERSION.\n\"\"\"\nmodule Canela.Version is\n    \"\"\"\n    The version, x.y.z.\n    \"\"\"\n    function canelaVersion(): Span[Nat8, Static]\n        ensures spanLength(result) > 0;\nend module.\n";
close $h or die;
open(my $b, ">", "$dir/Version.hiq") or die;
print $b "--\n-- Part of Canela, a live Markdown editor in Hilde.\n--\n-- SPDX-FileCopyrightText: 2026 Heiko Zimmermann\n-- SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception\n--\nmodule body Canela.Version is\n    function canelaVersion(): Span[Nat8, Static] is\n        return \"$v\";\n    end;\nend module body.\n";
close $b or die;' "$version" "$out/gen/Canela" || exit 9
bash "$wolly/platform/linux/build.sh" "$out/window" || exit 1
export PKG_CONFIG_PATH="$out/window${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
pkg-config --exists wollywindow harfbuzz freetype2 || { echo "ABORT: pkg-config does not find wollywindow, harfbuzz or freetype2" >&2; exit 9; }
hilde compile "$app/Canela/App.hih,$app/Canela/App.hiq" \
	--modules="$app:$out/gen:$wolly/src:$hilde/standard/src:$hilde/bindings/generated" \
	--entrypoint=Canela.App:main --output="$out/canela" || exit 1
echo "built $out/canela $version"
