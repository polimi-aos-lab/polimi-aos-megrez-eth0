#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

if [ "${BOARD_XEN_SMOKE_IN_CONTAINER:-0}" != "1" ]; then
    docker_bin=${DOCKER:-docker}
    docker_image=${DOCKER_IMAGE:-polimi-aos-megrez-build-env:linux-aarch64}
    docker_env=(
        -e BOARD_XEN_SMOKE_IN_CONTAINER=1
        -e "STAGE_DIR=${STAGE_DIR:-/repo/stage}"
    )
    for name in \
        OUTPUT_DIR XEN_RAW BOARD_DTB XEN_LOAD_ADDR DTB_LOAD_ADDR BOOT_IFACE \
        BOOT_DEV BOOT_PART SCRIPT_ADDR FDT_RESIZE XEN_DEPLOY_NAME \
        DOMU1_KERNEL DOMU1_IMAGE DOMU1_RAMDISK DOMU1_KERNEL_LOAD_ADDR \
        DOMU1_RAMDISK_LOAD_ADDR DOMU1_BOOTARGS DOMU1_MEMORY DOMU1_CPUS \
        DOMU2_KERNEL DOMU2_IMAGE DOMU2_RAMDISK DOMU2_KERNEL_LOAD_ADDR \
        DOMU2_RAMDISK_LOAD_ADDR DOMU2_BOOTARGS DOMU2_MEMORY DOMU2_CPUS \
        ENABLE_DOMU1_ETH_PASSTHROUGH DOMU1_ETH_DTS DOMU1_ETH_DTB_NAME \
        DOMU1_ETH_DTB_LOAD_ADDR DOMU1_STATIC_MEM_START DOMU1_STATIC_MEM_SIZE \
        DOMU1_DIRECT_MAP
    do
        if [ -n "${!name:-}" ]; then
            docker_env+=(-e "${name}")
        fi
    done
    exec "${docker_bin}" run --rm \
        -v "${repo_root}:/repo" \
        -w /repo \
        "${docker_env[@]}" \
        "${docker_image}" \
        /bin/bash /repo/scripts/board-xen-smoke.sh "$@"
fi

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
if [ -n "${DOMU1_KERNEL:-${DOMU1_IMAGE:-}}" ]; then
    domu1_kernel=${DOMU1_KERNEL:-${DOMU1_IMAGE}}
elif [ -f "${stage_dir}/Image.gz" ]; then
    domu1_kernel="${stage_dir}/Image.gz"
else
    domu1_kernel="${stage_dir}/Image"
fi
domu1_ramdisk=${DOMU1_RAMDISK-"${stage_dir}/initramfs.cpio.gz"}
domu2_kernel=${DOMU2_KERNEL:-${DOMU2_IMAGE:-}}
domu2_ramdisk=${DOMU2_RAMDISK:-}

boot_iface=${BOOT_IFACE:-mmc}
boot_dev=${BOOT_DEV:-${USB_DEV:-1}}
boot_part=${BOOT_PART:-1}
script_addr=${SCRIPT_ADDR:-0x88100000}
xen_load_addr=${RISCV_XEN_LOAD_ADDR:-${XEN_LOAD_ADDR:-0x95200000}}
dtb_load_addr=${DTB_LOAD_ADDR:-0x94200000}
domu1_kernel_load_addr=${DOMU1_KERNEL_LOAD_ADDR:-0x81200000}
domu1_ramdisk_load_addr=${DOMU1_RAMDISK_LOAD_ADDR:-0x85200000}
domu2_kernel_load_addr=${DOMU2_KERNEL_LOAD_ADDR:-0x8a200000}
domu2_ramdisk_load_addr=${DOMU2_RAMDISK_LOAD_ADDR:-0x8e200000}
fdt_resize=${FDT_RESIZE:-2048}
xen_deploy_name=${XEN_DEPLOY_NAME:-xen.img}
domu1_eth_passthrough=${ENABLE_DOMU1_ETH_PASSTHROUGH:-0}
domu1_eth_dts=${DOMU1_ETH_DTS:-"${repo_root}/config/dts/eic7700-megrez-domu1-eth0-passthrough.dts"}
domu1_eth_dtb_name=${DOMU1_ETH_DTB_NAME:-domu1-eth0.dtb}
domu1_eth_dtb_load_addr=${DOMU1_ETH_DTB_LOAD_ADDR:-0x88200000}
domu1_static_mem_start=${DOMU1_STATIC_MEM_START:-}
domu1_static_mem_size=${DOMU1_STATIC_MEM_SIZE:-}
domu1_direct_map=${DOMU1_DIRECT_MAP:-0}

