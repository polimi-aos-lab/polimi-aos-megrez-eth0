# polimi-aos-megrez-eth0 — State

Updated: 2026-07-01

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-dvq` — Fase 1: build-env + baseline kernel BSP. Toolchain prebuilt +
   kernel BSP con `dwmac-eic7700`, boot su Megrez con NIC up. Open:
   `dvq.1` riscrivere Dockerfile (prebuilt, via 6.4.16); `dvq.2` fetch-sources
   (rockos-kernel/u-boot, xen fork, ref pinnati); `dvq.3` config kernel
   `CONFIG_DWMAC_EIC7700=m`; `dvq.4` build-artifacts → stage/; `dvq.5`
   assemble-boot + bootcmd, NIC up (`ip link`).
2. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.1` scheletro MCP TS single-backend
   (deploy/boot/run/observe/reset); `60f.2` backend board (ymodem UART, observe
   /dev/tty, boot bootcmd); `60f.3` mock seriale pty per dev offline; `60f.4`
   `make qemu-xen-smoke` (smoke-test non-MCP del boot Xen, P2); `60f.5` reset()
   SBI-SRST/SysRq (panic=-1, sysrq).
3. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Driver esistente
   funzionante in passthrough. Open: `sju.1` DT passthrough NIC eic7700 al domU;
   `sju.2` boot Xen→domU sul Megrez; `sju.3` NIC up nel domU sotto Xen; `sju.4`
   loop agente HW (delta SD via UART → reset → observe).

Decisione: `…-18y` ADR 0001 (Accepted, `pm/adr/0001`).

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-01 · assistant

Done: bootstrap PM `bare` + beads (Dolt SSOT, export off); 3 epic + 14 beads;
ADR 0001 (`…-18y`). Migrato al formato `state.md`. State: solo PM/ADR, nessun
codice ambiente toccato; Dockerfile attuale = flow legacy (toolchain
from-source + 6.4.16 senza driver) + `scripts/bootstrap.sh` morto, da rimuovere
in Fase 1. Next: 1) verificare ref/branch + defconfig di `rockos-kernel` per il
Megrez; 2) confermare cosa carica l'u-boot on-board (FIT vs Image+DTB); 3)
aprire Fase 1 e riscrivere il Dockerfile su toolchain prebuilt. Gotchas: QEMU
non emula la NIC eic7700 → NON è un backend MCP, solo smoke-test del boot Xen;
MCP single-backend `board` + mock seriale per dev offline; su macOS il container
non vede la seriale USB → MCP nativo sull'host; artefatti RISC-V portabili (copia),
build-env host-specifico (rebuild, non `docker save`); `bd bootstrap` va in
timeout sul pull di rete (remote senza storia Dolt) ma il DB locale è usabile.
Blockers: none.
