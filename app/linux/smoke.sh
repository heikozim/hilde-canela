#!/usr/bin/env bash
#
# Part of Canela, a live Markdown editor in Hilde.
#
# SPDX-FileCopyrightText: 2026 Heiko Zimmermann
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#
# The smoke runs of Canela on Linux under Xvfb, each with a HOME of its own:
# the window drawn, the grammar panel and a replacement put in, the Table
# menu, a picture dropped into bilder/, and the exports to PDF, Word and
# OpenDocument.  One line each, then the count of green ones.
#
#     bash app/linux/smoke.sh <canela binary> <work directory>
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ABORT: bash ${BASH_VERSION} too old" >&2; exit 9; }
set -u
B=${1:?canela binary}
D=${2:?work directory}
[ -x "$B" ] || { echo "ABORT: $B is no programme -- nothing ran" >&2; exit 9; }
for tool in xvfb-run unzip; do
	command -v "$tool" > /dev/null 2>&1 || { echo "ABORT: no $tool -- nothing ran" >&2; exit 9; }
done
rm -rf "$D"
mkdir -p "$D/home"
export HOME="$D/home"
export GTK_A11Y=none
canela() {
	timeout 40 xvfb-run -a -s "-screen 0 1280x900x24" "$B" "$@"
}
good=0
total=0
report() {
	total=$((total + 1))
	if [ "$2" = ok ]; then
		good=$((good + 1))
		echo "$1: ok"
	else
		echo "$1: FAILED $3"
	fi
}

# The window drawn: a picture of the size of the window, its title.
printf '# Canela auf Linux\n\nText mit **fett**.\n' > "$D/doc.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/doc.png" canela "$D/doc.md" > "$D/doc.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && [ -s "$D/doc.png" ] && grep -q 'smoke title: doc.md' "$D/doc.err"; then report picture ok; else report picture no "rc=$rc"; fi

# The grammar panel from an answer handed in, Return puts the replacement in.
printf 'Das ist ein ein Test.\n' > "$D/grammar.md"
answer='{"matches":[{"message":"doppelt","replacements":[{"value":"ein"}],"offset":8,"length":7,"rule":{"id":"R"}}]}'
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE_GRAMMAR="$answer" WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=139 WOLLY_WINDOW_SMOKE_RETURN=1 canela "$D/grammar.md" > "$D/grammar.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && [ "$(cat "$D/grammar.md")" = "Das ist ein Test." ]; then report grammar ok; else report grammar no "rc=$rc text=$(cat "$D/grammar.md")"; fi

# The Table menu: a row below the header.
printf '| A | B |\n|---|---|\n| 1 | 2 |\n' > "$D/table.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=142 canela "$D/table.md" > "$D/table.err" 2>&1
rc=$?
want=$(printf '| A | B |\n|---|---|\n|   |   |\n| 1 | 2 |')
if [ "$rc" = 0 ] && [ "$(cat "$D/table.md")" = "$want" ]; then report table ok; else report table no "rc=$rc"; fi

# A picture dropped: copied into bilder/ and put into the text.
# The picture comes from outside the folder of the document, so that it is
# copied; a picture below that folder keeps its place.  The temporary folder
# is meant for a throwaway container and goes with it.
O=$(mktemp -d)
cp "$D/doc.png" "$O/bild.png"
printf '# Bild\n\nText.\n' > "$D/drop.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_DROP="$O/bild.png" canela "$D/drop.md" > "$D/drop.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && cmp -s "$O/bild.png" "$D/bilder/bild.png" && grep -q '](bilder/bild.png)' "$D/drop.md"; then report drop ok; else report drop no "rc=$rc"; fi

# A JPEG XL picture of 200 by 100 red pixels (testdata/rot.jxl, cjxl
# lossless) drawn in the window: its red pixels counted by ImageMagick, at
# least 20000 (200 by 100 at scale 1); a document without it shows none.
here=$(cd "$(dirname "$0")" && pwd)
cp "$here/testdata/rot.jxl" "$D/rot.jxl"
printf '# JXL\n\n![rot](rot.jxl)\n' > "$D/jxl.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/jxl.png" canela "$D/jxl.md" > "$D/jxl.err" 2>&1
rc=$?
red=$(convert "$D/jxl.png" -alpha off -fill black +opaque '#ff0000' -fill white -opaque '#ff0000' -format '%[fx:round(mean*w*h)]' info: 2> /dev/null)
none=$(convert "$D/doc.png" -alpha off -fill black +opaque '#ff0000' -fill white -opaque '#ff0000' -format '%[fx:round(mean*w*h)]' info: 2> /dev/null)
if [ "$rc" = 0 ] && [ "${red:-0}" -ge 20000 ] && [ "${none:-1}" = 0 ]; then report "jxl ($red red)" ok; else report jxl no "rc=$rc red=${red:-?} none=${none:-?}"; fi

