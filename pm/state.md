# polimi-aos-megrez-eth0 — State

Updated: 2026-07-02

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-dvq` — Fase 1: build-env + baseline kernel BSP. Toolchain prebuilt +
   kernel BSP con glue Ethernet vendor `DWMAC_WIN2030`, boot su Megrez con NIC
   up. Open: `dvq.4` build-artifacts → stage/; `dvq.5` assemble-boot +
   bootcmd, NIC up (`ip link`).
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

Done: `dvq.3` added `config/kernel/eic7700-eth.fragment` for the pinned BSP
`win2030_defconfig`: `STMMAC_ETH=m`, `STMMAC_PLATFORM=m`, `DWMAC_WIN2030=m`,
`MAGIC_SYSRQ=y`. Verified with BSP `merge_config.sh` in the build container;
final `.config` has those four requested values.
State: working; `dvq.4` next (kernel build artifacts under `stage/`). Gotchas:
the pinned 6.6.y BSP does **not** have upstream `CONFIG_DWMAC_EIC7700`; Megrez
Ethernet is `DWMAC_WIN2030` / `dwmac-win2030.c`, compatible
`eswin,win2030-qos-eth`. QEMU still cannot test the EIC7700 NIC. Blockers: none.
