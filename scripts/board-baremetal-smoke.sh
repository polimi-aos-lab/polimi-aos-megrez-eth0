#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

stage_dir=${STAGE_DIR:-"${repo_root}/stage"}
boot_dir=${BOOT_DIR:-"${stage_dir}/boot"}
boot_dev=${BOOT_DEV:-1}
boot_part=${BOOT_PART:-1}
kernel_image=${KERNEL_IMAGE:-Image}
dtb_name=${DTB_NAME:-eic7700-milkv-megrez.dtb}
initramfs_name=${INITRAMFS_NAME:-initramfs.cpio.gz}
boot_initramfs_name=${BOOT_INITRAMFS_NAME:-initramfs-megrez.cpio.gz}
bootargs=${BOOTARGS:-"console=ttyS0,115200n8 earlycon=sbi rdinit=/init rw panic=-1 sysrq_always_enabled=1"}
extra_bootargs=${EXTRA_BOOTARGS:-}
kernel_addr_r=${KERNEL_ADDR_R:-0x84000000}
fdt_addr_r=${FDT_ADDR_R:-0x88000000}
ramdisk_addr_r=${RAMDISK_ADDR_R:-0x88300000}
scriptaddr=${SCRIPTADDR:-0x88100000}
fit_addr_r=${FIT_ADDR_R:-0x90000000}
nic_initramfs=true

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Assemble Megrez SD boot payload from artifacts under stage/.

Options:
  --stage-dir DIR        Artifact input directory (default: ${stage_dir})
  --boot-dir DIR         Output/copy directory (default: ${boot_dir})
  --boot-dev N           U-Boot MMC device number (default: ${boot_dev})
  --boot-part N          U-Boot MMC partition number (default: ${boot_part})
  --image NAME           Kernel image basename under stage/ (default: ${kernel_image})
  --compressed           Use Image.gz instead of Image
  --dtb NAME             DTB basename under stage/ (default: ${dtb_name})
  --initramfs NAME       Initramfs basename under stage/ (default: ${initramfs_name})
  --bootargs STRING      Replace default Linux bootargs
  --extra-bootargs STR   Append extra Linux bootargs
  --no-nic-initramfs     Do not embed NIC modules/helper into generated initramfs
  -h, --help             Show this help

Environment overrides:
  STAGE_DIR BOOT_DIR BOOT_DEV BOOT_PART KERNEL_IMAGE DTB_NAME INITRAMFS_NAME
  BOOT_INITRAMFS_NAME BOOTARGS EXTRA_BOOTARGS KERNEL_ADDR_R FDT_ADDR_R
  RAMDISK_ADDR_R SCRIPTADDR FIT_ADDR_R
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --stage-dir)
            stage_dir=${2:?--stage-dir requires a directory}
            shift
            ;;
        --boot-dir)
            boot_dir=${2:?--boot-dir requires a directory}
            shift
            ;;
        --boot-dev)
            boot_dev=${2:?--boot-dev requires a device number}
            shift
            ;;
        --boot-part)
            boot_part=${2:?--boot-part requires a partition number}
            shift
            ;;
        --image)
            kernel_image=${2:?--image requires a basename}
            shift
            ;;
        --compressed)
            kernel_image=Image.gz
            ;;
        --dtb)
            dtb_name=${2:?--dtb requires a basename}
            shift
            ;;
        --initramfs)
            initramfs_name=${2:?--initramfs requires a basename}
            shift
            ;;
        --bootargs)
            bootargs=${2:?--bootargs requires a string}
            shift
            ;;
        --extra-bootargs)
            extra_bootargs=${2:?--extra-bootargs requires a string}
            shift
            ;;
        --no-nic-initramfs)
            nic_initramfs=false
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

if [ -n "${extra_bootargs}" ]; then
    bootargs="${bootargs} ${extra_bootargs}"
fi

log() {
    printf '==> %s\n' "$*"
}

fail() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        fail "required command not found: $1"
    fi
}

require_file() {
    if [ ! -s "$1" ]; then
        fail "required file missing or empty: $1"
    fi
}

require_dir() {
    if [ ! -d "$1" ]; then
        fail "required directory not found: $1"
    fi
}

