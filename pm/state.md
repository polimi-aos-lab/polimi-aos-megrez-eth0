# polimi-aos-megrez-eth0 — State

Updated: 2026-07-04

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Driver esistente
   funzionante in passthrough. Open: `sju.1` DT passthrough NIC eic7700 al domU;
   `sju.2` boot Xen→domU sul Megrez; `sju.3` NIC up nel domU sotto Xen; `sju.4`
   loop agente HW (delta SD via UART → reset → observe).

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-04 · assistant

Done: completed `60f.4` board-first Xen smoke path. Added
`scripts/build-xen.sh`/`make build-xen`, `scripts/board-xen-smoke.sh`/`make
board-xen-smoke`, and MCP U-Boot UART tools `uboot_run` + `uboot_fatwrite`
for paced CR commands, `loady`/YMODEM, `fatwrite`, and `fatls` verification.
State: `npm --prefix mcp run typecheck`, `npm --prefix mcp run build`,
`bash -n scripts/board-xen-smoke.sh`, and `scripts/board-xen-smoke.sh --help`
passed. Board preflight showed U-Boot from SD; copying `stage/board-xen-smoke/`
to the SD boot partition and sourcing `boot.scr` reaches Xen and creates domU1;
the current Linux domU then panics on RISC-V guest store handling, which belongs
to the Xen/domU phase (`…-sju`), not the transport/smoke plumbing. Next:
1) `60f.5` reset policy 2) `sju.2`/`sju.3` diagnose Linux domU under Xen.
Gotchas: close any `screen`/serial consumer before MCP UART tools; keep SD/FAT
updates host-side when possible; default `xen.img` avoids long-name FAT/NLS
aliasing, use `XEN_DEPLOY_NAME=xen.uImage` only if a board-proven path requires it.
Blockers: none for `60f.4`.