xen_bootargs=${XEN_BOOTARGS:-"bootscrub=0 com1=poll sched=null sync_console"}
domu_cpus=${DOMU_CPUS:-0x1}
domu_memory=${DOMU_MEMORY:-"0x0 0x80000"}
domu1_bootargs=${DOMU1_BOOTARGS-"console=hvc0 rdinit=/init rw panic=-1 sysrq_always_enabled=1"}
domu2_bootargs=${DOMU2_BOOTARGS-"console=hvc0 rdinit=/init rw panic=-1 sysrq_always_enabled=1"}

usage() {
    cat <<EOF
Usage: $(basename "$0") [--help]

Generate a board-first Xen dom0-less U-Boot smoke payload in:
  ${output_dir}

By default this script re-executes in Docker for reproducible dtc/mkimage tools:
  DOCKER=\${DOCKER:-docker} DOCKER_IMAGE=\${DOCKER_IMAGE:-polimi-aos-megrez-build-env:linux-aarch64}
  BOARD_XEN_SMOKE_IN_CONTAINER=1 is reserved for the in-container re-entry path.

Default inputs:
  XEN_RAW       ${xen_raw}
  BOARD_DTB     ${board_dtb}
  DOMU1_KERNEL  ${domu1_kernel}
  Default prefers ${stage_dir}/Image.gz when present, falling back to ${stage_dir}/Image.
  DOMU1_IMAGE   legacy alias for DOMU1_KERNEL
  DOMU1_RAMDISK ${domu1_ramdisk}

Optional second guest:
  DOMU2_KERNEL=/path/to/Image.gz DOMU2_RAMDISK=/path/to/initramfs.cpio.gz $(basename "$0")

Environment overrides:
  STAGE_DIR OUTPUT_DIR XEN_RAW BOARD_DTB DOMU1_KERNEL DOMU1_IMAGE DOMU1_RAMDISK DOMU2_KERNEL DOMU2_IMAGE DOMU2_RAMDISK
  RISCV_XEN_LOAD_ADDR/XEN_LOAD_ADDR DTB_LOAD_ADDR DOMU1_KERNEL_LOAD_ADDR DOMU1_RAMDISK_LOAD_ADDR DOMU2_KERNEL_LOAD_ADDR DOMU2_RAMDISK_LOAD_ADDR
  BOOT_IFACE BOOT_DEV BOOT_PART SCRIPT_ADDR FDT_RESIZE XEN_DEPLOY_NAME XEN_BOOTARGS DOMU1_BOOTARGS DOMU2_BOOTARGS
  DOMU_CPUS DOMU_MEMORY

Optional domU1 eth0 passthrough:
  ENABLE_DOMU1_ETH_PASSTHROUGH=1 DOMU1_ETH_DTS=${domu1_eth_dts} DOMU1_ETH_DTB_NAME=${domu1_eth_dtb_name}
  DOMU1_ETH_DTB_LOAD_ADDR=${domu1_eth_dtb_load_addr}
  DOMU1_STATIC_MEM_START=<addr> DOMU1_STATIC_MEM_SIZE=<size> DOMU1_DIRECT_MAP=1

BOOT_IFACE may be mmc, usb, or tftp. tftp emits tftpboot commands and expects
U-Boot serverip/ipaddr to be configured before sourcing boot.scr.

The generated boot flow loads payloads, creates /chosen xen,domain nodes with
multiboot kernel+ramdisk modules, then runs bootm <xen> - <dtb>. The opt-in
eth0 path also loads a multiboot,device-tree module for domU1 and is trusted
no-IOMMU lab plumbing: use static direct-map RAM before traffic, and verify the
Xen PLIC IRQ plus ccache/cache-maintenance paths.

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

assert_plain_filename() {
    local name=${1:?name required}
    local value=${2-}
    case "${value}" in
        ""|*/*)
            fail "${name} must be a plain filename, got: ${value}"
            ;;
    esac
}

validate_options() {
    case "${domu1_eth_passthrough}" in
        0|1)
            ;;
        *)
            fail "ENABLE_DOMU1_ETH_PASSTHROUGH must be 0 or 1, got: ${domu1_eth_passthrough}"
            ;;
    esac
    case "${domu1_direct_map}" in
        0|1)
            ;;
        *)
            fail "DOMU1_DIRECT_MAP must be 0 or 1, got: ${domu1_direct_map}"
            ;;
    esac

    assert_plain_filename XEN_DEPLOY_NAME "${xen_deploy_name}"
    if [ "${domu1_eth_passthrough}" = "1" ]; then
        assert_plain_filename DOMU1_ETH_DTB_NAME "${domu1_eth_dtb_name}"
    fi

    if { [ -n "${domu1_static_mem_start}" ] && [ -z "${domu1_static_mem_size}" ]; } ||
       { [ -z "${domu1_static_mem_start}" ] && [ -n "${domu1_static_mem_size}" ]; }; then
        fail "DOMU1_STATIC_MEM_START and DOMU1_STATIC_MEM_SIZE must be set together"
    fi
    if [ "${domu1_direct_map}" = "1" ] && [ -z "${domu1_static_mem_start}" ]; then
        fail "DOMU1_DIRECT_MAP=1 requires DOMU1_STATIC_MEM_START and DOMU1_STATIC_MEM_SIZE"
    fi
}

storage_preamble() {
    case "${boot_iface}" in
        mmc)
            printf 'mmc dev %s\n' "${boot_dev}"
            ;;
        usb)
            printf 'usb start\n'
            ;;
        tftp)
            printf 'setenv autostart no\necho Using TFTP server ${serverip} from client ${ipaddr}\n'
            ;;
        *)
            fail "BOOT_IFACE must be mmc, usb, or tftp, got: ${boot_iface}"
            ;;
    esac
}

storage_load() {
    local addr=${1:?load address required}
    local file=${2:?file required}

    case "${boot_iface}" in
        mmc)
            printf 'load mmc %s:%s %s %s\n' "${boot_dev}" "${boot_part}" "${addr}" "${file}"
            ;;
        usb)
            printf 'load usb %s %s %s\n' "${boot_dev}" "${addr}" "${file}"
            ;;
        tftp)
            printf 'tftpboot %s %s\n' "${addr}" "${file}"
            ;;
        *)
            fail "BOOT_IFACE must be mmc, usb, or tftp, got: ${boot_iface}"
            ;;
    esac
}

write_domain_node() {
    local domain=${1:?domain required}
    local kernel_load_addr=${2:?kernel load address required}
    local kernel_image=${3:?kernel image path required}
    local ramdisk_load_addr=${4-}
    local ramdisk_image=${5-}
    local bootargs=${6-}
    local kernel_size ramdisk_size

    kernel_size=$(hex_size "${kernel_image}")
    if [ -n "${ramdisk_image}" ]; then
        ramdisk_size=$(hex_size "${ramdisk_image}")
    fi
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
EOF
    if [ -n "${ramdisk_image}" ]; then
        cat <<EOF
fdt mknode /chosen/${domain} module@${ramdisk_load_addr}
fdt set /chosen/${domain}/module@${ramdisk_load_addr} compatible "multiboot,ramdisk" "multiboot,module"
fdt set /chosen/${domain}/module@${ramdisk_load_addr} reg <${ramdisk_load_addr} ${ramdisk_size}>
EOF
    fi
}

domu1_static_mem_cells() {
    local start_words size_words
    # The Xen RISC-V parser sees domU1 under /chosen with the parent/default
    # address format: two address cells and two size cells.  Accept the common
    # shorthand DOMU1_STATIC_MEM_START=0xa0000000, but emit a full
    # <addr_hi addr_lo size_hi size_lo> tuple for U-Boot's fdt command.
    start_words=$(printf '%s\n' "${domu1_static_mem_start}" | wc -w)
    size_words=$(printf '%s\n' "${domu1_static_mem_size}" | wc -w)

    if [ "${start_words}" -eq 1 ] && [ "${size_words}" -eq 1 ]; then
        printf '0x0 %s 0x0 %s' "${domu1_static_mem_start}" "${domu1_static_mem_size}"
    else
        printf '%s %s' "${domu1_static_mem_start}" "${domu1_static_mem_size}"
    fi
}

write_domu1_static_options() {
    if [ -n "${domu1_static_mem_start}" ]; then
        cat <<EOF
fdt set /chosen/domU1 xen,static-mem <$(domu1_static_mem_cells)>
EOF
    fi
    if [ "${domu1_direct_map}" = "1" ]; then
        cat <<EOF
fdt set /chosen/domU1 direct-map
EOF
    fi
}

write_domu1_eth_dtb_module() {
    local dtb_size

    dtb_size=$(hex_size "${output_dir}/${domu1_eth_dtb_name}")
    cat <<EOF
fdt mknode /chosen/domU1 module@${domu1_eth_dtb_load_addr}
fdt set /chosen/domU1/module@${domu1_eth_dtb_load_addr} compatible "multiboot,device-tree" "multiboot,module"
fdt set /chosen/domU1/module@${domu1_eth_dtb_load_addr} reg <${domu1_eth_dtb_load_addr} ${dtb_size}>
EOF
}

write_boot_cmd() {
    local boot_cmd=${1:?boot.cmd output required}
    local domu1_kernel_size domu1_ramdisk_size domu2_kernel_size domu2_ramdisk_size

    domu1_kernel_size=$(hex_size "${output_dir}/domu1.img")
    if [ -f "${output_dir}/domu1.rd" ]; then
        domu1_ramdisk_size=$(hex_size "${output_dir}/domu1.rd")
    fi
    assert_uboot_string XEN_BOOTARGS "${xen_bootargs}"

    {
        cat <<EOF
# Megrez Xen dom0-less smoke script.
# Generated by scripts/board-xen-smoke.sh.
# Copy this directory to the root of the SD boot partition seen by U-Boot.

$(storage_preamble)
$(storage_load "${dtb_load_addr}" board.dtb)
$(storage_load "${xen_load_addr}" "${xen_deploy_name}")
$(storage_load "${domu1_kernel_load_addr}" domu1.img)
EOF
        if [ -f "${output_dir}/domu1.rd" ]; then
            cat <<EOF
$(storage_load "${domu1_ramdisk_load_addr}" domu1.rd)
EOF
        fi
        if [ "${domu1_eth_passthrough}" = "1" ]; then
            cat <<EOF
$(storage_load "${domu1_eth_dtb_load_addr}" "${domu1_eth_dtb_name}")
EOF
        fi
        if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
            domu2_kernel_size=$(hex_size "${output_dir}/domu2.img")
            domu2_ramdisk_size=$(hex_size "${output_dir}/domu2.rd")
            cat <<EOF
$(storage_load "${domu2_kernel_load_addr}" domu2.img)
$(storage_load "${domu2_ramdisk_load_addr}" domu2.rd)
EOF
        fi
        cat <<EOF
fdt addr ${dtb_load_addr}
fdt resize ${fdt_resize}

fdt set /chosen xen,xen-bootargs "${xen_bootargs}"
EOF
        if [ -f "${output_dir}/domu1.rd" ]; then
            write_domain_node domU1 "${domu1_kernel_load_addr}" "${output_dir}/domu1.img" "${domu1_ramdisk_load_addr}" "${output_dir}/domu1.rd" "${domu1_bootargs}"
        else
            write_domain_node domU1 "${domu1_kernel_load_addr}" "${output_dir}/domu1.img" "" "" "${domu1_bootargs}"
        fi
        write_domu1_static_options
        if [ "${domu1_eth_passthrough}" = "1" ]; then
            write_domu1_eth_dtb_module
        fi
        if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
            write_domain_node domU2 "${domu2_kernel_load_addr}" "${output_dir}/domu2.img" "${domu2_ramdisk_load_addr}" "${output_dir}/domu2.rd" "${domu2_bootargs}"
        fi
        cat <<EOF

fdt print /chosen

# Boot Xen
bootm ${xen_load_addr} - ${dtb_load_addr}
EOF
    } > "${boot_cmd}"

    if [ -n "${domu1_ramdisk_size:-}" ]; then
        log "domU1 kernel size ${domu1_kernel_size}, ramdisk size ${domu1_ramdisk_size}"
    else
        log "domU1 kernel size ${domu1_kernel_size}, no ramdisk"
    fi
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
Default workflow is containerized for reproducible dtc/mkimage tools:
  make board-xen-smoke


Files
-----
- ${xen_deploy_name}  U-Boot legacy image created with:
              mkimage -A RISCV -T kernel -a ${xen_load_addr} -e ${xen_load_addr} -C none -d <xen> ${xen_deploy_name}
              Default is xen.img to stay 8.3-safe on FAT SD paths.
- board.dtb   Base board DTB loaded at ${dtb_load_addr}.
- domu1.img   Required domU1 Linux kernel payload loaded at ${domu1_kernel_load_addr}; default source is Image.gz when present.
- domu1.rd    Optional domU1 initramfs loaded at ${domu1_ramdisk_load_addr} when DOMU1_RAMDISK is non-empty.
- domu2.img   Optional second domU2 Linux kernel Image loaded at ${domu2_kernel_load_addr}.
- domu2.rd    Optional second domU2 initramfs loaded at ${domu2_ramdisk_load_addr}.
EOF
    if [ "${domu1_eth_passthrough}" = "1" ]; then
        cat >> "${output}" <<EOF
- ${domu1_eth_dtb_name}  domU1 GMAC0 passthrough DTB compiled from ${domu1_eth_dts}, loaded at ${domu1_eth_dtb_load_addr}.
EOF
    fi
    cat >> "${output}" <<EOF
- boot.cmd    Plain U-Boot commands.
- boot.scr    U-Boot script image.

Transport
---------
BOOT_IFACE=${boot_iface}. For mmc/usb, copy all files in this directory to the
root of the board SD/USB boot partition. For tftp, serve this directory from
the host and configure U-Boot serverip/ipaddr before loading boot.scr.

U-Boot one-shot
---------------
$(storage_preamble)
$(storage_load "${script_addr}" boot.scr)
source ${script_addr}

Success criteria
----------------
The serial console should show Xen parsing the mutated /chosen node and booting
one or more dom0-less Linux domains with kernel + initramfs modules.

domU1 eth0 passthrough (optional)
---------------------------------
ENABLE_DOMU1_ETH_PASSTHROUGH=${domu1_eth_passthrough}. Set it to 1 to compile
DOMU1_ETH_DTS (${domu1_eth_dts}) with dtc, copy it as DOMU1_ETH_DTB_NAME
(${domu1_eth_dtb_name}), load it at DOMU1_ETH_DTB_LOAD_ADDR
(${domu1_eth_dtb_load_addr}), and register it under /chosen/domU1 as a
multiboot,device-tree module.

This is trusted no-IOMMU lab plumbing. GMAC0 is assigned with
xen,force-assign-without-iommu, so the guest must be trusted: the NIC can DMA
to machine addresses. Before real traffic, set DOMU1_STATIC_MEM_START and
DOMU1_STATIC_MEM_SIZE and use DOMU1_DIRECT_MAP=1 so guest physical RAM, DMA
buffers, and ccache physical cache-maintenance addresses are identical. The Xen
branch must expose/route Megrez PLIC IRQ 61 to domU1 and provide the ccache
IRQ/MMIO path; an eth0 probe without working PLIC/cache support is not a valid
UP test.

Notes
-----
Core default filenames are 8.3-safe for FAT. If the board/user-proven path
requires the historical long Xen name, regenerate with XEN_DEPLOY_NAME=xen.uImage;
otherwise copy the payload host-side to avoid Linux initramfs FAT/NLS aliasing.
The opt-in DOMU1_ETH_DTB_NAME default follows ADR 0003 (${domu1_eth_dtb_name});
override it if your FAT/U-Boot path needs an 8.3-safe DTB filename.
EOF
}

main() {
    validate_options
    require_command cp
    require_command install
    require_command mkimage
    require_command stat
    if [ "${domu1_eth_passthrough}" = "1" ]; then
        require_command dtc
    fi
    require_file "${xen_raw}"
    require_file "${board_dtb}"
    require_file "${domu1_kernel}"
    if [ -n "${domu1_ramdisk}" ]; then
        require_file "${domu1_ramdisk}"
    fi
    if [ -n "${domu2_kernel}" ] || [ -n "${domu2_ramdisk}" ]; then
        if [ -z "${domu2_kernel}" ] || [ -z "${domu2_ramdisk}" ]; then
            fail "DOMU2_KERNEL/DOMU2_IMAGE and DOMU2_RAMDISK must be set together"
        fi
        require_file "${domu2_kernel}"
        require_file "${domu2_ramdisk}"
    fi
    if [ "${domu1_eth_passthrough}" = "1" ]; then
        require_file "${domu1_eth_dts}"
    fi

    log "preparing ${output_dir}"
    rm -rf -- "${output_dir}"
    mkdir -p -- "${output_dir}"

    install -m 0644 "${board_dtb}" "${output_dir}/board.dtb"
    install -m 0644 "${domu1_kernel}" "${output_dir}/domu1.img"
    if [ -n "${domu1_ramdisk}" ]; then
        install -m 0644 "${domu1_ramdisk}" "${output_dir}/domu1.rd"
    fi
    if [ -n "${domu2_kernel}" ] && [ -n "${domu2_ramdisk}" ]; then
        install -m 0644 "${domu2_kernel}" "${output_dir}/domu2.img"
        install -m 0644 "${domu2_ramdisk}" "${output_dir}/domu2.rd"
    fi
    if [ "${domu1_eth_passthrough}" = "1" ]; then
        log "compiling domU1 eth0 passthrough DTB ${domu1_eth_dtb_name}"
        dtc -I dts -O dtb -o "${output_dir}/${domu1_eth_dtb_name}" "${domu1_eth_dts}"
    fi


    log "wrapping Xen as ${xen_deploy_name}"
    mkimage -A RISCV -T kernel -a "${xen_load_addr}" -e "${xen_load_addr}" \
        -C none -d "${xen_raw}" "${output_dir}/${xen_deploy_name}" >/dev/null


    write_boot_cmd "${output_dir}/boot.cmd"
    log "generating boot.scr"
    mkimage -A riscv -T script -C none -n 'Megrez Xen dom0-less smoke' \
        -d "${output_dir}/boot.cmd" "${output_dir}/boot.scr" >/dev/null

    write_readme "${output_dir}/README.txt"

    log "board Xen smoke payload ready in ${output_dir}"
    find "${output_dir}" -maxdepth 1 -mindepth 1 -print | sort
    cat <<EOF

Next on the board U-Boot console:
  $(storage_preamble)
  $(storage_load "${script_addr}" boot.scr)
  source ${script_addr}
EOF
}

main "$@"