copy_file() {
    local src=${1:?source required}
    local dst=${2:?destination required}
    local dst_dir

    dst_dir=$(dirname -- "${dst}")
    mkdir -p -- "${dst_dir}"
    install -m 0644 "${src}" "${dst}"
}

shell_single_quote() {
    printf "%s" "$1" | sed "s/'/'\\''/g"
}

assert_bootargs() {
    case " ${bootargs} " in
        *" panic=-1 "*) ;;
        *) fail "BOOTARGS must include panic=-1" ;;
    esac

    case " ${bootargs} " in
        *" sysrq_always_enabled=1 "*|*" sysrq=1 "*) ;;
        *) fail "BOOTARGS must enable SysRq with sysrq_always_enabled=1 or sysrq=1" ;;
    esac
}

find_kernel_release() {
    local modules_root="${stage_dir}/modules/lib/modules"
    local release_path
    local releases=()

    require_dir "${modules_root}"
    for release_path in "${modules_root}"/*; do
        [ -d "${release_path}" ] || continue
        releases+=("${release_path##*/}")
    done
    if [ "${#releases[@]}" -ne 1 ]; then
        fail "expected exactly one kernel release under ${modules_root}, found ${#releases[@]}"
    fi
    printf '%s\n' "${releases[0]}"
}

module_paths() {
    cat <<'EOF'
kernel/drivers/net/phy/libphy.ko
kernel/drivers/net/phy/phylink.ko
kernel/drivers/net/phy/fixed_phy.ko
kernel/drivers/net/phy/mdio_devres.ko
kernel/drivers/net/mdio/fwnode_mdio.ko
kernel/drivers/net/mdio/of_mdio.ko
kernel/drivers/net/pcs/pcs_xpcs.ko
kernel/drivers/net/ethernet/stmicro/stmmac/stmmac.ko
kernel/drivers/net/ethernet/stmicro/stmmac/stmmac-platform.ko
kernel/drivers/net/ethernet/stmicro/stmmac/dwmac-win2030.ko
EOF
}

copy_nic_modules() {
    local src_release_dir=${1:?source release dir required}
    local dst_release_dir=${2:?destination release dir required}
    local relpath

    while IFS= read -r relpath; do
        require_file "${src_release_dir}/${relpath}"
        copy_file "${src_release_dir}/${relpath}" "${dst_release_dir}/${relpath}"
    done <<EOF
$(module_paths)
EOF

    for metadata in modules.alias modules.builtin modules.dep modules.order modules.softdep modules.symbols; do
        if [ -f "${src_release_dir}/${metadata}" ]; then
            copy_file "${src_release_dir}/${metadata}" "${dst_release_dir}/${metadata}"
        fi
    done
}

prepare_boot_dir() {
    case "${boot_dir}" in
        ""|"/"|".")
            fail "refusing unsafe BOOT_DIR: ${boot_dir}"
            ;;
    esac

    if [ "${boot_dir}" = "${repo_root}" ] || [ "${boot_dir}" = "${stage_dir}" ]; then
        fail "refusing to replace repo or stage directory: ${boot_dir}"
    fi

    rm -rf -- "${boot_dir}"
    mkdir -p -- "${boot_dir}"
}

