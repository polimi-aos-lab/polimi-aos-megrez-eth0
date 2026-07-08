#!/usr/bin/env bash
# End-to-end orchestrator for the Xen dom0-less image.
#
# Pipeline: build the domU kernel with the passthrough NIC built-in (=y), build
# the minimal domU initramfs, build/copy the Xen raw binary, then assemble the
# U-Boot Xen dom0-less payload via board-xen-smoke.sh. Artifacts land under
# stage/xen/. Shared source trees stay under stage/src/.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

stage_xen_host="${repo_root}/stage/xen"

log() { printf '==> [image-xen] %s\n' "$*"; }

# Legacy builds staged the raw hypervisor as a top-level file at stage/xen.
# The profiled layout uses stage/xen/ as a directory, so remove only that exact
# file before any mkdir -p happens. A directory is preserved.
if [ -f "${stage_xen_host}" ]; then
    log "removing legacy Xen file at ${stage_xen_host}"
    rm -f -- "${stage_xen_host}"
fi

jobs="${JOBS:-1}"

log "building domU kernel (=y) + minimal initramfs into stage/xen"
PROFILE=xen \
STAGE_ROOT=/repo/stage \
STAGE_DIR=/repo/stage/xen \
SRC_DIR=/repo/stage/src \
JOBS="${jobs}" \
    "${script_dir}/build-artifacts.sh" "$@"

log "building/copying Xen raw binary into stage/xen/xen"
STAGE_DIR=/repo/stage/xen \
SRC_DIR=/repo/stage/src \
JOBS="${jobs}" \
    "${script_dir}/build-xen.sh"

log "assembling Xen dom0-less boot payload"
STAGE_DIR=/repo/stage/xen \
    "${script_dir}/board-xen-smoke.sh"

log "Xen image ready under ${stage_xen_host}"
