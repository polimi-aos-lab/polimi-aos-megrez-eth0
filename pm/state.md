# polimi-aos-megrez-eth0 — State

Updated: 2026-07-02

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-dvq` — Fase 1: build-env + baseline kernel BSP. Toolchain prebuilt +
   kernel BSP con glue Ethernet vendor `DWMAC_WIN2030`, boot su Megrez con NIC
   up. Open: `dvq.5` assemble-boot + bootcmd, NIC up (`ip link`).
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

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-02 · assistant

Done: `dvq.5` host-side boot assembly implemented: `scripts/assemble-boot.sh`
generates `stage/boot/` with `boot.scr`, boot payload, NIC-capable initramfs,
and serial/U-Boot instructions; `make assemble-boot` and `docs/megrez-boot.md`
added. Verified locally: shell syntax, script generation, `mkimage -l`, and
initramfs archive contains `dwmac-win2030.ko` + `/root/nic-bringup.sh`. State:
code working, HW acceptance pending. Next: 1) copy `stage/boot/.` to Megrez SD
partition 1 2) one-shot boot via UART `load/source` 3) run `/root/nic-bringup.sh`
and capture `ip link`/ping. Gotchas: no serial device visible in this session;
QEMU cannot test EIC7700 NIC. Blockers: board/UART hardware verification.
