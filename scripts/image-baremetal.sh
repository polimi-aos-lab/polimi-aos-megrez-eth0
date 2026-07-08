#!/usr/bin/env bash
# End-to-end orchestrator for the BARE-METAL (no-Xen) image.
#
# Pipeline: build the kernel with the NIC as loadable modules (=m) + a minimal
# initramfs, then assemble the bare-metal U-Boot boot payload (megrez initramfs
# with module autoload via megrez-net-up + boot.scr). All artifacts land under
# stage/baremetal/. The build step runs through Docker via build-artifacts.sh;
# assemble-boot.sh is host-native and consumes the generated host-side files.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

stage_baremetal_host="${repo_root}/stage/baremetal"

log() { printf '==> [image-baremetal] %s\n' "$*"; }

jobs="${JOBS:-1}"

log "building kernel (=m) + minimal initramfs into stage/baremetal"
PROFILE=baremetal \
STAGE_ROOT=/repo/stage \
STAGE_DIR=/repo/stage/baremetal \
SRC_DIR=/repo/stage/src \
JOBS="${jobs}" \
    "${script_dir}/build-artifacts.sh" "$@"

log "assembling bare-metal boot payload (megrez initramfs + boot.scr)"
STAGE_DIR="${stage_baremetal_host}" "${script_dir}/assemble-boot.sh"

log "bare-metal image ready under ${stage_baremetal_host}"
