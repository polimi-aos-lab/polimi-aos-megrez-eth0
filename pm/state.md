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
`scripts/build-xen.sh` + `make build-xen` for raw Xen and
`scripts/board-xen-smoke.sh` + `make board-xen-smoke` for the board-proven U-Boot
flow (`mkimage -A RISCV ... xen.img` by default, DTB at `0x94200000`, Xen at
`0x95200000`, Linux domU kernel+initramfs modules, `vsbi_uart`). Recorded bd
memories for the U-Boot script and mkimage CLI; updated PM readme and ADR.
State: `bash -n`, script `--help`, `make -n build-xen`, `make -n board-xen-smoke`,
fake two-domU generation, and real staged Linux `Image`+initramfs generation with
fake Xen passed. Board Linux/SD preflight passed after user reset. Next:
1) `make build-container fetch-sources build-artifacts build-xen` 2) provide the
user-proven board DTB if different from `stage/eic7700-milkv-megrez.dtb`
3) `make board-xen-smoke`, host-copy `stage/board-xen-smoke/` to the SD boot
partition, then `mmc dev 1; load mmc 1:1 0x88100000 boot.scr; source 0x88100000`.
Gotchas: uppercase `RISCV` mkimage form; FAT/NLS exposes 8.3 aliases, so copy
host-side and keep default `xen.img` unless regenerating with `XEN_DEPLOY_NAME=xen.uImage`.
Blockers: user-proven board DTB is not present in this checkout.
