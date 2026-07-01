# Development Plan

Last updated: 2026-07-01

## Active epics

### 1. Fase 1: build-env + baseline kernel BSP Megrez (`polimi-aos-megrez-eth0-dvq`)

**Why:** fondamenta di tutto. Senza toolchain prebuilt e un kernel BSP che
contiene `dwmac-eic7700`, non c'è né portabilità x86→Mac né una baseline
ethernet funzionante.
**Scope:** riscrivere il Dockerfile (prebuilt toolchain, via il flow 6.4.16 e
`bootstrap.sh` morto), script di fetch/build artefatti, config kernel con
`CONFIG_DWMAC_EIC7700`, boot su Megrez con NIC up (`ip link`).
**Status:** non iniziato.

### 2. Fase 2: MCP scaffolding + backend QEMU + transport UART (`polimi-aos-megrez-eth0-60f`)

**Why:** costruire il loop agente (deploy/boot/run/observe/reset) e rodarlo su
QEMU senza rischiare la board. Include la meccanica Xen dom0-less su emulazione.
**Scope:** server MCP TypeScript con interfaccia unica, backend `qemu`
(`-M virt`, pty, virtio-net), transport `ymodem` + backend `board`, domU Linux
dom0-less su QEMU, `reset()` a due implementazioni.
**Status:** non iniziato.

### 3. Fase 3: Xen dom0-less + NIC passthrough su Megrez (`polimi-aos-megrez-eth0-sju`)

**Why:** l'obiettivo finale — il driver esistente (già funzionante su Linux
bare) deve funzionare **in passthrough sotto Xen** sulla board reale.
**Scope:** DT dom0-less con passthrough della NIC eic7700 al domU, boot
Xen→domU sul Megrez, NIC up nel domU, loop agente su hardware (delta file SD via
UART → reset → observe).
**Status:** non iniziato.

## Parked / future

- Reset hardware affidabile via relè USB sul pin reset/power — miglioramento del
  reset SBI/SysRq per wedge totali. Deciso di rimandare (accettato il limite).
- Immagine multi-arch via registry (buildx `--push`) — alternativa al copiare
  artefatti; utile solo se il flusso diventa ripetitivo.

## Completed (recent)

- (nessuno)
