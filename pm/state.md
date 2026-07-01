# polimi-aos-megrez-eth0 — State

Updated: 2026-07-01

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-dvq` — Fase 1: build-env + baseline kernel BSP. Toolchain prebuilt +
   kernel BSP con `dwmac-eic7700`, boot su Megrez con NIC up. Open:
   `dvq.3` config kernel `CONFIG_DWMAC_EIC7700=m`; `dvq.4` build-artifacts →
   stage/; `dvq.5` assemble-boot + bootcmd, NIC up (`ip link`).
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

Done: `dvq.2` implemented and verified. `sources.lock` pins
`rockos-kernel@f9057cdc4816276e8ffb15f263f25ba9bd5a077e`,
`rockos-u-boot@c9221cf2fa77d39c0b241ab4b030c708e7ebe279`, and
`xen@d0c75dc4c028bc32fd9cf1d4358973929548de54`; `scripts/fetch-sources.sh`
idempotently materializes them under ignored `stage/src/`; `make fetch-sources`
wraps the script. Verification: `bash -n`, `make -n fetch-sources`, local mock
idempotence smoke, real fetch twice, `rev-parse HEAD` matched all pins.
State: working; `dvq.3` next (kernel config fragment). Gotchas: pins are
current upstream branch tips resolved on 2026-07-01, not independently matched
against the image currently booted on the board; QEMU still cannot test eic7700.
Blockers: none.