write_nic_helper() {
    local output=${1:?output path required}

    mkdir -p -- "$(dirname -- "${output}")"
    cat > "${output}" <<'EOF'
#!/bin/sh
set -u

PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH

log() {
    printf '%s\n' "$*"
}

is_mounted() {
    mountpoint=$1
    [ -r /proc/mounts ] && grep -q "^[^ ]* ${mountpoint} " /proc/mounts
}

mount_runtime_fs() {
    mkdir -p /proc /sys /dev /dev/pts /run /tmp
    is_mounted /proc || mount -t proc proc /proc 2>/dev/null || true
    is_mounted /sys || mount -t sysfs sysfs /sys 2>/dev/null || true
    if ! is_mounted /dev; then
        mount -t devtmpfs devtmpfs /dev 2>/dev/null || mount -t tmpfs devtmpfs /dev 2>/dev/null || true
    fi
    is_mounted /dev/pts || mount -t devpts devpts /dev/pts 2>/dev/null || true
}

module_loaded() {
    module_name=$(printf '%s' "$1" | tr '-' '_')
    [ -r /proc/modules ] && grep -q "^${module_name} " /proc/modules
}

find_module_file() {
    module_file=$1
    [ -d /lib/modules ] || return 1
    find /lib/modules -type f -name "${module_file}.ko" 2>/dev/null | head -n 1
}

load_module() {
    module=$1
    file=${2:-$1}

    module_loaded "${module}" && return 0

    if command -v modprobe >/dev/null 2>&1; then
        modprobe "${module}" 2>/dev/null && return 0
        module_loaded "${module}" && return 0
    fi

    ko=$(find_module_file "${file}" || true)
    if [ -n "${ko}" ]; then
        insmod "${ko}" 2>/dev/null || module_loaded "${module}" || log "could not insmod ${ko}"
    else
        log "module ${file}.ko not found under /lib/modules"
    fi
}

first_non_loopback() {
    for path in /sys/class/net/*; do
        [ -e "${path}" ] || continue
        iface=${path##*/}
        [ "${iface}" = lo ] && continue
        printf '%s\n' "${iface}"
        return 0
    done
    return 1
}

bring_up_iface() {
    iface=$1

    [ -d "/sys/class/net/${iface}" ] || return 0
    if ip link set dev "${iface}" up >/dev/null 2>&1; then
        log "brought up ${iface}"
    else
        log "failed to bring up ${iface}"
    fi
}

mount_runtime_fs

[ -w /proc/sys/kernel/sysrq ] && echo 1 > /proc/sys/kernel/sysrq 2>/dev/null || true
if command -v depmod >/dev/null 2>&1; then
    depmod -a 2>/dev/null || true
fi

log "cmdline: $(cat /proc/cmdline 2>/dev/null || true)"
log "sysrq: $(cat /proc/sys/kernel/sysrq 2>/dev/null || true)"

load_module libphy
load_module phylink
load_module fixed_phy
load_module mdio_devres
load_module fwnode_mdio
load_module of_mdio
load_module pcs_xpcs
load_module stmmac
load_module stmmac-platform
load_module dwmac_win2030 dwmac-win2030

if command -v ip >/dev/null 2>&1; then
    seen_ifaces=
    for iface in eth0 eth1 "$(first_non_loopback || true)"; do
        [ -n "${iface}" ] || continue
        case " ${seen_ifaces} " in
            *" ${iface} "*) continue ;;
        esac
        seen_ifaces="${seen_ifaces} ${iface}"
        bring_up_iface "${iface}"
    done
    ip link show 2>/dev/null || true
else
    log "ip not found; skipping interface bring-up"
fi

if command -v dmesg >/dev/null 2>&1; then
    dmesg 2>/dev/null | tail -n 80 2>/dev/null || dmesg 2>/dev/null || true
fi
EOF
    chmod 0755 "${output}"
}

write_udhcpc_default_script() {
    local output=${1:?output path required}

    mkdir -p -- "$(dirname -- "${output}")"
    cat > "${output}" <<'EOF'
#!/bin/sh
set -u

PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH

[ -n "${interface:-}" ] || exit 0

case "${1:-}" in
    deconfig)
        ifconfig "${interface}" 0.0.0.0 2>/dev/null || true
        ;;
    bound|renew)
        broadcast_arg=
        netmask_arg=
        [ -n "${broadcast:-}" ] && broadcast_arg="broadcast ${broadcast}"
        [ -n "${subnet:-}" ] && netmask_arg="netmask ${subnet}"

        ifconfig "${interface}" "${ip}" ${broadcast_arg} ${netmask_arg} up

        if [ -n "${router:-}" ]; then
            while route del default dev "${interface}" 2>/dev/null; do :; done
            for gateway in ${router}; do
                route add default gw "${gateway}" dev "${interface}" 2>/dev/null && break
            done
        fi

        if [ -n "${dns:-}" ]; then
            mkdir -p /etc
            : > /etc/resolv.conf
            for nameserver in ${dns}; do
                printf 'nameserver %s\n' "${nameserver}" >> /etc/resolv.conf
            done
        fi
        ;;