# Printing: File > Print of a document of two pages; a smoke run shows no
# dialog and names the pages of the PDF it would print.
printf -- '# Erste Seite\n\nText.\n\n\\newpage\n\n# Zweite Seite\n\nMehr.\n' > "$D/print.md"
WOLLY_WINDOW_SMOKE=command WOLLY_WINDOW_SMOKE_COMMAND=135 canela "$D/print.md" > "$D/print.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && grep -q 'wolly-window print: 2 pages' "$D/print.err"; then report print ok; else report print no "rc=$rc $(grep print "$D/print.err" | head -1)"; fi

# The screen reader: the drawing area is a text box whose text and caret
# GtkAccessibleText gives, read through that interface.
printf '# Titel\n\nÄpfel und Birnen.\n' > "$D/a11y.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_ACCESSIBLE=1 canela "$D/a11y.md" > "$D/a11y.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && grep -q 'smoke accessible: text box, 27 characters, caret 0' "$D/a11y.err" && grep -q 'accessible text: # Titel' "$D/a11y.err"; then report a11y ok; else report a11y no "rc=$rc $(grep accessible "$D/a11y.err" | head -1)"; fi

# The spelling through enchant: a German document with one wrong word, the
# words the checker found named by the smoke run.  Without libenchant-2 and a
# German dictionary here it is not run and said so, not counted as green.
notrun=0
if ls /usr/lib/*/libenchant-2.so.2 /usr/lib/libenchant-2.so.2 2> /dev/null | grep -q . && [ -r /usr/share/hunspell/de_DE.dic ]; then
	printf -- '---\nlang: de\n---\n\nDas ist ein Fehlr im Text und ein Haus.\n' > "$D/spell.md"
	WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_TICKS=3 canela "$D/spell.md" > "$D/spell.err" 2>&1
	rc=$?
	found=$(grep '^wolly-window spelling de' "$D/spell.err" | tail -1)
	if [ "$rc" = 0 ] && [[ "$found" == *" Fehlr "* ]] && [[ "$found" != *" Haus "* ]] && [[ "$found" != *" Text "* ]]; then report "spelling ($found)" ok; else report spelling no "rc=$rc $(grep spelling "$D/spell.err" | head -1)"; fi
else
	notrun=1
	echo "spelling: NOT RUN, no libenchant-2.so.2 with de_DE here"
fi

# Plain text: a script with CR LF line ends and the executable bit comes
# back byte for byte with the typed letter and its bit; a heading command
# changes nothing in a .txt (and changes the same text as .md: the
# control); mixed line ends are not written.
printf '#!/bin/sh\r\necho a\r\n' > "$D/script.sh"
chmod 755 "$D/script.sh"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_TEXT=x canela "$D/script.sh" > "$D/plain.err" 2>&1
rc1=$?
printf -- '- a\n' > "$D/list.txt"
printf -- '- a\n' > "$D/list.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=5 WOLLY_WINDOW_SMOKE_TEXT=y canela "$D/list.txt" >> "$D/plain.err" 2>&1
rc2=$?
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=5 WOLLY_WINDOW_SMOKE_TEXT=y canela "$D/list.md" >> "$D/plain.err" 2>&1
rc3=$?
printf 'a\r\nb\n' > "$D/mixed.txt"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_TEXT=q canela "$D/mixed.txt" >> "$D/plain.err" 2>&1
rc4=$?
printf 'x#!/bin/sh\r\necho a\r\n' > "$D/script.want"
printf 'y- a\n' > "$D/list.want"
printf 'a\r\nb\n' > "$D/mixed.want"
if [ "$rc1$rc2$rc3$rc4" = 0000 ] && cmp -s "$D/script.sh" "$D/script.want" && [ "$(stat -c %a "$D/script.sh")" = 755 ] \
	&& cmp -s "$D/list.txt" "$D/list.want" && ! cmp -s "$D/list.md" "$D/list.want" && cmp -s "$D/mixed.txt" "$D/mixed.want"; then
	report plain ok
else
	report plain no "rc=$rc1$rc2$rc3$rc4 mode=$(stat -c %a "$D/script.sh") $(od -c "$D/script.sh" | head -1)"
fi

# Codes: a ```bunti and a ```qr block drawn as pictures (many more black
# pixels than the same text as ```text, the control), and written as PNG
# beside an HTML export, named relative to the page.
printf '# Codes\n\n```bunti\nHallo BUNTI\n```\n\n```qr\nhttps://example.org\n```\n' > "$D/codes.md"
printf '# Codes\n\n```text\nHallo BUNTI\n```\n\n```text\nhttps://example.org\n```\n' > "$D/nocodes.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/codes.png" canela "$D/codes.md" > "$D/codes.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/nocodes.png" canela "$D/nocodes.md" >> "$D/codes.err" 2>&1
rc2=$?
WOLLY_WINDOW_CHOOSE="$D/page.html" WOLLY_WINDOW_SMOKE=command WOLLY_WINDOW_SMOKE_COMMAND=120 canela "$D/codes.md" >> "$D/codes.err" 2>&1
rc3=$?
black=$(convert "$D/codes.png" -alpha off -fill white +opaque '#000000' -fill black -opaque '#000000' -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null)
plainblack=$(convert "$D/nocodes.png" -alpha off -fill white +opaque '#000000' -fill black -opaque '#000000' -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null)
if [ "$rc1$rc2$rc3" = 000 ] && [ "${black:-0}" -ge $(( ${plainblack:-0} + 5000 )) ] && [ -s "$D/page-code-0.png" ] && [ -s "$D/page-code-1.png" ] && grep -q 'src="page-code-1.png"' "$D/page.html"; then
	report "codes ($black black against $plainblack)" ok
else
	report codes no "rc=$rc1$rc2$rc3 black=${black:-?}/${plainblack:-?}"
fi

# The prompt of Edit > Grammar Server (140) with a value longer than its
# field: text inside the field, nothing right of the frame (x 600 to 880, left of the badge of the mode),
# where the old panel drew the value on.
long='https://languagetool.example.org/v2/check/with/a/very/long/path/that/does/not/fit/the/field/at/all/1234567890'
printf '# Text\n' > "$D/prompt.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_SETTING_TEXT="grammarserver=$long" WOLLY_WINDOW_SMOKE_COMMANDS=140 WOLLY_WINDOW_SMOKE_IMAGE="$D/prompt.png" canela "$D/prompt.md" > "$D/prompt.err" 2>&1
rc=$?
dark() { convert "$D/prompt.png" -crop "$1" +repage -colorspace Gray -threshold 50% -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null; }
inside=$(dark 580x70+20+40)
outside=$(dark 280x140+600+0)
if [ "$rc" = 0 ] && [ "${inside:-0}" -ge 200 ] && [ "${outside:-1}" = 0 ]; then report "prompt ($inside inside, $outside outside)" ok; else report prompt no "rc=$rc inside=${inside:-?} outside=${outside:-?}"; fi

# The reading mode (162): typing and Return change nothing, the title says
# so; the control without it: typing changes the file.
printf '# Changelog\n\nText.\n' > "$D/ro.md"
cp "$D/ro.md" "$D/ro.want"
cp "$D/ro.md" "$D/rw.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=162 WOLLY_WINDOW_SMOKE_TEXT=x WOLLY_WINDOW_SMOKE_RETURN=1 canela "$D/ro.md" > "$D/ro.err" 2>&1
rc1=$?
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_TEXT=x canela "$D/rw.md" > "$D/rw.err" 2>&1
rc2=$?
if [ "$rc1$rc2" = 00 ] && cmp -s "$D/ro.md" "$D/ro.want" && ! cmp -s "$D/rw.md" "$D/ro.want" && grep -q -E 'smoke title: ro.md \((Lesemodus|reading)\)' "$D/ro.err"; then
	report reading ok
else
	report reading no "rc=$rc1$rc2 $(grep title "$D/ro.err" | head -1)"
fi

# A new tab (129) closed with Close (32): the question is asked, yes closes
# it (the title is the first document again), no keeps it (the control).
printf '# Erstes\n' > "$D/eins.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS="129 32" WOLLY_WINDOW_CONFIRM=yes canela "$D/eins.md" > "$D/tabyes.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS="129 32" WOLLY_WINDOW_CONFIRM=no canela "$D/eins.md" > "$D/tabno.err" 2>&1
rc2=$?
if [ "$rc1$rc2" = 00 ] && grep -q 'wolly-window confirm:' "$D/tabyes.err" && grep -q 'smoke title: eins.md$' "$D/tabyes.err" && grep -q -E 'smoke title: (Unbenannt|Untitled)' "$D/tabno.err"; then
	report tabclose ok
else
	report tabclose no "rc=$rc1$rc2 $(grep -h -E 'confirm|title' "$D/tabyes.err" "$D/tabno.err" | tr '\n' ' ')"
fi

# Line numbers: a plain text file shows them in the gutter at the left
# (dark pixels there), the command 163 switches them off (the control).
printf 'eins\nzwei\ndrei\n' > "$D/num.txt"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/num.png" canela "$D/num.txt" > "$D/num.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=163 WOLLY_WINDOW_SMOKE_IMAGE="$D/numoff.png" canela "$D/num.txt" > "$D/numoff.err" 2>&1
rc2=$?
gutter() { convert "$1" -crop 40x120+0+0 +repage -colorspace Gray -threshold 80% -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null; }
on=$(gutter "$D/num.png")
off=$(gutter "$D/numoff.png")
if [ "$rc1$rc2" = 00 ] && [ "${on:-0}" -ge 30 ] && [ "${off:-1}" -lt "${on:-0}" ]; then report "numbers ($on against $off)" ok; else report numbers no "rc=$rc1$rc2 on=${on:-?} off=${off:-?}"; fi

# MIRCO cells (164) without MIRCO in the image: the notice says so and the
# document stays byte for byte as it was.
printf '# Rechnen\n\n```mirco\nmodule body Zelle.A is\nend module body.\n```\n' > "$D/zellen.md"
cp "$D/zellen.md" "$D/zellen.want"
WOLLY_WINDOW_SMOKE=command WOLLY_WINDOW_SMOKE_COMMAND=164 canela "$D/zellen.md" > "$D/zellen.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && grep -q -E 'notice: MIRCO (nicht gefunden|not found)' "$D/zellen.err" && cmp -s "$D/zellen.md" "$D/zellen.want"; then report "mirco (none here)" ok; else report mirco no "rc=$rc $(grep notice "$D/zellen.err" | head -1)"; fi

# SVG text: an SVG with the word MMM in black draws it (dark pixels in the
# region of the picture); the same SVG without its text element is the
# control.
printf '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect x="0" y="0" width="400" height="200" fill="#ffffff"/><text x="200" y="130" font-size="80" text-anchor="middle" fill="#000000">MMM</text></svg>\n' > "$D/text.svg"
printf '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect x="0" y="0" width="400" height="200" fill="#ffffff"/></svg>\n' > "$D/notext.svg"
printf '![T](text.svg)\n' > "$D/svgtext.md"
printf '![T](notext.svg)\n' > "$D/svgnotext.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/svgtext.png" canela "$D/svgtext.md" > "$D/svgtext.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/svgnotext.png" canela "$D/svgnotext.md" > "$D/svgnotext.err" 2>&1
rc2=$?
inked() { convert "$1" -crop 500x260+60+0 +repage -colorspace Gray -threshold 30% -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null; }
with=$(inked "$D/svgtext.png")
without=$(inked "$D/svgnotext.png")
if [ "$rc1$rc2" = 00 ] && [ "${with:-0}" -ge $(( ${without:-0} + 1000 )) ]; then report "svgtext ($with against $without)" ok; else report svgtext no "rc=$rc1$rc2 with=${with:-?} without=${without:-?}"; fi

# References: @fig:a and [@hooke1678] with a figure and a bibliography are
# drawn as "Abb. 1" and "(Hooke 1678)" in the colour of a link; the same
# words written plainly are the control.
printf '@book{hooke1678,\n  author = {Hooke, Robert},\n  title = {De Potentia Restitutiva},\n  year = {1678}\n}\n' > "$D/lit.bib"
printf '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect x="0" y="0" width="40" height="20" fill="#ff0000"/></svg>\n' > "$D/a.svg"
printf -- '---\nlang: de\nbibliography: lit.bib\n---\n\nText.\n\nSiehe @fig:a und [@hooke1678] hier.\n\n![Bild](a.svg){#fig:a}\n' > "$D/refs.md"
printf -- '---\nlang: de\nbibliography: lit.bib\n---\n\nText.\n\nSiehe Abb. 1 und (Hooke 1678) hier.\n\n![Bild](a.svg)\n' > "$D/norefs.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/refs.png" canela "$D/refs.md" > "$D/refs.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/norefs.png" canela "$D/norefs.md" > "$D/norefs.err" 2>&1
rc2=$?
linked() { convert "$1" -alpha off -fuzz 12% -fill "#ff00ff" -opaque "#2266cc" -fuzz 0 -fill white +opaque "#ff00ff" -fill black -opaque "#ff00ff" -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null; }
blue=$(linked "$D/refs.png")
plain=$(linked "$D/norefs.png")
if [ "$rc1$rc2" = 00 ] && [ "${blue:-0}" -ge 100 ] && [ "${plain:-1}" = 0 ]; then report "refs ($blue against $plain)" ok; else report refs no "rc=$rc1$rc2 blue=${blue:-?} plain=${plain:-?}"; fi

# The pixels of a picture read by perl from a PPM: tinted counts those whose
# brightest and darkest channel are 60 or more apart, in the 900x400 at the
# top left; gridrows counts rows with a run of 100 or more pixels of the grey
# of the lines of a table, #cccccc (antialiased text hits that grey in single
# pixels, never in such a run); a colour rrggbb counts its pixels exactly.
pixels() {
	convert "$1" -alpha off -depth 8 ppm:- 2> /dev/null | perl -e '
		binmode STDIN; local $/; my $d = <STDIN>;
		$d =~ s/\AP6\s+(\d+)\s+(\d+)\s+255\s//s or exit 1;
		my ($w, $h) = ($1, $2); my $mode = $ARGV[0]; my $n = 0;
		for my $y (0 .. $h - 1) {
			my $run = 0; my $best = 0;
			for my $x (0 .. $w - 1) {
				my ($r, $g, $b) = unpack("C3", substr($d, ($y * $w + $x) * 3, 3));
				if ($mode =~ /^[0-9a-f]{6}$/) {
					$n++ if sprintf("%02x%02x%02x", $r, $g, $b) eq $mode;
				} elsif ($mode eq "tinted") {
					next if $x >= 900 || $y >= 400;
					my ($hi) = sort { $b <=> $a } ($r, $g, $b);
					my ($lo) = sort { $a <=> $b } ($r, $g, $b);
					$n++ if $hi - $lo >= 60;
				} else {
					if ($r == 204 && $g == 204 && $b == 204) { $run++; $best = $run if $run > $best } else { $run = 0 }
				}
			}
			$n++ if $mode eq "gridrows" && $best >= 100;
		}
		print $n;
	' "$2"
}

# Syntax: a shell file is drawn in the colours of its language (pixels whose
# brightest and darkest channel are 60 or more apart); the same text as .txt
# and the shell file with the colours switched off (165) are the controls.
printf '#!/bin/sh\n# a comment\nif [ -n "$HOME" ]; then\n    echo "home" 42\nfi\n' > "$D/colours.sh"
cp "$D/colours.sh" "$D/colours.txt"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/colours-sh.png" canela "$D/colours.sh" > "$D/colours-sh.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/colours-txt.png" canela "$D/colours.txt" > "$D/colours-txt.err" 2>&1
rc2=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=165 WOLLY_WINDOW_SMOKE_IMAGE="$D/colours-off.png" canela "$D/colours.sh" > "$D/colours-off.err" 2>&1
rc3=$?
tinted() { pixels "$1" tinted; }
sh_tint=$(tinted "$D/colours-sh.png")
txt_tint=$(tinted "$D/colours-txt.png")
off_tint=$(tinted "$D/colours-off.png")
if [ "$rc1$rc2$rc3" = 000 ] && [ "${sh_tint:-0}" -ge 200 ] && [ "${txt_tint:-1}" -lt 20 ] && [ "${off_tint:-1}" -lt 20 ]; then report "syntax ($sh_tint against $txt_tint and $off_tint)" ok; else report syntax no "rc=$rc1$rc2$rc3 sh=${sh_tint:-?} txt=${txt_tint:-?} off=${off_tint:-?}"; fi

# CSV: a file with semicolons is drawn as a table (rows of the lines of its
# grid: one above each of its three rows and one below); switched to its
# text (166) it has none, the control.
printf 'Name;Wert;Notiz\nA;1,5;"x; y"\nB;22;z\n' > "$D/tabelle.csv"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/csv-table.png" canela "$D/tabelle.csv" > "$D/csv-table.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=166 WOLLY_WINDOW_SMOKE_IMAGE="$D/csv-text.png" canela "$D/tabelle.csv" > "$D/csv-text.err" 2>&1
rc2=$?
ruled() { pixels "$1" gridrows; }
grid=$(ruled "$D/csv-table.png")
nogrid=$(ruled "$D/csv-text.png")
if [ "$rc1$rc2" = 00 ] && [ "${grid:-0}" -ge 4 ] && [ "${nogrid:-1}" = 0 ]; then report "csv ($grid against $nogrid)" ok; else report csv no "rc=$rc1$rc2 grid=${grid:-?} text=${nogrid:-?}"; fi

# Diff: a new empty tab (129) compared with the next one (168), which holds
# the document, writes canela-Untitled.diff with its lines put in; the
# unchanged document compared with its saved text (167) writes nothing and
# says so, the control.
mkdir -p "$D/difftmp1" "$D/difftmp2"
printf 'eins\nzwei\n' > "$D/vergleich.md"
TMPDIR="$D/difftmp1" WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS="129 168" canela "$D/vergleich.md" > "$D/diff-tab.err" 2>&1
rc1=$?
TMPDIR="$D/difftmp2" WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=167 canela "$D/vergleich.md" > "$D/diff-same.err" 2>&1
rc2=$?
patch=$(ls "$D/difftmp1" 2> /dev/null | head -1)
if [ "$rc1$rc2" = 00 ] && [ -n "$patch" ] && grep -q '^+zwei$' "$D/difftmp1/$patch" && grep -q -E 'notice: (Keine Unterschiede|No differences)' "$D/diff-same.err" && [ -z "$(ls "$D/difftmp2")" ]; then report "diff ($patch)" ok; else report diff no "rc=$rc1$rc2 file=${patch:-none} $(grep notice "$D/diff-same.err" | head -1)"; fi
# The document against a file chosen (171): its line -zwei and the other's +drei.
mkdir -p "$D/difftmp3"
printf 'eins\ndrei\n' > "$D/andere.md"
TMPDIR="$D/difftmp3" WOLLY_WINDOW_CHOOSE="$D/andere.md" WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=171 WOLLY_WINDOW_SMOKE_IMAGE="$D/diff-file.png" canela "$D/vergleich.md" > "$D/diff-file.err" 2>&1
rc=$?
other=$(ls "$D/difftmp3" 2> /dev/null | head -1)
if [ "$rc" = 0 ] && [ -n "$other" ] && grep -q '^-zwei$' "$D/difftmp3/$other" && grep -q '^+drei$' "$D/difftmp3/$other"; then report "difffile ($other)" ok; else report difffile no "rc=$rc file=${other:-none}"; fi
# Within the lines: the pair -zwei/+drei has its changed parts on the strong
# red (#f4bbbb) and green (#b9e3c1); the comparison with the empty tab, only
# lines put in, has none.
red=$(pixels "$D/diff-file.png" f4bbbb)
green=$(pixels "$D/diff-file.png" b9e3c1)
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS="129 168" WOLLY_WINDOW_SMOKE_IMAGE="$D/diff-tab.png" TMPDIR="$D/difftmp1" canela "$D/vergleich.md" > "$D/diff-tab2.err" 2>&1
none=$(( $(pixels "$D/diff-tab.png" f4bbbb) + $(pixels "$D/diff-tab.png" b9e3c1) ))
if [ "${red:-0}" -ge 50 ] && [ "${green:-0}" -ge 50 ] && [ "$none" = 0 ]; then report "diffwithin ($red $green against $none)" ok; else report diffwithin no "red=${red:-?} green=${green:-?} tab=$none"; fi

# Side by side (setting diffsidebyside): the comparison with the file chosen
# is a table canela-vergleich.md.tsv with the row of the changed line.
mkdir -p "$D/difftmp4"
TMPDIR="$D/difftmp4" WOLLY_WINDOW_CHOOSE="$D/andere.md" WOLLY_WINDOW_SMOKE_SETTINGS="diffsidebyside=1" WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=171 WOLLY_WINDOW_SMOKE_IMAGE="$D/diff-sides.png" canela "$D/vergleich.md" > "$D/diff-sides.err" 2>&1
rc=$?
table=$(ls "$D/difftmp4" 2> /dev/null | head -1)
if [ "$rc" = 0 ] && [ "$table" = canela-vergleich.md.tsv ] && perl -ne '$f = 1 if /^~\t2\tzwei\t2\tdrei$/; END { exit($f ? 0 : 1) }' "$D/difftmp4/$table"; then report "diffsides ($table)" ok; else report diffsides no "rc=$rc file=${table:-none}"; fi
# Its colours: the yellow ground of the row ~ (#fff5d6), the red of the
# changed part of the old line (#f4bbbb), the green of the new (#b9e3c1); the
# table of the CSV check has none of them.
yellow=$(pixels "$D/diff-sides.png" fff5d6)
red=$(pixels "$D/diff-sides.png" f4bbbb)
green=$(pixels "$D/diff-sides.png" b9e3c1)
none=$(( $(pixels "$D/csv-table.png" fff5d6) + $(pixels "$D/csv-table.png" f4bbbb) + $(pixels "$D/csv-table.png" b9e3c1) ))
if [ "${yellow:-0}" -ge 500 ] && [ "${red:-0}" -ge 50 ] && [ "${green:-0}" -ge 50 ] && [ "$none" = 0 ]; then report "diffcolours ($yellow $red $green against $none)" ok; else report diffcolours no "yellow=${yellow:-?} red=${red:-?} green=${green:-?} plain=$none"; fi

# The REPL of MIRCO (170) without MIRCO in the image: the first input line of
# the block gets the answer that tools/mirco-repl is missing (the inputs after
# it are not tried), and no other answer.
printf '# R\n\n```mirco-repl\nlet x: Float64 := 2.5;\n= x * 4.0\n```\n' > "$D/repl.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=170 canela "$D/repl.md" > "$D/repl.err" 2>&1
rc=$?
answers=$(grep -c -E '^→ tools/mirco-repl (fehlt|is missing)' "$D/repl.md")
if [ "$rc" = 0 ] && [ "$answers" = 1 ]; then report "repl (none here, $answers answer)" ok; else report repl no "rc=$rc answers=$answers"; fi

# The head of a front matter: title and author drawn, no ground of the
# block (#f5f5f5) at the top; the control, a front matter without title or
# author, keeps its source on that ground.
printf -- '---\ntitle: Messreihe\nauthor: H. Z.\nnumber-sections: true\n---\n\n# Eins\n' > "$D/head.md"
printf -- '---\nlang: de\n---\n\n# Eins\n' > "$D/nohead.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/head.png" canela "$D/head.md" > "$D/head.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/nohead.png" canela "$D/nohead.md" > "$D/nohead.err" 2>&1
rc2=$?
headground=$(pixels "$D/head.png" f5f5f5)
rawground=$(pixels "$D/nohead.png" f5f5f5)
if [ "$rc1$rc2" = 00 ] && [ "${headground:-1}" -lt 100 ] && [ "${rawground:-0}" -ge 2000 ]; then report "head ($headground against $rawground)" ok; else report head no "rc=$rc1$rc2 head=${headground:-?} raw=${rawground:-?}"; fi

# A table block with its data drawn as a grid (rows of lines of #cccccc, the
# table wide enough for runs of 100 pixels);
# the control, its data file missing, keeps its source.
printf 'Zeit in Sekunden,Auslenkung in Millimetern,Fehler\n0.0,40.0,0.5\n0.1,21.8,0.5\n0.2,-15.1,0.5\n' > "$D/messung.csv"
printf '```table\ntitle: Messwerte\nlabel: tbl:werte\ndata: messung.csv\n```\n' > "$D/tblock.md"
printf '```table\ntitle: Messwerte\nlabel: tbl:werte\ndata: fehlt.csv\n```\n' > "$D/notblock.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/tblock.png" canela "$D/tblock.md" > "$D/tblock.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/notblock.png" canela "$D/notblock.md" > "$D/notblock.err" 2>&1
rc2=$?
tgrid=$(pixels "$D/tblock.png" gridrows)
tnone=$(pixels "$D/notblock.png" gridrows)
if [ "$rc1$rc2" = 00 ] && [ "${tgrid:-0}" -ge 5 ] && [ "${tnone:-1}" = 0 ]; then report "tableblock ($tgrid against $tnone)" ok; else report tableblock no "rc=$rc1$rc2 grid=${tgrid:-?} none=${tnone:-?}"; fi

# The caption of a labelled picture, "Abbildung 1: Versuchsaufbau" under
# it: more dark pixels with {#fig:aufbau} than the same picture without.
printf '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="0" y="0" width="200" height="100" fill="#d9452b"/></svg>\n' > "$D/aufbau.svg"
printf -- '---\ntitle: Messreihe\n---\n\n![Versuchsaufbau](aufbau.svg){#fig:aufbau}\n' > "$D/piccap.md"
printf -- '---\ntitle: Messreihe\n---\n\n![Versuchsaufbau](aufbau.svg)\n' > "$D/nopiccap.md"
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/piccap.png" canela "$D/piccap.md" > "$D/piccap.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_IMAGE="$D/nopiccap.png" canela "$D/nopiccap.md" > "$D/nopiccap.err" 2>&1
rc2=$?
darkall() { convert "$1" -alpha off -colorspace Gray -threshold 50% -negate -format '%[fx:round(mean*w*h)]' info: 2> /dev/null; }
capdark=$(darkall "$D/piccap.png")
nocapdark=$(darkall "$D/nopiccap.png")
if [ "$rc1$rc2" = 00 ] && [ "${capdark:-0}" -ge $(( ${nocapdark:-0} + 200 )) ]; then report "piccaption ($capdark against $nocapdark)" ok; else report piccaption no "rc=$rc1$rc2 with=${capdark:-?} without=${nocapdark:-?}"; fi

# Markdown <-> HTML (126) from plain text: notiz.txt becomes notiz.html
# through Markdown; in the reading mode the notice says why and no HTML is
# written, the control.
printf 'Hallo **Welt**.\n' > "$D/notiz.txt"
printf '# Titel\n' > "$D/lesen.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=126 canela "$D/notiz.txt" > "$D/notiz.err" 2>&1
rc1=$?
WOLLY_WINDOW_SMOKE_SETTINGS="readmode=1" WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=126 canela "$D/lesen.md" > "$D/lesen.err" 2>&1
rc2=$?
if [ "$rc1$rc2" = 00 ] && grep -q '<strong>Welt</strong>' "$D/notiz.html" 2> /dev/null && grep -q -E 'notice: (Lesemodus|Reading mode)' "$D/lesen.err" && [ ! -e "$D/lesen.html" ]; then report htmlswitch ok; else report htmlswitch no "rc=$rc1$rc2 $(ls "$D" | grep -E 'notiz|lesen' | tr '\n' ' ')"; fi

# Move Block Down (174), the cursor in the first block: the paragraph and
# the table below it swap; Move Block Up (173) there changes nothing, the
# control.
printf 'Erster Absatz.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' > "$D/blockdown.md"
cp "$D/blockdown.md" "$D/blockup.md"
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=174 canela "$D/blockdown.md" > "$D/blockdown.err" 2>&1
rc1=$?
WOLLY_WINDOW_ASK=save WOLLY_WINDOW_SMOKE=picture WOLLY_WINDOW_SMOKE_COMMANDS=173 canela "$D/blockup.md" > "$D/blockup.err" 2>&1
rc2=$?
if [ "$rc1$rc2" = 00 ] && [ "$(head -1 "$D/blockdown.md")" = '| a | b |' ] && [ "$(head -1 "$D/blockup.md")" = 'Erster Absatz.' ]; then report moveblock ok; else report moveblock no "rc=$rc1$rc2 down=$(head -1 "$D/blockdown.md") up=$(head -1 "$D/blockup.md")"; fi

# The exports.
printf -- '---\ntitle: Der Bericht\n---\n\n# Anfang\n\nText mit **fett** und $a^2+b^2=c^2$.\n\n1. eins\n2. zwei\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n' > "$D/export.md"
WOLLY_WINDOW_CHOOSE="$D/export.pdf" WOLLY_WINDOW_SMOKE=command WOLLY_WINDOW_SMOKE_COMMAND=121 canela "$D/export.md" > "$D/pdf.err" 2>&1
rc=$?
if command -v pdftotext > /dev/null 2>&1; then
	if [ "$rc" = 0 ] && pdftotext "$D/export.pdf" - 2> /dev/null | grep -q 'Text mit fett'; then report pdf ok; else report pdf no "rc=$rc"; fi
else
	# Without poppler here the text of export.pdf is read elsewhere; here its head.
	if [ "$rc" = 0 ] && [ "$(head -c 5 "$D/export.pdf" 2> /dev/null)" = "%PDF-" ]; then report "pdf (head; text read elsewhere)" ok; else report pdf no "rc=$rc"; fi
fi
WOLLY_WINDOW_CHOOSE="$D/export.docx" WOLLY_WINDOW_SMOKE=command WOLLY_WINDOW_SMOKE_COMMAND=133 canela "$D/export.md" > "$D/docx.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && unzip -p "$D/export.docx" word/document.xml 2> /dev/null | grep -q '<m:oMath>'; then report docx ok; else report docx no "rc=$rc"; fi
WOLLY_WINDOW_CHOOSE="$D/export.odt" WOLLY_WINDOW_SMOKE=command WOLLY_WINDOW_SMOKE_COMMAND=134 canela "$D/export.md" > "$D/odt.err" 2>&1
rc=$?
if [ "$rc" = 0 ] && unzip -p "$D/export.odt" content.xml 2> /dev/null | grep -q 'Der Bericht'; then report odt ok; else report odt no "rc=$rc"; fi

echo "smoke runs: $good of $total, not run: $notrun"
[ "$good" = "$total" ]
