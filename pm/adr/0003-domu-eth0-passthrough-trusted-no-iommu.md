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
8. **Driver NIC built-in (=y), non modulo, sotto Xen**: nel domU del fork Xen
   RISC-V il testo dei moduli kernel caricati NON è eseguibile (instruction page
   fault a `<mod>+0x0`, es. `phy_init+0x0 [libphy]`; vedi `sju.12`). Quindi
   `STMMAC_ETH`/`STMMAC_PLATFORM`/`DWMAC_WIN2030` vanno compilati `=y` e il domU
   usa un initramfs minimale senza `insmod`. Il flow bare-metal (no-Xen) resta
   `=m` + initramfs con `megrez-net-up`: i due profili divergono e richiedono
   script/orchestratori di build separati (immagine no-Xen vs immagine Xen).
   `build-artifacts.sh` ora seleziona `PROFILE=baremetal|xen`, fonde un
   fragment base condiviso più l'override profilo, asserisce `=m` o `=y`
   secondo il profilo, e installa il `.ko` solo se prodotto.
9. **Console sincrona di default**: `sync_console` nei bootargs Xen
   (`bootscrub=0 com1=poll sched=null sync_console`, default in
   `board-xen-smoke.sh`). Senza, il ring `printk` non è flushato e le trap/panic
   del guest sono invisibili (falsi "hang" tipo `All set up`). Chiude `sju.7`.
10. **Phandle del partial DTB fuori dal range di Xen**: assegnare phandle
    espliciti alti (`0x8001`+) ai nodi del partial DT. Xen preserva ma NON
    rinumera i phandle del partial, che collidono con quelli generati per il
    guest (il PLIC guest ha phandle 2), rompendo la risoluzione
    `clocks`/`resets`/`syscon` (`of_find_node_by_phandle` risolve al nodo
    sbagliato → "could not find phandle 550").
11. **static-mem a 2 address + 2 size cells**: sotto `/chosen/domU1` Xen usa il
    formato parent/default (addr_cells=2, size_cells=2); `xen,static-mem` va
    emesso come `<0x0 base 0x0 size>` (4 celle), altrimenti `nr_banks=0` e panic
    "Size of memory property doesn't match".


## Conseguenze

**Positive**

- Il criterio di successo diventa reale: `eth0` presente, `ip link set eth0 up`,
  IRQ osservabili e traffico quando il link fisico è disponibile.
- Il piano segue l'idioma Xen ARM per device assignment no-IOMMU: partial DT,
  `xen,reg`, `xen,path`, interrupt routing e static direct-map.
- Le serie upstream-ish di Oleksii restano utili come riferimento/cherry-pick per
  IRQ ownership/routing, ma non bloccano il lavoro Megrez PLIC.
- **Stato provato su hardware (2026-07-08)**: con le decisioni 8–11 il domU boota
  pulito e `eth0` si REGISTRA sul GMAC0 passato (driver built-in `dwmac-win2030`,
  User ID 0x10/Synopsys 0x52, DWMAC4/5, MDIO + 2 PHY, `ip link` mostra `eth0`).
  Partial DTB, phandle, static-mem, direct-map e MMIO 1:1 sono validati end-to-end.

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
- DMA no-IOMMU ancora aperto (`sju.11`): `ip link set eth0 up` (stmmac_open) fa
  panicare Xen su store a `gpa` fuori dal p2m (memoria DMA/descrittori allocata
  fuori dalla finestra direct-map `0xa0000000-0xbfffffff`, `scause=17`,
  `p2m_mfn=0`). `eth0` si registra ma non si porta UP finché non è risolto.


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

## Procedura operativa board

La procedura di bring-up board per questo bead è TFTP-first, non SD/MMC:

1. Generare immagine Xen completa (domU kernel/rootfs + Xen + payload) dal
   container:
   ```sh
   BOOT_IFACE=tftp \
   ENABLE_DOMU1_ETH_PASSTHROUGH=1 \
   DOMU1_STATIC_MEM_START=0xa0000000 \
   DOMU1_STATIC_MEM_SIZE=0x20000000 \
   DOMU1_DIRECT_MAP=1 \
   make image-xen
   ```
   Equivalente esplicito: `make build-artifacts-xen`, `make build-xen`,
   quindi `make board-xen-smoke` con le stesse variabili.
2. Il payload domU deve usare il kernel compresso: `stage/xen/Image.gz` è
   copiato byte-per-byte in `stage/xen/board-xen-smoke/domu1.img`; `boot.cmd`
   deve riportare la size compressa del modulo kernel.
3. Avviare un solo server TFTP pulito dalla directory payload:
   ```sh
   node scripts/tftp-serve.mjs --root stage/xen/board-xen-smoke --port 69
   ```
4. In U-Boot impostare `serverip` sull'indirizzo IPv4 reale del Mac nella rete
   della board, non assumere che sia stabile. Il valore osservato oggi era
   `192.168.188.132`, mentre la board aveva `ipaddr=192.168.188.110`:
   ```text
   setenv serverip <host-ip>
   setenv ipaddr 192.168.188.110
   setenv autostart no
   tftpboot 0x88100000 boot.scr
   source 0x88100000
   ```
5. Se U-Boot mostra ancora tentativi `mmc`, quello è il distroboot/fallback della
   board o un payload generato prima; il payload corretto `BOOT_IFACE=tftp`
   contiene solo `tftpboot` per `board.dtb`, `xen.img`, `domu1.img`, `domu1.rd`
   e `domu1-eth0.dtb`.

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
