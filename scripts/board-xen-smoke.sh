#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

stage_dir=${STAGE_DIR:-"${repo_root}/stage"}
output_dir=${OUTPUT_DIR:-"${stage_dir}/board-xen-smoke"}

if [ -n "${XEN_RAW:-}" ]; then
    xen_raw=${XEN_RAW}
elif [ -f "${stage_dir}/xen" ]; then
    xen_raw="${stage_dir}/xen"
else
    xen_raw="${stage_dir}/src/xen/xen/xen"
fi
if [ -n "${BOARD_DTB:-}" ]; then
    board_dtb=${BOARD_DTB}
elif [ -f "${stage_dir}/hifive-premier-550-plain.dtb" ]; then
    board_dtb="${stage_dir}/hifive-premier-550-plain.dtb"
else
    board_dtb="${stage_dir}/eic7700-milkv-megrez.dtb"
fi
domu1_kernel=${DOMU1_KERNEL:-${DOMU1_IMAGE:-"${stage_dir}/Image"}}
domu1_ramdisk=${DOMU1_RAMDISK:-"${stage_dir}/initramfs.cpio.gz"}
domu2_kernel=${DOMU2_KERNEL:-${DOMU2_IMAGE:-}}
domu2_ramdisk=${DOMU2_RAMDISK:-}

usb_dev=${USB_DEV:-0}
script_addr=${SCRIPT_ADDR:-0x88100000}
xen_load_addr=${RISCV_XEN_LOAD_ADDR:-${XEN_LOAD_ADDR:-0x95200000}}
dtb_load_addr=${DTB_LOAD_ADDR:-0x94200000}
domu1_kernel_load_addr=${DOMU1_KERNEL_LOAD_ADDR:-0x81200000}
domu1_ramdisk_load_addr=${DOMU1_RAMDISK_LOAD_ADDR:-0x85200000}
domu2_kernel_load_addr=${DOMU2_KERNEL_LOAD_ADDR:-0x8a200000}
domu2_ramdisk_load_addr=${DOMU2_RAMDISK_LOAD_ADDR:-0x8e200000}
fdt_resize=${FDT_RESIZE:-2048}

xen_bootargs=${XEN_BOOTARGS:-"bootscrub=0 com1=poll sched=null"}
domu_cpus=${DOMU_CPUS:-0x1}
domu_memory=${DOMU_MEMORY:-"0x0 0x80000"}
domu1_bootargs=${DOMU1_BOOTARGS:-"console=hvc0 rdinit=/init rw panic=-1 sysrq_always_enabled=1"}
domu2_bootargs=${DOMU2_BOOTARGS:-"console=hvc0 rdinit=/init rw panic=-1 sysrq_always_enabled=1"}

usage() {
    cat <<EOF
Usage: $(basename "$0") [--help]

Generate a board-first Xen dom0-less U-Boot smoke payload in:
  ${output_dir}

Default inputs:
  XEN_RAW       ${xen_raw}
  BOARD_DTB     ${board_dtb}
  DOMU1_KERNEL  ${domu1_kernel}
  DOMU1_IMAGE   legacy alias for DOMU1_KERNEL
  DOMU1_RAMDISK ${domu1_ramdisk}

Optional second guest:
  DOMU2_KERNEL=/path/to/Image DOMU2_RAMDISK=/path/to/initramfs.cpio.gz $(basename "$0")

Environment overrides:
  STAGE_DIR OUTPUT_DIR XEN_RAW BOARD_DTB DOMU1_KERNEL DOMU1_IMAGE DOMU1_RAMDISK DOMU2_KERNEL DOMU2_IMAGE DOMU2_RAMDISK
  RISCV_XEN_LOAD_ADDR/XEN_LOAD_ADDR DTB_LOAD_ADDR DOMU1_KERNEL_LOAD_ADDR DOMU1_RAMDISK_LOAD_ADDR DOMU2_KERNEL_LOAD_ADDR DOMU2_RAMDISK_LOAD_ADDR
  USB_DEV SCRIPT_ADDR FDT_RESIZE XEN_BOOTARGS DOMU1_BOOTARGS DOMU2_BOOTARGS
  DOMU_CPUS DOMU_MEMORY

The generated boot flow follows the board-proven U-Boot sequence:
  load usb 0 <dtb> board.dtb; load usb 0 <xen> xen.uImage;
  create /chosen xen,domain nodes with multiboot kernel+ramdisk modules; bootm <xen> - <dtb>.

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
    if [ ! -f "$1" ]; then
        fail "required file not found: $1"
    fi
}

