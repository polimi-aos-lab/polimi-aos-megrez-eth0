# Session Handoff

Written: 2026-07-01 Author: assistant (session bootstrap)

## What was done this session

- Bootstrap PM workspace `bare` sotto `pm/` (readme, plan, handoff, adr/).
- Init beads DB, remote `origin` configurato, JSONL auto-export disabilitato
  (Dolt = SSOT).
- Seed roadmap: 3 epic (Fasi 1-3) + 14 beads figli.
  - Fase 1 `polimi-aos-megrez-eth0-dvq` (P0): build-env + baseline BSP.
  - Fase 2 `polimi-aos-megrez-eth0-60f` (P1): MCP + backend QEMU + transport.
  - Fase 3 `polimi-aos-megrez-eth0-sju` (P1): Xen dom0-less + passthrough.
- ADR 0001 scritto: `pm/adr/0001-architettura-build-env-e-mcp.md` (Accepted).

## Current state

- Solo PM/ADR. Nessun codice dell'ambiente ancora modificato.
- Dockerfile attuale = flow legacy (toolchain from-source + kernel 6.4.16 senza
  driver) + `scripts/bootstrap.sh` = codice morto. Da rimuovere in Fase 1.

## In progress

- (nessuno) — pronto a iniziare Fase 1.

## Blockers & open questions

- Verificare ref/branch esatti di `rockos-kernel` e defconfig BSP del Megrez
  prima di pinnarli in `fetch-sources.sh`.
- Confermare che u-boot on-board supporta i comandi/formati per caricare la
  catena (FIT vs Image+DTB) prima di scrivere `assemble-boot.sh`.

## Recommended next steps

1. Aprire Fase 1 (`bd update polimi-aos-megrez-eth0-dvq --status in_progress`).
2. Riscrivere il Dockerfile su toolchain prebuilt; rimuovere flow 6.4.16 e
   `scripts/bootstrap.sh`.
3. Scrivere `scripts/fetch-sources.sh` con ref pinnati del BSP + xen fork.

## Context the next agent should know

- Decisioni chiave e loro trade-off: vedi ADR 0001. In particolare: artefatti
  RISC-V portabili (copia file) vs build-env host-specifico (rebuild, non
  `docker save`); QEMU non emula la NIC eic7700 (driver reale solo su HW);
  MCP nativo sull'host su macOS (no seriale USB in container).
- `bd` usa Dolt embedded; il warning "dolt executable not found" è innocuo.
  `bd bootstrap` va in timeout sul pull di rete (remote senza storia Dolt): è
  atteso, il DB locale resta usabile.
