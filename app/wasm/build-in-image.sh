#!/usr/bin/env bash
# Runs inside hilde-gate: reads a tar of hilde/, wolly/ and canela/ on standard input, builds hilde,
# checks and builds Canela.Wasm as a reactor for wasm32-wasi, and writes a tar of out/ to standard
# output (canela.wasm and the logs).  Everything else goes to standard error.
#
#     tar -cf - hilde wolly canela | docker run --rm -i hilde-gate:10 bash build-in-image.sh > out.tar
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ABORT: bash ${BASH_VERSION} too old" >&2; exit 9; }
set -u
w=/tmp/w
mkdir -p "$w/out" && tar -xf - -C "$w" || exit 9
out=$w/out
finish() { tar -cf - -C "$w" out; exit "$1"; }
cd "$w/hilde" || finish 9
eval "$(opam env 2> /dev/null)"
make -j"$(nproc)" > "$out/make.log" 2>&1
rc=$?
echo "make rc=$rc" >&2
[ $rc = 0 ] || finish 9
M="--modules=bindings/generated:standard/src:$w/wolly/src"
./hilde check "$w/canela/app/wasm/Wasm.hiq" "$M" > "$out/check.log" 2>&1
rc=$?
echo "check rc=$rc" >&2
[ $rc = 0 ] || finish 1
./hilde build --target-type=wasm "$w/canela/app/wasm/Wasm.hiq" "$M" --output="$out/canela.wasm" > "$out/build.log" 2>&1
rc=$?
echo "build rc=$rc" >&2
[ $rc = 0 ] || finish 1
ls -l "$out/canela.wasm" >&2
(cd "$w/canela/app/wasm" && node test.mjs "$out/canela.wasm") > "$out/test.log" 2>&1
rc=$?
echo "node test rc=$rc" >&2
./hilde fmt --check "$w/canela/app/wasm/Wasm.hiq" > "$out/fmt.log" 2>&1
f=$?
echo "fmt rc=$f" >&2
[ $rc = 0 ] && [ $f = 0 ] || finish 1
finish 0
