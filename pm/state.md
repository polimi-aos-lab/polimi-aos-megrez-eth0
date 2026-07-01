# polimi-aos-megrez-eth0 — State

Updated: 2026-07-01

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-dvq` — Fase 1: build-env + baseline kernel BSP. Toolchain prebuilt +
   kernel BSP con `dwmac-eic7700`, boot su Megrez con NIC up. Open:
   `dvq.2` fetch-sources (rockos-kernel/u-boot, xen fork, ref pinnati);
   `dvq.3` config kernel `CONFIG_DWMAC_EIC7700=m`; `dvq.4` build-artifacts →
   stage/; `dvq.5`
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

Done: `dvq.1` closed. Dockerfile now defines a build-env only image on
Debian bookworm using native Debian `gcc-riscv64-linux-gnu` packages (multi-arch
friendly), not Bootlin tarballs; `makefile` now builds/enters/checks the build
env; `scripts/bootstrap.sh` removed. Verification: amd64 image build passed;
`toolchain-check` found `riscv64-linux-gnu-gcc`, `dtc`, `mkimage`,
`qemu-system-riscv64`; forbidden legacy strings absent. State: `dvq.2` next
(fetch pinned rockos-kernel/u-boot/xen). Gotchas: local x86 host lacks arm64
binfmt, so `--platform linux/arm64` fails here at `/bin/sh` with Exec format
error; should build natively on M2 / any linux-arm64 builder. QEMU non emula la
NIC eic7700; MCP single-backend `board`; macOS container non vede USB seriale.
Blockers: none.