esac
EOF
    chmod 0755 "${output}"
}

patch_init_for_nic_bringup() {
    local init_file=${1:?init file required}
    local init_patched="${init_file}.patched"

    if grep -q 'megrez-net-up || true' "${init_file}"; then
        return 0
    fi
    if ! grep -q '^exec /bin/sh$' "${init_file}"; then
        fail "expected exec /bin/sh in ${init_file}"
    fi

    awk '
        BEGIN { inserted = 0 }
        {
            if (!inserted && $0 == "exec /bin/sh") {
                print "[ -x /usr/sbin/megrez-net-up ] && /usr/sbin/megrez-net-up || true"
                inserted = 1
            }
            print
        }
    ' "${init_file}" > "${init_patched}" || fail "failed to patch ${init_file}"
    chmod 0755 "${init_patched}"
    mv -- "${init_patched}" "${init_file}"
}


build_initramfs() {
    local output=${1:?output initramfs required}
    local source_initramfs="${stage_dir}/${initramfs_name}"
    local tmp_root="${stage_dir}/build/board-baremetal-smoke-initramfs-root"
    local release=${2:-}
    local source_dir output_dir
    source_dir=$(cd -- "$(dirname -- "${source_initramfs}")" && pwd)
    source_initramfs="${source_dir}/$(basename -- "${source_initramfs}")"
    output_dir=$(cd -- "$(dirname -- "${output}")" && pwd)
    output="${output_dir}/$(basename -- "${output}")"


    rm -rf -- "${tmp_root}"
    mkdir -p -- "${tmp_root}"

    log "unpacking ${source_initramfs}"
    (
        cd "${tmp_root}"
        gzip -dc "${source_initramfs}" | cpio -id --quiet
    )

    if [ "${nic_initramfs}" = true ]; then
        local release_dir="${stage_dir}/modules/lib/modules/${release}"
        log "embedding NIC module closure for ${release}"
        copy_nic_modules "${release_dir}" "${tmp_root}/lib/modules/${release}"
        write_nic_helper "${tmp_root}/usr/sbin/megrez-net-up"
        write_udhcpc_default_script "${tmp_root}/usr/share/udhcpc/default.script"
        mkdir -p -- "${tmp_root}/root"
        cp -f -- "${tmp_root}/usr/sbin/megrez-net-up" "${tmp_root}/root/nic-bringup.sh"
        if [ -x "${tmp_root}/usr/sbin/megrez-net-up" ]; then
            patch_init_for_nic_bringup "${tmp_root}/init"
        fi
    fi

    log "packing $(basename -- "${output}")"
    (
        cd "${tmp_root}"
        find . -print0 | cpio --null -o --format=newc --quiet | gzip -9 > "${output}"
    )
    require_file "${output}"
    rm -rf -- "${tmp_root}"
}


write_boot_cmd() {
    local output=${1:?boot.cmd output required}
    local quoted_bootargs

    quoted_bootargs=$(shell_single_quote "${bootargs}")
    cat > "${output}" <<EOF
# Megrez transient U-Boot boot script.
# Generated by scripts/board-baremetal-smoke.sh.
# Does not modify persistent U-Boot environment by itself.

echo Booting Megrez BSP Linux from mmc ${boot_dev}:${boot_part}
setenv megrez_bootdev ${boot_dev}
setenv megrez_bootpart ${boot_part}
setenv kernel_addr_r ${kernel_addr_r}
setenv fdt_addr_r ${fdt_addr_r}
setenv ramdisk_addr_r ${ramdisk_addr_r}
setenv bootargs '${quoted_bootargs}'
load mmc \${megrez_bootdev}:\${megrez_bootpart} \${kernel_addr_r} /${kernel_image}
load mmc \${megrez_bootdev}:\${megrez_bootpart} \${fdt_addr_r} /${dtb_name}
load mmc \${megrez_bootdev}:\${megrez_bootpart} \${ramdisk_addr_r} /${boot_initramfs_name}
setenv ramdisk_size \${filesize}
booti \${kernel_addr_r} \${ramdisk_addr_r}:\${ramdisk_size} \${fdt_addr_r}
EOF
}

