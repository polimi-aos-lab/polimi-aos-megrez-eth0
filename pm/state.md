# polimi-aos-megrez-eth0 — State

Updated: 2026-07-16

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Prossimo
   percorso principale: `sju.4` loop agente HW; difetti architetturali residui
   restano tracciati nei bead aperti dell'epic.
3. `…-cu5` — Future fixes. Correzioni differibili emerse dal bring-up Xen.
   Open: `sju.12` moduli non eseguibili; `sju.7` console; `sju.8` vSBI DBCN;
   `sju.9` root P2M Sv48x4; `sju.10` invalidazione GVMA.

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-16 16:00 CEST · assistant

Done: `…-hbn` ha spostato il package Node dal sottoprogetto `mcp/` al root,
inclusi server MCP, backend board/seriale/YMODEM e sei test; i sei script host
usano ora manifest e build root, i target Make sono `node-*`, e `mcp/` è stata
rimossa senza shim. State: working. `npm ci`, typecheck, build e 31/31 test
passano; i target Make equivalenti e gli smoke CLI degli script passano.
Next: 1) proseguire con `sju.4` sul payload Xen verificato 2) affrontare i fix
`cu5` secondo priorità. Gotchas: `uboot-ymodem-fatwrite.mjs` richiede prima
`make node-build`, perché importa `dist/src/backend/ymodem.js`. Blockers: none.
