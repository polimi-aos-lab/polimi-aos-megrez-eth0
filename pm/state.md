# polimi-aos-megrez-eth0 — State

Updated: 2026-07-10

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.5` reset() SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Prossimo
   percorso principale: `sju.4` loop agente HW; difetti architetturali residui
   restano tracciati nei bead aperti dell'epic.

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-10 · assistant

State: datapath GMAC0 domU verificato end-to-end su board reale. La RAM static
direct-map `0xa0000000-0xbfffffff` e il suo alias uncached EIC7700
`0xc020000000-0xc03fffffff` sono entrambi nel p2m. Xen seleziona il contesto PLIC
S del boot hart (hart 2 → context 5), inoltra IRQ61 al vPLIC e il guest riceve
pacchetti. Cache maintenance non-coherent registrata dal ccache driver; il
profilo trusted no-IOMMU dichiara esplicitamente `tbus=<0xf00>`.

Verificato: carrier 1Gbps/Full, DHCP `192.168.188.50`, IRQ61 incrementale, RX/TX,
ping LAN 3/3. Payload pulito rigenerato e bootato da TFTP; assenti warning DMA,
WARN TBU e trace PLIC temporanei. Pin sorgenti aggiornati ai fork pubblicati.

Next: procedere col loop agente HW (`sju.4`) usando il payload Xen verificato.
Blockers: nessuno; board lasciata al prompt domU dopo boot del payload finale.
