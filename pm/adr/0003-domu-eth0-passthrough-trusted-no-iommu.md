# ADR 0003 — Xen/RISC-V: eth0 domU passthrough trusted no-IOMMU

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** vzaccaria
- **Context tracker:** fused bead `polimi-aos-megrez-eth0-sju.1`, merged bead `polimi-aos-megrez-eth0-sju.3`

## Contesto

L'obiettivo utile della Fase 3 non è solo rendere visibile un nodo DT nel guest,
ma portare `eth0` **UP** in un domU Xen dom0-less sul Milk-V Megrez/EIC7700X,
usando il driver BSP esistente `dwmac-win2030` (`compatible =
"eswin,win2030-qos-eth"`) e il GMAC0 della board (`ethernet@50400000`, IRQ
PLIC 61).

Fatti accertati:

- Il GMAC0 non è dietro un IOMMU utilizzabile dal fork Xen/RISC-V corrente; il
  DT BSP ha la property `iommus` commentata per i GMAC.
- La NIC DMA-a verso indirizzi macchina. Quindi il domU deve usare RAM
  **static direct-map** (`guest physical == machine physical`) prima di fare
  traffico reale.
- Il BSP marca il GMAC come `dma-noncoherent`; le cache maintenance ops usano il
  controller ccache scrivendo indirizzi fisici. Anche questo richiede direct-map.
- Il target Megrez usa PLIC legacy (`sifive,plic-1.0.0`), non AIA/APLIC/IMSIC.
  Le serie recenti di Oleksii Kurochko per Xen/RISC-V migliorano dom0less e IRQ
  routing, ma sono orientate ad APLIC/IMSIC e non sono un drop-in per Megrez.
- Xen non virtualizza semanticamente `syscon`, CRG, pinctrl o ccache: il
  meccanismo idiomatico ARM/dom0less è descriverli in un partial DT e mappare
  MMIO/IRQ al guest con `xen,reg`, `xen,path`, interrupt routing e, se manca
  IOMMU, `xen,force-assign-without-iommu` + direct-map. Questo è potente ma
  trusted-only.

## Decisione

Fondere lo scope `sju.1` + `sju.3`: il bead attivo diventa il bring-up
funzionale di `eth0` nel domU, non un task DTS-only.

Scelte architetturali:

1. **Trusted no-IOMMU bring-up**: accettiamo che il domU sia trusted e che il
   device possa DMA-are senza protezione IOMMU. L'hardening/IOMMU vero resta
   lavoro futuro.
2. **Static direct-map obbligatorio**: implementare/abilitare per RISC-V la
   semantica `xen,static-mem` + `direct-map` già idiomatica su ARM, così RAM
   guest, DMA buffer e CMO fisiche coincidono.
3. **PLIC legacy come target Megrez**: portare o implementare il path PLIC guest
   necessario alla board: nodo interrupt-controller guest con phandle valido,
   vPLIC/PLIC MMIO sufficiente a Linux, routing IRQ fisico→guest per GMAC0 IRQ
   61 e per gli IRQ ccache necessari.
4. **Partial DTB per il passthrough**: generare e caricare via U-Boot un
   `multiboot,device-tree` per domU1 che descriva GMAC0, syscon/CRG/pinctrl
   minimi e ccache, usando `xen,reg`/`xen,path`.
5. **Syscon/CRG/pinctrl/ccache in passthrough minimale**: per il primo bring-up
   mappare i registri necessari al driver. Questa scelta dà al guest accesso a
   blocchi globali del SoC ed è accettabile solo nel profilo trusted-lab.
6. **Non mascherare la coerenza DMA**: non rimuovere `dma-noncoherent` per far
   avanzare il probe; prima del traffico devono essere provati direct-map e
   ccache/cache ops.
7. **Ambiente completamente riproducibile**: build Xen, compilazione partial
   DTB, wrapping `mkimage` e generazione `boot.scr` devono passare dal container
   `polimi-aos-megrez-build-env:linux-aarch64` tramite i target `make`, non da
   tool host opportunistici.


## Conseguenze

**Positive**

- Il criterio di successo diventa reale: `eth0` presente, `ip link set eth0 up`,
  IRQ osservabili e traffico quando il link fisico è disponibile.
- Il piano segue l'idioma Xen ARM per device assignment no-IOMMU: partial DT,
  `xen,reg`, `xen,path`, interrupt routing e static direct-map.
- Le serie upstream-ish di Oleksii restano utili come riferimento/cherry-pick per
  IRQ ownership/routing, ma non bloccano il lavoro Megrez PLIC.

**Negative / rischi**

- Sicurezza: senza IOMMU, il guest può programmare DMA fuori dalla sua RAM. Il
  profilo è trusted-lab, non isolamento robusto.
- CRG, pinctrl, syscon e ccache sono globali; passarli al domU espone controllo
  hardware ampio. Un design sicuro richiederebbe emulazione/filtro o IOMMU.
- Il path PLIC RISC-V è più specifico del path APLIC/IMSIC recente upstream e va
  mantenuto/validato sulla board reale.
- Il bring-up dipende dall'hardware Megrez: QEMU `virt` non emula GMAC0 né le
  dipendenze board.
- Il repo wrapper deve pinnare il branch Xen dedicato
  `refs/heads/megrez-domu-eth0-passthrough`, perché le modifiche Xen vivono nel
  fork `https://gitlab.com/vittorio.zaccaria/xen.git` e non in `stage/`.


## Alternative considerate

- **Chiudere `sju.1` come DTS-only e lasciare `sju.3` separato**: scartato. Un
  DT visibile nel guest non dimostra `eth0 UP` e nasconde i veri prerequisiti
  Xen/RISC-V.
- **Usare wholesale il branch `olkur/riscv-dom0less-enablement-v5`**: scartato
  come drop-in. È più moderno per dom0less/IRQ routing, ma orientato ad
  AIA/APLIC/IMSIC; Megrez usa PLIC legacy e direct-map RISC-V resta da fare.
- **IOMMU/SMMU-first**: scartato per il primo bring-up. È più sicuro, ma molto
  più ampio; inoltre il path ccache/CMO fisico richiede comunque indirizzi
  macchina coerenti o ulteriore emulazione/traduzione.
- **Rimuovere `dma-noncoherent` o stubbare cache ops**: scartato perché produce
  falsi positivi e può causare corruzione DMA silenziosa.

## Verifica attesa

1. DomU1 boot stabile con RAM static direct-map.
2. Partial DTB `domu1-eth0.dtb` caricato come `multiboot,device-tree`.
3. Guest DT contiene GMAC0, interrupt-controller PLIC valido, syscon/CRG/pinctrl
   minimi e ccache.
4. Xen route-a GMAC0 IRQ 61 al domU; `/proc/interrupts` cresce.
5. Il driver `dwmac-win2030` registra `eth0`.
6. `ip link set eth0 up` riesce senza Xen panic, kernel OOPS o timeout DMA
   fatale.
7. Con link fisico disponibile, DHCP o ping statico funziona e i contatori RX/TX
   crescono.