file_size() {
    local path=${1:?path required}
    if stat -c %s "$path" >/dev/null 2>&1; then
        stat -c %s "$path"
    else
        stat -f %z "$path"
    fi
}

hex_size() {
    local path=${1:?path required}
    printf '0x%x' "$(file_size "$path")"
}

assert_uboot_string() {
    local name=${1:?name required}
    local value=${2-}
    case "${value}" in
        *$'\n'*|*\"*)
            fail "${name} must not contain newlines or double quotes"
            ;;
    esac
}

write_domain_node() {
    local domain=${1:?domain required}
    local kernel_load_addr=${2:?kernel load address required}
    local kernel_image=${3:?kernel image path required}
    local ramdisk_load_addr=${4:?ramdisk load address required}
    local ramdisk_image=${5:?ramdisk image path required}
    local bootargs=${6-}
    local kernel_size ramdisk_size

    kernel_size=$(hex_size "${kernel_image}")
    ramdisk_size=$(hex_size "${ramdisk_image}")
    assert_uboot_string "${domain} bootargs" "${bootargs}"

    cat <<EOF

# Create guest domain ${domain}
fdt mknode /chosen ${domain}
fdt set /chosen/${domain} compatible "xen,domain"
fdt set /chosen/${domain} cpus <${domu_cpus}>
fdt set /chosen/${domain} \#address-cells <0x1>
fdt set /chosen/${domain} \#size-cells <0x1>
fdt set /chosen/${domain} memory <${domu_memory}>
fdt set /chosen/${domain} vsbi_uart
fdt mknode /chosen/${domain} module@${kernel_load_addr}
fdt set /chosen/${domain}/module@${kernel_load_addr} compatible "multiboot,kernel" "multiboot,module"
fdt set /chosen/${domain}/module@${kernel_load_addr} reg <${kernel_load_addr} ${kernel_size}>
fdt set /chosen/${domain}/module@${kernel_load_addr} bootargs "${bootargs}"
fdt mknode /chosen/${domain} module@${ramdisk_load_addr}
fdt set /chosen/${domain}/module@${ramdisk_load_addr} compatible "multiboot,ramdisk" "multiboot,module"
fdt set /chosen/${domain}/module@${ramdisk_load_addr} reg <${ramdisk_load_addr} ${ramdisk_size}>
EOF
}

write_boot_cmd() {
    local boot_cmd=${1:?boot.cmd output required}
    local domu1_kernel_size domu1_ramdisk_size domu2_kernel_size domu2_ramdisk_size

    domu1_kernel_size=$(hex_size "${output_dir}/domu1.img")
    domu1_ramdisk_size=$(hex_size "${output_dir}/domu1.rd")
    assert_uboot_string XEN_BOOTARGS "${xen_bootargs}"

    {
        cat <<EOF
# Megrez Xen dom0-less Linux smoke script.
# Generated by scripts/board-xen-smoke.sh.
# Copy this directory to the root of the USB mass-storage device seen by U-Boot.

load usb ${usb_dev} ${dtb_load_addr} board.dtb
load usb ${usb_dev} ${xen_load_addr} xen.uImage
load usb ${usb_dev} ${domu1_kernel_load_addr} domu1.img
load usb ${usb_dev} ${domu1_ramdisk_load_addr} domu1.rd
EOF
        if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
            domu2_kernel_size=$(hex_size "${output_dir}/domu2.img")
            domu2_ramdisk_size=$(hex_size "${output_dir}/domu2.rd")
            cat <<EOF
load usb ${usb_dev} ${domu2_kernel_load_addr} domu2.img
load usb ${usb_dev} ${domu2_ramdisk_load_addr} domu2.rd
EOF
        fi
        cat <<EOF
fdt addr ${dtb_load_addr}
fdt resize ${fdt_resize}

fdt set /chosen xen,xen-bootargs "${xen_bootargs}"
EOF
        write_domain_node domU1 "${domu1_kernel_load_addr}" "${output_dir}/domu1.img" "${domu1_ramdisk_load_addr}" "${output_dir}/domu1.rd" "${domu1_bootargs}"
        if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
            write_domain_node domU2 "${domu2_kernel_load_addr}" "${output_dir}/domu2.img" "${domu2_ramdisk_load_addr}" "${output_dir}/domu2.rd" "${domu2_bootargs}"
        fi
        cat <<EOF

fdt print /chosen

# Boot Xen
bootm ${xen_load_addr} - ${dtb_load_addr}
EOF
    } > "${boot_cmd}"

    log "domU1 kernel size ${domu1_kernel_size}, ramdisk size ${domu1_ramdisk_size}"
    if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
        log "domU2 kernel size ${domu2_kernel_size}, ramdisk size ${domu2_ramdisk_size}"
    fi
}

