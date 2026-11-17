#!/usr/bin/env bash
# Builds app/wasm/canela.wasm on a run host in hilde-gate: Hilde at a ref, the Wolly of a worktree,
# this tree.  The result and the logs land in <output>.
#
#     bash app/wasm/build.sh <host> <hilde-repo> <hilde-ref> <wolly-tree> <output>
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ABORT: bash ${BASH_VERSION} too old" >&2; exit 9; }
set -u
set -o pipefail
host=${1:?host}
hilde=${2:?hilde repository}
ref=${3:?hilde ref}
wolly=${4:?wolly tree}
output=${5:?output directory}
image=${CANELA_WASM_IMAGE:-hilde-gate:10}
here=$(cd "$(dirname "$0")/../.." && pwd) || exit 9
stage=$(mktemp -d) || exit 9
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/hilde" "$stage/wolly" "$stage/canela/app" "$output" || exit 9
git -C "$hilde" archive "$ref" | tar -xf - -C "$stage/hilde" || exit 9
COPYFILE_DISABLE=1 tar --no-xattrs -C "$wolly" --exclude='._*' -cf - src | tar -xf - -C "$stage/wolly" || exit 9
COPYFILE_DISABLE=1 tar --no-xattrs -C "$here" --exclude='._*' -cf - app/wasm | tar -xf - -C "$stage/canela" || exit 9
COPYFILE_DISABLE=1 tar --no-xattrs -C "$stage" -cf - hilde wolly canela |
	ssh -o BatchMode=yes -o ConnectTimeout=10 -p "${CANELA_SSH_PORT:-22}" "${CANELA_SSH_USER:-$USER}@$host" \
		"[ -S /run/user/\$(id -u)/docker.sock ] && export DOCKER_HOST=unix:///run/user/\$(id -u)/docker.sock; docker run --rm -i --network=none $image bash -c 'cat > /tmp/b.tar; mkdir -p /tmp/s; tar -xf /tmp/b.tar -C /tmp/s canela/app/wasm/build-in-image.sh; bash /tmp/s/canela/app/wasm/build-in-image.sh < /tmp/b.tar'" |
	tar -xf - -C "$output"
rc=$?
echo "build.sh rc=$rc"
ls -l "$output/out" 2> /dev/null
exit $rc
