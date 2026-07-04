# polimi-aos-megrez-eth0 — State

Updated: 2026-07-04

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.4` `make board-xen-smoke` (smoke-test non-MCP del boot Xen su board, P2);
   `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Driver esistente
   funzionante in passthrough. Open: `sju.1` DT passthrough NIC eic7700 al domU;
   `sju.2` boot Xen→domU sul Megrez; `sju.3` NIC up nel domU sotto Xen; `sju.4`
   loop agente HW (delta SD via UART → reset → observe).

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-04 · assistant

Done: pivoted `60f.4` from QEMU to board-first Xen smoke; added
`scripts/board-xen-smoke.sh` + `make board-xen-smoke`, using the board-proven
U-Boot flow (`mkimage -A RISCV ... xen.uImage`, DTB at `0x94200000`, Xen at
`0x95200000`, Linux domU kernel+initramfs modules, `vsbi_uart`). Recorded bd
memories for the U-Boot script and mkimage CLI; updated PM readme and ADR.
State: script `--help`, `bash -n`, `make -n board-xen-smoke`, fake two-domU
generation, and real staged Linux `Image`+initramfs generation with fake Xen
passed. Board Linux/SD preflight passed after user reset. Next: 1) build/provide
`stage/src/xen/xen/xen` and the board DTB 2) use
existing `make build-artifacts` outputs (`stage/Image`, `stage/initramfs.cpio.gz`)
3) run `make board-xen-smoke`, copy `stage/board-xen-smoke/` to USB, then
`usb start; load usb 0 0x88100000 boot.scr; source 0x88100000`. Gotchas:
`xen.uImage` uses user-proven uppercase `RISCV` mkimage form; FAT/NLS exposes
8.3 aliases, so USB/ext4 or fallback `xen.uimg` avoids alias traps. Blockers:
real Xen raw binary and user-proven board DTB are not present in this checkout.