write_readme() {
    local output=${1:?README output required}

    cat > "${output}" <<EOF
Megrez Xen dom0-less board smoke payload
========================================

Generated by scripts/board-xen-smoke.sh.

Files
-----
- xen.uImage  U-Boot legacy image created with the board-proven command:
              mkimage -A RISCV -T kernel -a ${xen_load_addr} -e ${xen_load_addr} -C none -d <xen> xen.uImage
- xen.uimg    8.3-safe duplicate of xen.uImage for FAT/NLS fallback experiments.
- board.dtb   Base board DTB loaded at ${dtb_load_addr}.
- domu1.img   Required domU1 Linux kernel Image loaded at ${domu1_kernel_load_addr}.
- domu1.rd    Required domU1 initramfs loaded at ${domu1_ramdisk_load_addr}.
- domu2.img   Optional second domU2 Linux kernel Image loaded at ${domu2_kernel_load_addr}.
- domu2.rd    Optional second domU2 initramfs loaded at ${domu2_ramdisk_load_addr}.
- boot.cmd    Plain U-Boot commands.
- boot.scr    U-Boot script image.

Copy to USB
-----------
Copy all files in this directory to the root of the USB mass-storage device
attached to the board. The generated script uses 'load usb ${usb_dev} ...'.

U-Boot one-shot
---------------
usb start
load usb ${usb_dev} ${script_addr} boot.scr
source ${script_addr}

Success criteria
----------------
The serial console should show Xen parsing the mutated /chosen node and booting
one or more dom0-less Linux domains with kernel + initramfs modules.

Notes
-----
If long filenames become a problem on a FAT/NLS-limited path, use xen.uimg and
edit boot.cmd accordingly, or reformat the transport partition to a filesystem
whose long names are visible to both U-Boot and the Linux initramfs.
EOF
}

main() {
    require_command cp
    require_command install
    require_command mkimage
    require_command stat
    require_file "${xen_raw}"
    require_file "${board_dtb}"
    require_file "${domu1_kernel}"
    require_file "${domu1_ramdisk}"
    if [ -n "${domu2_kernel}" ] || [ -n "${domu2_ramdisk}" ]; then
        if [ -z "${domu2_kernel}" ] || [ -z "${domu2_ramdisk}" ]; then
            fail "DOMU2_KERNEL/DOMU2_IMAGE and DOMU2_RAMDISK must be set together"
        fi
        require_file "${domu2_kernel}"
        require_file "${domu2_ramdisk}"
    fi

    log "preparing ${output_dir}"
    rm -rf -- "${output_dir}"
    mkdir -p -- "${output_dir}"

    install -m 0644 "${board_dtb}" "${output_dir}/board.dtb"
    install -m 0644 "${domu1_kernel}" "${output_dir}/domu1.img"
    install -m 0644 "${domu1_ramdisk}" "${output_dir}/domu1.rd"
    if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
        install -m 0644 "${domu2_kernel}" "${output_dir}/domu2.img"
        install -m 0644 "${domu2_ramdisk}" "${output_dir}/domu2.rd"
    fi

    log "wrapping Xen as xen.uImage"
    mkimage -A RISCV -T kernel -a "${xen_load_addr}" -e "${xen_load_addr}" \
        -C none -d "${xen_raw}" "${output_dir}/xen.uImage" >/dev/null
    cp -f -- "${output_dir}/xen.uImage" "${output_dir}/xen.uimg"

    write_boot_cmd "${output_dir}/boot.cmd"
    log "generating boot.scr"
    mkimage -A riscv -T script -C none -n 'Megrez Xen dom0-less smoke' \
        -d "${output_dir}/boot.cmd" "${output_dir}/boot.scr" >/dev/null

    write_readme "${output_dir}/README.txt"

    log "board Xen smoke payload ready in ${output_dir}"
    find "${output_dir}" -maxdepth 1 -mindepth 1 -print | sort
    cat <<EOF

Next on the board U-Boot console:
  usb start
  load usb ${usb_dev} ${script_addr} boot.scr
  source ${script_addr}
EOF
}

main "$@"
