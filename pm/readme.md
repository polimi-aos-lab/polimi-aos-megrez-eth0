# polimi-aos-megrez-eth0

## Purpose

Build/test loop for **Xen + Linux on RISC-V** targeting **Milk-V Megrez
(ESWIN EIC7700X)**. The board already has U-Boot; this repo only prepares
payloads/boot scripts. Goals: bring up BSP Ethernet (`DWMAC_WIN2030`) on Linux
bare, then pass the NIC to a Xen dom0-less domU, with a native host MCP loop over
the real board UART. QEMU is optional diagnostic support only.

## Architecture

Decisions: `pm/adr/0001-architettura-build-env-e-mcp.md`.

- **build-env**: multi-arch container with prebuilt `riscv64-linux-gnu`
  toolchain; emits portable RISC-V artifacts (`Image`, modules, Xen, DTB,
  initramfs). Rebuild per host; do not `docker save` x86 images for Mac.
- **MCP**: TypeScript/Node running natively on the host; typed
  `deploy/boot/run/observe/reset`, real `board` backend over UART/ymodem, mock
  backend for offline serial scenarios.
- **Xen smoke**: board-first U-Boot/SD payload (`board-xen-smoke`); QEMU `virt`
  does not emulate the real NIC and is not the hardware gate.

Sources pinned in `sources.lock`: BSP kernel `milkv-megrez/rockos-kernel`; Xen
`gitlab.com/vittorio.zaccaria/xen` branch `latest`; BusyBox/lrzsz tarballs.

## Build & test

- `make build-container` — Docker build image (`TAG`/`PLATFORM` overrideable).
- `make fetch-sources` — materialize pinned sources under `stage/src/`.
- `make build-artifacts` — build Linux `Image(.gz)`, modules, initramfs, DTB.
- `make build-xen` — build raw Xen and copy it to `stage/xen`.
- `make assemble-boot` — create SD/U-Boot Linux payload in `stage/boot/`.
- `make board-xen-smoke` — create SD/U-Boot Xen dom0-less smoke payload in
  `stage/board-xen-smoke/` (default `BOOT_IFACE=mmc BOOT_DEV=1 BOOT_PART=1`).

## Conventions

- Kernel baseline = BSP `win2030_defconfig` + `config/kernel/eic7700-eth.fragment`
  (`STMMAC_ETH=m`, `STMMAC_PLATFORM=m`, `DWMAC_WIN2030=m`, `MAGIC_SYSRQ=y`,
  headless wired baseline; no DRM/media/audio/wireless/firewall/noisy extras).
- Megrez NIC uses BSP `DWMAC_WIN2030` (`dwmac-win2030.c`, compatible
  `eswin,win2030-qos-eth`), not newer upstream `DWMAC_EIC7700`.
- Board reset = SBI SRST + magic SysRq over serial (`panic=-1`); cannot recover
  wedges with IRQs off.
- macOS containers do not see the USB serial; MCP must run natively on host.
