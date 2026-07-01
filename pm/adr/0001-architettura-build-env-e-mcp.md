# ADR 0001 — Architettura: build-env portabile + MCP a due backend

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** vzaccaria
- **Context tracker:** epics `polimi-aos-megrez-eth0-dvq`, `-60f`, `-sju`

## Contesto

Serve un ambiente per compilare **u-boot + Xen + Linux su RISC-V** e un loop di
sviluppo per far funzionare il **driver ethernet** della board **Milk-V Megrez
(SoC ESWIN EIC7700X)**, prima su Linux bare e poi **in passthrough sotto Xen
dom0-less**. Un agente deve poter deployare, eseguire, osservare e ciclare sia
su **QEMU** sia sulla **board reale** via **UART**.

Vincoli e fatti accertati:

- **Host builder = x86_64** (questo server); **target d'uso = macOS Apple
  Silicon M2 (arm64)**. Le due macchine hanno architetture diverse.
- **NIC del Megrez = Synopsys DesignWare** → driver `dwmac-eic7700`
  (`CONFIG_DWMAC_EIC7700`, compatible `eswin,eic7700-qos-eth`). Il driver è
  arrivato **upstream solo di recente** (mainline ~6.19/7.0); **non è nel kernel
  6.4.16** che builda il Dockerfile attuale. Sulla board gira via **BSP vendor**.
- **QEMU non ha un machine model EIC7700**: `-M virt` espone `virtio-net`, non la
  NIC reale. Il driver reale **non è esercitabile in emulazione**.
- Su **macOS, Docker/Podman non passano l'USB-seriale** nel container: la VM di
  Docker Desktop / `podman machine` non vede l'adattatore USB-UART dell'host.
- Il **reset via SBI SRST** richiede che qualcosa esegua l'`ecall`: recupera
  panic/hang morbidi (con `panic=-1`) o via **magic SysRq over serial**, ma NON
  un wedge totale con IRQ disabilitate.
- Xen dom0-less su RISC-V (`olkur/xen`) è **bleeding edge**.

## Decisione

### D1 — Separare artefatti (portabili) da ambiente di build (host-specifico)

Gli **artefatti** prodotti (Image kernel, moduli `.ko`, binario Xen, DTB,
initramfs) sono **binari RISC-V**, indipendenti dall'architettura dell'host che
li compila. Si spostano x86 → Mac **copiando file**, senza rebuild, senza
`docker save`, senza emulazione.

L'**ambiente di build** (container con la cross-toolchain) è host-specifico
(toolchain `<host>→riscv64`: x86_64 su server, arm64 su Mac). NON si trasferisce
via `docker save` (girerebbe sotto QEMU emulato, lento). Si **ricostruisce** sul
Mac. Per rendere il rebuild veloce → **D2**.

### D2 — Toolchain prebuilt, non build-from-source

Il Dockerfile attuale compila `riscv-gnu-toolchain` da sorgente (ore, e sotto
emulazione molte di più). Si passa a **toolchain prebuilt** (Bootlin fornisce
host x86_64 e aarch64; in alternativa `gcc-riscv64-linux-gnu` distro). Il
build-env si ricostruisce in **minuti** su entrambe le architetture →
la portabilità dell'ambiente cessa di essere un problema.

### D3 — Kernel = BSP vendor, non mainline 6.4.16

Si builda il **BSP Megrez** (`milkv-megrez/rockos-kernel`), che contiene
`dwmac-eic7700` e il DT del SoC. Il flow 6.4.16 e `scripts/bootstrap.sh`
(codice morto, riferito ad amd64/aarch64, mai invocato) vengono **rimossi**.

### D4 — MCP: interfaccia unica, due backend, processo nativo sull'host

Un solo server MCP espone `deploy / boot / run / observe / reset`. Due backend:

- `qemu`: `qemu-system-riscv64 -M virt`, seriale su **pty**, `virtio-net`;
  `reset()` = kill+respawn del processo.
- `board`: `deploy` via **ymodem** su UART, `boot` via `bootcmd` u-boot
  esistente, `observe` legge `/dev/tty.usbserial-*`, `reset()` via **SBI
  SRST / SysRq-over-serial**.

L'MCP gira **nativo sull'host** (non in container), perché su macOS il container
non vede la seriale USB. Linguaggio: **TypeScript/Node** (SDK MCP ufficiale +
`serialport`).

### D5 — Stadiazione: driver su Linux bare → poi sotto Xen

Poiché QEMU non emula la NIC reale e Xen-RISC-V è acerbo, si procede a stadi:

1. **Baseline HW**: BSP Linux bare sul Megrez, NIC up. (Fase 1)
2. **Scaffolding su QEMU**: MCP + transport + Xen dom0-less/domU su `virt`,
   senza NIC reale. (Fase 2)
3. **Xen sul Megrez**: stesso domU, NIC eic7700 in passthrough via DT; l'agente
   cicla su hardware. (Fase 3)

### D6 — Reset: SBI SRST + SysRq-over-serial come primario

Si accetta il limite (no recupero di wedge totali). Mitigazioni: `panic=-1`
(auto-reboot su panic) e magic SysRq abilitato sulla console seriale. Relè
hardware sul pin reset = miglioramento futuro, parcheggiato.

## Conseguenze

**Positive**

- Portabilità x86→Mac ridotta a copia di file (artefatti) + rebuild veloce
  (build-env con toolchain prebuilt). Nessuna emulazione nel percorso di build.
- Un solo contratto MCP: l'agente cicla identico su QEMU e su hardware.
- Rimozione di codice morto (6.4.16, `bootstrap.sh`) e di un build da ore.

**Negative / rischi**

- Il **driver reale si testa solo su hardware** (QEMU non emula la NIC). Il loop
  autonomo dipende dalla disponibilità fisica della board.
- Il **reset** non copre wedge totali → possibile intervento umano.
- **Xen dom0-less su RISC-V è bleeding edge**: il passthrough (MMIO/IRQ, DT del
  domU) è la parte a maggior rischio di integrazione.
- L'MCP nativo sull'host aggiunge una dipendenza di runtime fuori dal container
  (Node + accesso seriale) sul Mac.

## Alternative considerate

- **`docker save`/`load` dell'immagine di build x86 sul Mac**: scartato — la
  toolchain girerebbe emulata (lenta); inutile visto che gli artefatti sono già
  portabili.
- **Canadian cross (build su x86 di toolchain host-arm64)**: scartato — complessità
  di triplet non giustificata quando basta ricostruire il build-env con prebuilt.
- **Kernel mainline + backport driver**: rimandabile; il BSP dà la baseline più
  rapida e fedele alla board.
- **Due MCP separati (qemu / board)**: scartato — duplicherebbe la logica del
  loop; un'interfaccia unica con backend è più pulita.
- **Delta dell'immagine di sistema intera via UART**: scartato per il loop del
  driver — MB su UART a 115200 (~11 KB/s) = minuti/giro; si spingono solo i file
  cambiati (`.ko`/config) su una Linux già bootata da SD.
