# polimi-aos-megrez-eth0

## Purpose

Ambiente di build e loop di sviluppo per **u-boot + Xen + Linux su RISC-V**,
mirato al **Milk-V Megrez (SoC ESWIN EIC7700X)**. Due obiettivi: (1) far
funzionare il **driver ethernet** della NIC (`dwmac-eic7700`) su Linux bare e poi
**in passthrough sotto Xen dom0-less**; (2) un **server MCP** con cui un agente
deploya, esegue, osserva e cicla — su **QEMU** e sulla **board reale** via UART.
Host builder = questo server x86; target d'uso = laptop macOS Apple Silicon M2.

## Architecture

Decisioni e trade-off: `pm/adr/0001-architettura-build-env-e-mcp.md`. Boundary:

- **build-env** (container multi-arch, toolchain **prebuilt**): produce artefatti
  RISC-V (Image, moduli `.ko`, Xen, DTB dom0-less, initramfs). Artefatti
  arch-independent → x86→Mac per copia; build-env host-specifico → si ricostruisce
  (non `docker save`).
- **MCP** (TypeScript/Node, **nativo sull'host**): interfaccia unica
  `deploy/boot/run/observe/reset`, due backend — `qemu` (`-M virt`, pty,
  virtio-net) e `board` (ymodem su UART, bootcmd u-boot esistente).

Sorgenti pinnate (ref in `scripts/fetch-sources.sh`): BSP `github.com/milkv-megrez`
(`rockos-kernel/-u-boot/-opensbi`); Xen `gitlab.com/vittorio.zaccaria/xen`
(mirror `olkur/xen`, dom0-less); toolchain prebuilt Bootlin / `gcc-riscv64-linux-gnu`.

## Build & test

WIP (Fase 1). Vedi `state.md` e `bd ready` per lo stato corrente.

## Conventions

- Kernel = **BSP vendor** (ha `dwmac-eic7700`), non mainline 6.4.16 (privo del
  driver; vecchio flow Dockerfile = codice morto).
- QEMU **non emula** la NIC eic7700 (solo virtio-net): driver reale testabile
  **solo su HW**; QEMU per catena di boot, meccanica Xen/DT, MCP a secco.
- Reset board: **SBI SRST + magic SysRq over serial** (`panic=-1`); non recupera
  wedge totali con IRQ off.
- Su macOS il container non vede la seriale USB → l'MCP gira nativo sull'host.
