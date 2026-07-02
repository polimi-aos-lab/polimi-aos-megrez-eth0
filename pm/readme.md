# polimi-aos-megrez-eth0

## Purpose

Ambiente di build e loop di sviluppo per **Xen + Linux su RISC-V**, mirato al
**Milk-V Megrez (SoC ESWIN EIC7700X)**. La board ha già u-boot: non lo
ricompiliamo, lo usiamo solo per `bootcmd`/boot script. Due obiettivi: (1) far
funzionare il **driver ethernet** della NIC (nel BSP: `DWMAC_WIN2030` /
`dwmac-win2030.c`) su Linux bare e poi **in passthrough sotto Xen dom0-less**;
(2) un **server MCP** con cui un agente deploya, esegue, osserva e cicla — su
**QEMU** e sulla **board reale** via UART.
Host builder = questo server x86; target d'uso = laptop macOS Apple Silicon M2.

## Architecture

Decisioni e trade-off: `pm/adr/0001-architettura-build-env-e-mcp.md`. Boundary:

- **build-env** (container multi-arch, toolchain **prebuilt**): produce artefatti
  RISC-V (Image, moduli `.ko`, Xen, DTB dom0-less, initramfs). Artefatti
  arch-independent → x86→Mac per copia; build-env host-specifico → si ricostruisce
  (non `docker save`).
- **MCP** (TypeScript/Node, **nativo sull'host**): interfaccia unica
  `deploy/boot/run/observe/reset`, backend reale `board` (ymodem su UART,
  bootcmd u-boot esistente), mock seriale pty per dev offline. QEMU resta solo
  smoke-test non-MCP del boot Xen (`-M virt`, virtio-net).

Sorgenti pinnate (ref in `sources.lock`, materializzate da `scripts/fetch-sources.sh`):
BSP kernel `github.com/milkv-megrez/rockos-kernel`; Xen `gitlab.com/vittorio.zaccaria/xen`
branch `latest` (mirror `olkur/xen`, dom0-less); toolchain prebuilt Bootlin / `gcc-riscv64-linux-gnu`.

## Build & test

1. `make build-container` — builds the Docker build image (`TAG`/`PLATFORM`
   overrideable).
2. `make fetch-sources` — materializes pinned git/tar sources under
   `stage/src/` through Docker.
3. `make build-artifacts` — through Docker, emits `stage/Image(.gz)`,
   `stage/modules/`, `stage/dwmac-win2030.ko`, `stage/initramfs.cpio.gz`, and
   `stage/eic7700-milkv-megrez.dtb`.
4. `make assemble-boot` — creates `stage/boot/` with `boot.scr`, boot payload,
   NIC-capable initramfs, and SD/U-Boot instructions.

## Conventions

- Kernel config = BSP vendor `win2030_defconfig` + delta
  `config/kernel/eic7700-eth.fragment`. Il defconfig è la baseline Milk-V/ESWIN;
  il frammento tiene solo il delta locale: `STMMAC_ETH=m`,
  `STMMAC_PLATFORM=m`, `DWMAC_WIN2030=m`, `MAGIC_SYSRQ=y`, `BCMDHD=n`
  (AP12275 Wi-Fi incompleto nel checkout). La NIC Megrez usa `DWMAC_WIN2030`
  (`dwmac-win2030.c`, compatible `eswin,win2030-qos-eth`), non l'upstream
  recente `DWMAC_EIC7700`.
- QEMU **non emula** la NIC eic7700 (solo virtio-net): driver reale testabile
  **solo su HW**; QEMU per catena di boot, meccanica Xen/DT, MCP a secco.
- Reset board: **SBI SRST + magic SysRq over serial** (`panic=-1`); non recupera
  wedge totali con IRQ off.
- Su macOS il container non vede la seriale USB → l'MCP gira nativo sull'host.
