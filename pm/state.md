# polimi-aos-megrez-eth0 — State

Updated: 2026-07-04

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.4` `make qemu-xen-smoke` (smoke-test non-MCP del boot Xen, P2);
   `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Driver esistente
   funzionante in passthrough. Open: `sju.1` DT passthrough NIC eic7700 al domU;
   `sju.2` boot Xen→domU sul Megrez; `sju.3` NIC up nel domU sotto Xen; `sju.4`
   loop agente HW (delta SD via UART → reset → observe).

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-04 · assistant

Done: closed `60f.1`, `60f.2`, `60f.3`. Added `mcp/` TypeScript MCP
server (SDK v1 stdio) with typed tools `acquire/release/deploy/boot/run/observe/reset/collect_logs`,
lease+mutex session, structured results/log refs, real `board` backend using
`serialport` for `/dev/tty.usbmodem2102` 115200 8N1, semantic U-Boot/Linux/panic
observe, boot via existing `bootcmd`, shell run marker parsing, sd-copy deploy
verification, minimal YMODEM sender, and `mock` backend for offline scripted
serial scenarios. State: `npm test` 5 files/28 tests passed; `npm run
typecheck` and `npm run build` passed; MCP stub+mock stdio smokes passed. Next:
1) `60f.4` qemu Xen smoke target 2) `60f.5` reset policy (SBI/SysRq, degraded
paths) 3) hardware smoke with `MCP_BACKEND=board`. Gotchas: mock uses an
in-process serial seam, not a real PTY; reset is intentionally still deferred.
Blockers: none.
