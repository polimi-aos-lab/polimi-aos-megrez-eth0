#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

fail() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

log() {
    printf '==> %s\n' "$*"
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        fail "required command not found: $1"
    fi
}

stage_dir=${STAGE_DIR:-"${repo_root}/stage"}
src_dir=${SRC_DIR:-"${stage_dir}/src"}
xen_dir=${XEN_DIR:-"${src_dir}/xen"}
xen_build_dir=${xen_dir}/xen
xen_bin=${xen_build_dir}/xen
staged_xen=${stage_dir}/xen
xen_target_arch=${XEN_TARGET_ARCH:-${ARCH:-riscv64}}
cross_compile=${CROSS_COMPILE:-riscv64-linux-gnu-}
kbuild_defconfig=tiny64_defconfig

usage() {
    cat <<EOF
Usage: $(basename "$0") [--help]

Build the pinned Xen raw binary into ${xen_bin} and copy it to ${staged_xen}.
Runs inside the build Docker image by default; override with BUILD_XEN_IN_CONTAINER=1
when already inside the container.

Expected source layout:
  STAGE_DIR        ${stage_dir}
  SRC_DIR          ${src_dir}
  XEN_DIR          ${xen_dir}
  XEN build root   ${xen_build_dir}

Environment overrides:
  STAGE_DIR SRC_DIR XEN_DIR
  ARCH XEN_TARGET_ARCH CROSS_COMPILE JOBS
  DOCKER DOCKER_IMAGE BUILD_XEN_IN_CONTAINER

The Xen build uses:
  make -C ${xen_build_dir} XEN_TARGET_ARCH=${xen_target_arch} CROSS_COMPILE=${cross_compile} KBUILD_DEFCONFIG=${kbuild_defconfig} defconfig
  make -C ${xen_build_dir} XEN_TARGET_ARCH=${xen_target_arch} CROSS_COMPILE=${cross_compile} KBUILD_DEFCONFIG=${kbuild_defconfig} -j<JOBS> xen
EOF
}

case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
    "")
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

if [ "${BUILD_XEN_IN_CONTAINER:-0}" != 1 ]; then
    docker_bin=${DOCKER:-docker}
    docker_image=${DOCKER_IMAGE:-polimi-aos-megrez-build-env:linux-amd64}
    docker_env=(-e BUILD_XEN_IN_CONTAINER=1)

    for name in STAGE_DIR SRC_DIR XEN_DIR ARCH XEN_TARGET_ARCH CROSS_COMPILE JOBS; do
        if [ "${!name+x}" = x ]; then
            docker_env+=(-e "${name}=${!name}")
        fi
    done

    require_command "${docker_bin}"

    exec "${docker_bin}" run --rm \
        -v "${repo_root}:/repo" \
        -w /repo \
        "${docker_env[@]}" \
        "${docker_image}" \
        /repo/scripts/build-xen.sh "$@"
fi

require_command make
require_command cp
require_command mkdir
if [ -n "${JOBS:-}" ]; then
    jobs=${JOBS}
else
    require_command nproc
    jobs=$(nproc)
fi

if [ ! -d "${xen_build_dir}" ]; then
    fail "missing Xen source tree: ${xen_build_dir}"
fi

if [ -d "${staged_xen}" ]; then
    fail "staged Xen path exists as a directory, expected a file path: ${staged_xen}"
fi

xen_make() {
    make -C "${xen_build_dir}" \
        XEN_TARGET_ARCH="${xen_target_arch}" \
        CROSS_COMPILE="${cross_compile}" \
        KBUILD_DEFCONFIG="${kbuild_defconfig}" \
        "$@"
}

log "stage dir: ${stage_dir}"
log "source dir: ${xen_dir}"
log "build dir: ${xen_build_dir}"
log "target arch: ${xen_target_arch}"
log "cross compile: ${cross_compile}"
log "jobs: ${jobs}"
log "raw Xen output: ${xen_bin}"
log "staged Xen copy: ${staged_xen}"

log "configuring Xen"
xen_make defconfig

log "building Xen"
xen_make -j"${jobs}" xen

if [ ! -f "${xen_bin}" ]; then
    fail "expected Xen binary not found after build: ${xen_bin}"
fi

mkdir -p "${stage_dir}"
cp -f "${xen_bin}" "${staged_xen}"

log "copied raw Xen to ${staged_xen}"
log "done"
