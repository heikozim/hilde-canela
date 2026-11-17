#!/usr/bin/env bash
#
# Part of Canela, a live Markdown editor in Hilde.
#
# SPDX-FileCopyrightText: 2026 Heiko Zimmermann
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#
# The Debian package of the Linux build: /usr/bin/canela, its desktop entry
# and icon, the libraries it needs as dependencies (GTK 4.10 or newer for the
# dialogs of GTK).  For the architecture of the machine it runs on.
#
#     bash app/linux/deb.sh <canela binary> <version> <output directory>
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ABORT: bash ${BASH_VERSION} too old" >&2; exit 9; }
set -u
command -v dpkg-deb > /dev/null 2>&1 || { echo "ABORT: no dpkg-deb -- nothing ran" >&2; exit 9; }
here=$(cd "$(dirname "$0")" && pwd)
binary=${1:?canela binary}
version=${2:?version}
out=${3:?output directory}
[ -x "$binary" ] || { echo "ABORT: $binary is no programme -- nothing ran" >&2; exit 9; }
arch=$(dpkg --print-architecture)
mkdir -p "$out" || exit 9
out=$(cd "$out" && pwd)
root="$out/canela_${version}_${arch}"
[ ! -e "$root" ] || { echo "ABORT: $root is there already" >&2; exit 9; }
install -d "$root/DEBIAN" "$root/usr/bin" "$root/usr/share/applications" "$root/usr/share/icons/hicolor/256x256/apps" "$root/usr/share/doc/canela" || exit 9
install -m 0755 "$binary" "$root/usr/bin/canela" || exit 9
install -m 0644 "$here/canela.png" "$root/usr/share/icons/hicolor/256x256/apps/canela.png" || exit 9
cat > "$root/usr/share/applications/canela.desktop" <<'D'
[Desktop Entry]
Type=Application
Name=Canela
GenericName=Markdown Editor
Comment=A live Markdown editor
Exec=canela %f
Icon=canela
Terminal=false
Categories=Office;TextEditor;
MimeType=text/markdown;text/x-markdown;text/plain;text/html;text/x-go;text/x-csrc;text/x-chdr;text/x-c++src;text/x-makefile;application/x-shellscript;text/x-perl;text/x-python;application/json;application/x-yaml;application/toml;application/xml;text/xml;text/x-diff;text/x-patch;text/csv;
D
chmod 0644 "$root/usr/share/applications/canela.desktop" || exit 9
size=$(du -sk "$root/usr" | cut -f1)
cat > "$root/DEBIAN/control" <<C
Package: canela
Version: $version
Architecture: $arch
Maintainer: Heiko Zimmermann <code@heiko-zimmermann.com>
Installed-Size: $size
Depends: libc6, libgtk-4-1 (>= 4.10), libcairo2, libglib2.0-0t64 | libglib2.0-0, libharfbuzz0b, libfreetype6, libtls28t64 | libtls28, libjxl0.11, fonts-dejavu-core
Recommends: libenchant-2-2, hunspell-de-de | hunspell-dictionary
Section: editors
Priority: optional
Homepage: https://hilde-lang.org
Description: live Markdown editor
 Canela shows Markdown as it will look while it is written: headings,
 lists, tables, formulas, diagrams and pictures in place, with exports
 to PDF, HTML, EPUB, Word, OpenDocument and LaTeX.
C
dpkg-deb --root-owner-group --build "$root" "$out/canela_${version}_${arch}.deb" > /dev/null || exit 1
dpkg-deb --info "$out/canela_${version}_${arch}.deb" | grep -E 'Package|Version|Architecture|Depends|Recommends'
echo "built $out/canela_${version}_${arch}.deb"
