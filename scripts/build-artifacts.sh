#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

if [ "${BUILD_ARTIFACTS_IN_CONTAINER:-0}" != 1 ]; then
    docker_bin=${DOCKER:-docker}
    docker_image=${DOCKER_IMAGE:-polimi-aos-megrez-build-env:linux-amd64}
    docker_env=(-e BUILD_ARTIFACTS_IN_CONTAINER=1)

    for name in \
        STAGE_DIR SRC_DIR BUILD_DIR KERNEL_DIR KERNEL_BUILD_DIR MODULES_STAGE_DIR ROOTFS_DIR \
        ARCH CROSS_COMPILE JOBS KERNEL_DEFCONFIG KERNEL_FRAGMENT DTB_NAME DRIVER_MODULE \
        BUSYBOX_VERSION BUSYBOX_SRC_DIR BUSYBOX_BUILD_DIR LRZSZ_VERSION LRZSZ_SRC_DIR LRZSZ_BUILD_DIR
    do
        if [ "${!name+x}" = x ]; then
            docker_env+=(-e "${name}=${!name}")
        fi
    done

    exec "${docker_bin}" run --rm \
        -v "${repo_root}:/repo" \
        -w /repo \
        "${docker_env[@]}" \
        "${docker_image}" \
        /repo/scripts/build-artifacts.sh "$@"
fi


stage_dir=${STAGE_DIR:-"${repo_root}/stage"}
src_dir=${SRC_DIR:-"${stage_dir}/src"}
build_dir=${BUILD_DIR:-"${stage_dir}/build"}
kernel_dir=${KERNEL_DIR:-"${src_dir}/rockos-kernel"}
kernel_build_dir=${KERNEL_BUILD_DIR:-"${build_dir}/kernel"}
modules_stage_dir=${MODULES_STAGE_DIR:-"${stage_dir}/modules"}
rootfs_dir=${ROOTFS_DIR:-"${build_dir}/initramfs-root"}

arch=${ARCH:-riscv}
cross_compile=${CROSS_COMPILE:-riscv64-linux-gnu-}
jobs=${JOBS:-$(nproc)}
defconfig=${KERNEL_DEFCONFIG:-win2030_defconfig}
fragment=${KERNEL_FRAGMENT:-"${repo_root}/config/kernel/eic7700-eth.fragment"}
dtb_name=${DTB_NAME:-eic7700-milkv-megrez.dtb}
driver_module=${DRIVER_MODULE:-dwmac-win2030.ko}

busybox_version=${BUSYBOX_VERSION:-1.36.1}
busybox_src_dir=${BUSYBOX_SRC_DIR:-"${src_dir}/busybox-${busybox_version}"}
busybox_build_dir=${BUSYBOX_BUILD_DIR:-"${build_dir}/busybox"}

lrzsz_version=${LRZSZ_VERSION:-0.12.20}
lrzsz_src_dir=${LRZSZ_SRC_DIR:-"${src_dir}/lrzsz-${lrzsz_version}"}
lrzsz_build_dir=${LRZSZ_BUILD_DIR:-"${build_dir}/lrzsz"}

usage() {
    cat <<EOF
Usage: $(basename "$0") [--skip-kernel] [--skip-initramfs] [--help]

Build Megrez RISC-V artifacts into ${stage_dir}:
  Image, Image.gz, ${dtb_name}, ${driver_module}, modules/, initramfs.cpio.gz.

Environment overrides:
  STAGE_DIR SRC_DIR BUILD_DIR KERNEL_DIR KERNEL_BUILD_DIR MODULES_STAGE_DIR
  ARCH CROSS_COMPILE JOBS KERNEL_DEFCONFIG KERNEL_FRAGMENT DTB_NAME DRIVER_MODULE
  BUSYBOX_VERSION BUSYBOX_SRC_DIR BUSYBOX_BUILD_DIR
  LRZSZ_VERSION LRZSZ_SRC_DIR LRZSZ_BUILD_DIR
  Run scripts/fetch-sources.sh first to materialize kernel, BusyBox, and lrzsz sources.
EOF
}

skip_kernel=false
skip_initramfs=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --skip-kernel)
            skip_kernel=true
            ;;
        --skip-initramfs)
            skip_initramfs=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            exit 2
            ;;
    esac
    shift
done

log() {
    printf '==> %s\n' "$*"
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        exit 1
    fi
}

