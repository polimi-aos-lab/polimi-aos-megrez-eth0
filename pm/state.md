# polimi-aos-megrez-eth0 — State

Updated: 2026-07-10

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. `sju.1`
   chiuso: DT/passthrough GMAC0 e profili build verificati. Open: `sju.2` boot
   Xen→domU; `sju.4` loop agente HW; `sju.11` DMA risolto, RX/IRQ61 pendente.

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-10 · assistant

State: `sju.11` in progress. Il partial DTB ora mappa 1:1 l'alias uncached
EIC7700 `0xc020000000-0xc03fffffff` della RAM static direct-map del domU.
Verificato su board: Xen crea 131072 entry p2m; `ip link set eth0 up` non panica
più e raggiunge carrier 1Gbps/Full. Payload rigenerato con
`make board-xen-smoke` per TFTP.

Residuo: TX DMA funziona (il Mac host impara il MAC guest via ARP), ma guest
RX=0 e `/proc/interrupts` mostra IRQ61=0; DHCP e ping LAN falliscono. Il PLIC
guest è correttamente emulato: va verificato il forwarding IRQ fisico 61 da Xen
al vPLIC, non passato il PLIC fisico. WARN runtime-PM chiarito: partial DT senza
`tbus` porta `win2030_tbu_power()` a `WARN_ON`; non usare il falso sentinel
`0xf00`. Evidenze e log esatti nelle note `bd show …-sju.11`.

Next: 1) tracciare claim/enable IRQ61 nel PLIC fisico Xen 2) verificare
`do_IRQ`→`vplic_inject_irq` 3) risolvere policy TBU no-IOMMU, poi DHCP/ping.
Blockers: nessuno; board lasciata al prompt domU con eth0 UP/IP statico.
