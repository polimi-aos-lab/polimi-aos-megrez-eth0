# polimi-aos-megrez-eth0 — State

Updated: 2026-07-08

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. `sju.1`
   chiuso: DT/passthrough GMAC0 e profili build verificati; il bring-up runtime
   `ip link set eth0 up` è separato in `sju.11` (DMA fuori p2m). Open:
   `sju.2` boot Xen→domU sul Megrez; `sju.4` loop agente HW; `sju.11` DMA/p2m.

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-08 · assistant

State: `sju.1` e `sju.13` chiusi. Layout build corrente:
`stage/baremetal/` per no-Xen (`STMMAC/DWMAC=m`, `dwmac-win2030.ko`,
payload SD in `stage/baremetal/boot/`) e `stage/xen/` per domU Xen
(`STMMAC/DWMAC=y`, nessun `.ko` stale, raw Xen in `stage/xen/xen`, payload
TFTP in `stage/xen/board-xen-smoke/`). `makefile` default `JOBS ?= 1` e propaga
`JOBS` ai target build/image per non saturare la workstation.

Verified local gates: `build-artifacts.sh` baremetal con `JOBS=1`;
`build-artifacts.sh` xen con `JOBS=1`; `build-xen.sh` con `JOBS=1`;
`board-xen-smoke.sh` con `BOOT_IFACE=tftp`,
`ENABLE_DOMU1_ETH_PASSTHROUGH=1`, static-mem/direct-map; `board-baremetal-smoke.sh`
baremetal; `bash -n` sugli shell script modificati; `node --check
scripts/tftp-serve.mjs`; `make -n` sui target build/image.

Next blocker: `sju.11` (`ip link set eth0 up` causa panic Xen per store DMA
fuori p2m in profilo no-IOMMU direct-map).