require_file() {
    if [ ! -f "$1" ]; then
        printf 'error: required file not found: %s\n' "$1" >&2
        exit 1
    fi
}

require_dir() {
    if [ ! -d "$1" ]; then
        printf 'error: required directory not found: %s\n' "$1" >&2
        exit 1
    fi
}


kernel_make() {
    make -C "${kernel_dir}" O="${kernel_build_dir}" ARCH="${arch}" CROSS_COMPILE="${cross_compile}" "$@"
}

prepare_kernel_config() {
    require_dir "${kernel_dir}"
    require_file "${fragment}"
    require_file "${kernel_dir}/arch/${arch}/configs/${defconfig}"
    require_file "${kernel_dir}/scripts/kconfig/merge_config.sh"

    mkdir -p "${kernel_build_dir}"
    log "merging ${defconfig} + $(realpath --relative-to="${repo_root}" "${fragment}")"
    (
        cd "${kernel_dir}"
        ARCH="${arch}" CROSS_COMPILE="${cross_compile}" \
            scripts/kconfig/merge_config.sh \
            -O "${kernel_build_dir}" \
            "arch/${arch}/configs/${defconfig}" \
            "${fragment}"
    )
}

assert_kernel_config() {
    local config="${kernel_build_dir}/.config"
    require_file "${config}"

    for setting in \
        CONFIG_STMMAC_ETH=m \
        CONFIG_STMMAC_PLATFORM=m \
        CONFIG_DWMAC_WIN2030=m \
        CONFIG_MAGIC_SYSRQ=y
    do
        if ! grep -qx -- "${setting}" "${config}"; then
            printf 'error: final kernel config missing %s\n' "${setting}" >&2
            exit 1
        fi
    done
}

build_kernel_artifacts() {
    prepare_kernel_config
    assert_kernel_config

    log "building kernel Image/Image.gz, modules, dtbs"
    kernel_make -j"${jobs}" Image Image.gz modules dtbs

    log "installing modules"
    rm -rf -- "${modules_stage_dir}"
    mkdir -p "${modules_stage_dir}"
    kernel_make modules_install INSTALL_MOD_PATH="${modules_stage_dir}" INSTALL_MOD_STRIP=1

    local image="${kernel_build_dir}/arch/${arch}/boot/Image"
    local image_gz="${kernel_build_dir}/arch/${arch}/boot/Image.gz"
    local dtb="${kernel_build_dir}/arch/${arch}/boot/dts/eswin/${dtb_name}"
    local driver="${kernel_build_dir}/drivers/net/ethernet/stmicro/stmmac/${driver_module}"

    require_file "${image}"
    require_file "${image_gz}"
    require_file "${dtb}"
    require_file "${driver}"

    install -m 0644 "${image}" "${stage_dir}/Image"
    install -m 0644 "${image_gz}" "${stage_dir}/Image.gz"
    install -m 0644 "${dtb}" "${stage_dir}/${dtb_name}"
    install -m 0644 "${driver}" "${stage_dir}/${driver_module}"
}

build_busybox() {
    require_dir "${busybox_src_dir}"
    rm -rf -- "${busybox_build_dir}"
    mkdir -p "${busybox_build_dir}"

    log "configuring busybox"
    cp "${script_dir}/busybox.config" "${busybox_build_dir}/.config"
    set +o pipefail
    yes "" | make -C "${busybox_src_dir}" O="${busybox_build_dir}" ARCH="${arch}" CROSS_COMPILE="${cross_compile}" oldconfig
    local oldconfig_status=${PIPESTATUS[1]}
    set -o pipefail
    if [ "${oldconfig_status}" -ne 0 ]; then
        return "${oldconfig_status}"
    fi
    sed -i \
        -e 's/^# CONFIG_STATIC is not set$/CONFIG_STATIC=y/' \
        -e 's/^CONFIG_STATIC=n$/CONFIG_STATIC=y/' \
        "${busybox_build_dir}/.config"
    grep -qx 'CONFIG_STATIC=y' "${busybox_build_dir}/.config"

    log "building busybox"
    make -C "${busybox_src_dir}" O="${busybox_build_dir}" ARCH="${arch}" CROSS_COMPILE="${cross_compile}" -j"${jobs}"
    make -C "${busybox_src_dir}" O="${busybox_build_dir}" CONFIG_PREFIX="${rootfs_dir}" install

    require_file "${rootfs_dir}/bin/busybox"
    if file "${rootfs_dir}/bin/busybox" | grep -q 'dynamically linked'; then
        printf 'error: busybox is dynamically linked; initramfs expects a static binary\n' >&2
        exit 1
    fi
}

