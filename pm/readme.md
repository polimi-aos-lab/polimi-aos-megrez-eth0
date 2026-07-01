# polimi-aos-megrez-eth0

## Purpose

Ambiente di build e loop di sviluppo per un sistema **u-boot + Xen + Linux su
RISC-V**, mirato alla board **Milk-V Megrez (SoC ESWIN EIC7700X)**. Due obiettivi:

1. Sviluppare/verificare il **driver ethernet** della NIC del Megrez
   (Synopsys DesignWare, driver `dwmac-eic7700`, `CONFIG_DWMAC_EIC7700`) e
   farlo funzionare **in passthrough sotto Xen dom0-less**.
2. Fornire un **server MCP** che permetta a un agente di deployare cambiamenti,
   eseguirli e osservare il risultato, ciclando finché il driver non funziona —
   sia su **QEMU** (emulazione) sia sulla **board reale** (via UART).

Il server x86 (questo host) è il **builder**; il target d'uso finale è un
laptop **macOS Apple Silicon (M2)**.

## Architecture

Vedi ADR: [`pm/adr/0001-architettura-build-env-e-mcp.md`](adr/0001-architettura-build-env-e-mcp.md).

Sintesi:

- **build-env container** (multi-arch, toolchain **prebuilt**): produce artefatti
  RISC-V (Image kernel, moduli `.ko`, binario Xen, DTB dom0-less, initramfs).
  Gli artefatti sono **indipendenti dall'architettura dell'host** → si spostano
  x86 → Mac copiando file, senza rebuild e senza emulazione.
- **MCP server** (TypeScript/Node, **nativo sull'host** — su macOS il container
  non vede la seriale USB): un'unica interfaccia `deploy/boot/run/observe/reset`
  con due backend:
  - `qemu`: `qemu-system-riscv64 -M virt`, seriale su pty, `virtio-net`.
  - `board`: `ymodem` su UART, boot via `bootcmd` u-boot esistente.

Layout previsto:

```
Dockerfile            # SOLO build-env: prebuilt toolchain + qemu + dtc + u-boot-tools
makefile              # build-env | artifacts | qemu-run | mcp-serve
scripts/
  fetch-sources.sh    # clone pinned: rockos-kernel, rockos-u-boot, xen fork
  build-artifacts.sh  # Image + moduli + xen + dtb + initramfs -> stage/
  assemble-boot.sh    # layout boot SD + boot.scr / FIT dom0-less
config/
  kernel/             # defconfig BSP + frammento DWMAC_EIC7700
  dts/                # DT dom0-less: xen, domU, passthrough NIC
mcp/
  server.ts
  backends/{qemu.ts,board.ts}
  transport/{ymodem.ts,serial.ts}
stage/                # output artefatti (gitignored)
```

## Sorgenti upstream (pinned)

- Kernel BSP + u-boot + opensbi: `github.com/milkv-megrez`
  (`rockos-kernel`, `rockos-u-boot`, `rockos-opensbi`, `megrez-build`).
  Upstream vendor: `github.com/eswincomputing`
  (`linux-stable`, `u-boot-2024.01-EIC7X`, `opensbi`).
- Xen dom0-less RISC-V: `gitlab.com/vittorio.zaccaria/xen` (mirror di
  `xen-project/people/olkur/xen`, branch `staging`).
- Toolchain prebuilt: Bootlin (host x86_64 e aarch64) oppure
  `gcc-riscv64-linux-gnu` dei repo distro.

## Build & Run

WIP (Fase 1). Vedi `plan.md` e i beads per lo stato corrente.

## Key conventions

- Gli **artefatti** (riscv) sono portabili; l'**ambiente di build** è host-specifico
  e va **ricostruito** sul Mac (veloce con toolchain prebuilt), NON trasferito via
  `docker save` (girerebbe emulato).
- Kernel = **BSP vendor** (contiene `dwmac-eic7700`), NON mainline 6.4.16
  (che ne è privo — il vecchio flow del Dockerfile è codice morto da rimuovere).
- Reset board: **SBI SRST + magic SysRq over serial** come primario
  (`panic=-1`); recupera panic/hang morbidi, NON un wedge totale con IRQ off.
- QEMU **non emula** la NIC eic7700 (solo `virtio-net`): il loop del *driver reale*
  vive **solo su hardware**; QEMU serve per catena di boot, meccanica Xen/DT, e
  sviluppo a secco dell'MCP.