write_boot_readme() {
    local output=${1:?README output required}

    cat > "${output}" <<EOF
Megrez boot payload
===================

Copy this directory to partition 1 of the Megrez SD card, preferably ext4.
The default U-Boot device is mmc ${boot_dev}:${boot_part}; if the board enumerates
SD differently, regenerate with --boot-dev/--boot-part or edit boot.cmd and rerun mkimage.

Serial console
--------------
Use 115200 8N1 on the Megrez UART. Do not connect the USB-TTL red/VCC wire.
Stop autoboot with 's' when the U-Boot countdown appears.

One-shot boot
-------------
mmc list
mmc dev ${boot_dev}
ext4ls mmc ${boot_dev}:${boot_part} /
load mmc ${boot_dev}:${boot_part} \${scriptaddr} /boot.scr
source \${scriptaddr}

Persistent bootcmd after one-shot success
-----------------------------------------
setenv megrez_bootdev ${boot_dev}
setenv megrez_bootpart ${boot_part}
setenv megrez_try_boot 'mmc dev \${megrez_bootdev}; if mmc rescan; then if load mmc \${megrez_bootdev}:\${megrez_bootpart} \${scriptaddr} /boot.scr; then source \${scriptaddr}; fi; fi'
setenv bootcmd 'run megrez_try_boot; run distro_bootcmd'
saveenv
boot

Linux smoke commands
--------------------
cat /proc/cmdline
cat /proc/sys/kernel/sysrq
ip link              # automatic NIC bring-up should already show eth0/eth1 UP
/root/nic-bringup.sh # retry/debug if the automatic NIC bring-up needs another pass
udhcpc -i eth0 -n -q # with a live LAN, should install address/default route
ping -c 3 <lan-peer-ip>
EOF
}

main() {
    local kernel_src="${stage_dir}/${kernel_image}"
    local dtb_src="${stage_dir}/${dtb_name}"
    local initramfs_src="${stage_dir}/${initramfs_name}"
    local release=""

    require_command awk
    require_command cpio
    require_command find
    require_command gzip
    require_command install
    require_command mkimage
    require_command sed
    require_file "${kernel_src}"
    require_file "${dtb_src}"
    require_file "${initramfs_src}"
    assert_bootargs

    if [ "${nic_initramfs}" = true ]; then
        release=$(find_kernel_release)
    fi

    log "preparing ${boot_dir}"
    prepare_boot_dir

    copy_file "${kernel_src}" "${boot_dir}/${kernel_image}"
    copy_file "${dtb_src}" "${boot_dir}/${dtb_name}"
    if [ -f "${stage_dir}/dwmac-win2030.ko" ]; then
        copy_file "${stage_dir}/dwmac-win2030.ko" "${boot_dir}/dwmac-win2030.ko"
    fi

    if [ "${nic_initramfs}" = true ]; then
        copy_nic_modules "${stage_dir}/modules/lib/modules/${release}" "${boot_dir}/lib/modules/${release}"
        write_nic_helper "${boot_dir}/nic-bringup.sh"
        build_initramfs "${boot_dir}/${boot_initramfs_name}" "${release}"
    else
        copy_file "${initramfs_src}" "${boot_dir}/${boot_initramfs_name}"
    fi

    write_boot_cmd "${boot_dir}/boot.cmd"
    log "generating boot.scr"
    mkimage -A riscv -T script -C none -n 'Megrez BSP Linux boot' \
        -d "${boot_dir}/boot.cmd" "${boot_dir}/boot.scr" >/dev/null
    require_file "${boot_dir}/boot.scr"

    write_boot_readme "${boot_dir}/README.txt"

    log "boot payload ready in ${boot_dir}"
    find "${boot_dir}" -maxdepth 3 -mindepth 1 -print | sort
    cat <<EOF

Next:
  sudo mount /dev/sdX1 /mnt/megrez-boot
  sudo cp -a ${boot_dir}/. /mnt/megrez-boot/
  sync
  sudo umount /mnt/megrez-boot

U-Boot one-shot:
  mmc dev ${boot_dev}
  load mmc ${boot_dev}:${boot_part} \${scriptaddr} /boot.scr
  source \${scriptaddr}
EOF
}

main "$@"