build_lrzsz() {
    local build_triplet

    require_dir "${lrzsz_src_dir}"
    rm -rf -- "${lrzsz_build_dir}"
    mkdir -p "${lrzsz_build_dir}"
    build_triplet=$(gcc -dumpmachine)

    log "configuring lrzsz"
    (
        cd "${lrzsz_build_dir}"
        CC="${cross_compile}gcc" CFLAGS="-Os" LDFLAGS="-static" \
            "${lrzsz_src_dir}/configure" \
            --build="${build_triplet}" \
            --host="${cross_compile%-}" \
            --disable-timesync \
            --disable-nls
    )

    log "building lrzsz"
    make -C "${lrzsz_build_dir}" -j"${jobs}"
    install -m 0755 "${lrzsz_build_dir}/src/lrz" "${rootfs_dir}/usr/bin/rz"
    install -m 0755 "${lrzsz_build_dir}/src/lsz" "${rootfs_dir}/usr/bin/sz"

    require_file "${rootfs_dir}/usr/bin/rz"
    require_file "${rootfs_dir}/usr/bin/sz"
    if file "${rootfs_dir}/usr/bin/rz" "${rootfs_dir}/usr/bin/sz" | grep -q 'dynamically linked'; then
        printf 'error: lrzsz binaries are dynamically linked; initramfs expects static binaries\n' >&2
        exit 1
    fi
}

write_initramfs_layout() {
    log "writing initramfs layout"
    mkdir -p \
        "${rootfs_dir}/dev" \
        "${rootfs_dir}/etc/init.d" \
        "${rootfs_dir}/proc" \
        "${rootfs_dir}/root" \
        "${rootfs_dir}/sys" \
        "${rootfs_dir}/tmp" \
        "${rootfs_dir}/usr/bin" \
        "${rootfs_dir}/usr/sbin"
    chmod 0755 "${rootfs_dir}" "${rootfs_dir}/etc" "${rootfs_dir}/etc/init.d"
    chmod 1777 "${rootfs_dir}/tmp"

    cat > "${rootfs_dir}/init" <<'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || mount -t tmpfs devtmpfs /dev
mkdir -p /dev/pts /tmp /run
mount -t devpts devpts /dev/pts 2>/dev/null || true
[ -w /proc/sys/kernel/sysrq ] && echo 1 > /proc/sys/kernel/sysrq
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
printf '\nMegrez initramfs ready. Tools: sz rz insmod ip.\n'
exec /bin/sh
EOF
    chmod 0755 "${rootfs_dir}/init"
}

build_initramfs() {
    require_command file
    require_command gzip
    require_command "${cross_compile}gcc"

    rm -rf -- "${rootfs_dir}"
    mkdir -p "${rootfs_dir}"
    build_busybox
    build_lrzsz
    write_initramfs_layout

    for tool in sh insmod ip rz sz; do
        if [ ! -e "${rootfs_dir}/bin/${tool}" ] && [ ! -e "${rootfs_dir}/sbin/${tool}" ] && [ ! -e "${rootfs_dir}/usr/bin/${tool}" ] && [ ! -e "${rootfs_dir}/usr/sbin/${tool}" ]; then
            printf 'error: initramfs missing %s\n' "${tool}" >&2
            exit 1
        fi
    done

    log "packing initramfs.cpio.gz"
    (
        cd "${rootfs_dir}"
        find . -print0 | cpio --null -ov --format=newc 2>/dev/null | gzip -9 > "${stage_dir}/initramfs.cpio.gz"
    )
    require_file "${stage_dir}/initramfs.cpio.gz"
}

main() {
    require_command make
    require_command cpio
    require_command grep
    require_command install
    mkdir -p "${stage_dir}" "${build_dir}" "${src_dir}"

    if [ "${skip_kernel}" != true ]; then
        build_kernel_artifacts
    fi

    if [ "${skip_initramfs}" != true ]; then
        build_initramfs
    fi

    log "artifacts ready in ${stage_dir}"
    find "${stage_dir}" -maxdepth 2 -mindepth 1 -print | sort
}

main "$@"
