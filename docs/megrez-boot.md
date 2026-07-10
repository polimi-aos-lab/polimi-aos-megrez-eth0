# Demo Xen dom0-less con GMAC0 passthrough su Megrez

Questa guida riproduce la dimostrazione end-to-end del repository:

1. build del kernel Linux domU, di Xen e del payload U-Boot;
2. caricamento del payload via TFTP;
3. avvio di un domU Linux con GMAC0 assegnato in passthrough trusted no-IOMMU;
4. verifica di carrier, interrupt IRQ61, traffico RX/TX e connettività LAN.

Il risultato atteso è un domU che porta `eth0` UP senza panic di Xen, raggiunge
il carrier a 1 Gbps e comunica con il Mac usato come server TFTP.

> [!WARNING]
> Questo è un profilo di laboratorio trusted no-IOMMU. Il GMAC può eseguire DMA
> verso indirizzi macchina e il guest deve essere considerato fidato. Non usare
> questa configurazione come modello di isolamento per guest non fidati.

## Configurazione di riferimento

La procedura verificata usa:

| Componente | Valore |
|---|---|
| Host TFTP | macOS, interfaccia `en0` |
| IP host | `192.168.188.132/24` |
| IP U-Boot/guest statico | `192.168.188.110/24` |
| Porta seriale tipica | `/dev/cu.usbmodem3102` |
| UART | 115200 baud, 8N1, senza flow control |
| RAM domU | `0xa0000000-0xbfffffff` (512 MiB) |
| Alias uncached domU | `0xc020000000-0xc03fffffff` |
| NIC assegnata | GMAC0, `ethernet@50400000` |
| Interrupt NIC | PLIC IRQ61 |

Occorrono un cavo Ethernet collegato a una LAN attiva e la debug probe USB
della board. L'alimentazione della board e quella della probe sono distinte:
replug della probe non equivale a un reset della board.

## 1. Preparare e costruire il payload

Dalla root del repository:

```sh
cd /Users/zaccaria/projects/github/vzaccaria/polimi-aos-megrez-eth0
```

Per un checkout nuovo, costruire il container, verificarne il toolchain e
materializzare le sorgenti pinned:

```sh
make build-container
make toolchain-check
make fetch-sources
```

Costruire l'intera immagine Xen con il passthrough GMAC0 abilitato:

```sh
ENABLE_DOMU1_ETH_PASSTHROUGH=1 \
BOOT_IFACE=tftp \
DOMU1_STATIC_MEM_START=0xa0000000 \
DOMU1_STATIC_MEM_SIZE=0x20000000 \
DOMU1_DIRECT_MAP=1 \
make image-xen JOBS=1
```

Il target costruisce in sequenza:

- kernel domU con STMMAC e `dwmac-win2030` built-in;
- initramfs minimale;
- Xen RISC-V;
- DTB parziale per il passthrough GMAC0;
- script U-Boot finale.

Gli artefatti della demo sono in:

```text
stage/xen/board-xen-smoke/
  board.dtb
  xen.img
  domu1.img
  domu1.rd
  domu1-eth0.dtb
  boot.cmd
  boot.scr
  README.txt
```

Per rigenerare soltanto il payload, riusando kernel, initramfs e Xen già
costruiti:

```sh
make board-xen-smoke \
  ENABLE_DOMU1_ETH_PASSTHROUGH=1 \
  BOOT_IFACE=tftp \
  DOMU1_STATIC_MEM_START=0xa0000000 \
  DOMU1_STATIC_MEM_SIZE=0x20000000 \
  DOMU1_DIRECT_MAP=1
```

## 2. Avviare il server TFTP sul Mac

Verificare l'indirizzo host:

```sh
ipconfig getifaddr en0
```

La configurazione di riferimento restituisce:

```text
192.168.188.132
```

Avviare il server dalla root del repository e lasciarlo in foreground:

```sh
node scripts/tftp-serve.mjs \
  --root stage/xen/board-xen-smoke \
  --port 69
```

Se macOS nega l'apertura della porta UDP 69, ripetere con `sudo`. Alla prima
esecuzione macOS può anche chiedere di autorizzare Node nel firewall.

## 3. Aprire la console seriale

In un secondo terminale, trovare la porta disponibile:

```sh
printf '%s\n' /dev/cu.usbmodem*
```

Aprirla con `screen`, sostituendo il device se necessario:

```sh
screen /dev/cu.usbmodem3102 115200
```

Per fare detach senza chiudere la sessione: `Ctrl-A`, poi `d`. Per terminare
`screen`: `Ctrl-A`, poi `\\`, quindi confermare con `y`.

Se l'apertura della porta rimane bloccata e nessun altro processo usa la
seriale, scollegare e ricollegare soltanto la debug probe USB, quindi riaprire
`screen`.

## 4. Riavviare la board e fermarsi in U-Boot

Se è già visibile il prompt del domU:

```text
~ #
```

eseguire:

```sh
reboot -f
```

Il port Xen implementa la richiesta SBI di reset passando dal panic/reboot. È
quindi normale vedere:

```text
Panic on CPU 0:
Guest requested system reset via SBI_SRST
Reboot in five seconds...
```

Durante il countdown U-Boot premere `Ctrl-C` finché compare:

```text
=>
```

Se la board è già al prompt `=>`, saltare il reboot.

## 5. Caricare e avviare il payload

Al prompt U-Boot eseguire una riga alla volta:

```text
setenv serverip 192.168.188.132
setenv ipaddr 192.168.188.110
setenv autostart no
tftpboot 0x88100000 boot.scr
source 0x88100000
```

`tftpboot` deve terminare con `Bytes transferred`. `source` carica
automaticamente `board.dtb`, `xen.img`, `domu1.img`, `domu1.rd` e
`domu1-eth0.dtb`, poi esegue:

```text
bootm 0x95200000 - 0x94200000
```

Non inviare altri caratteri durante il boot. L'output può apparire duplicato a
causa di `sync_console`; è previsto e garantisce che i messaggi Xen e domU siano
visibili in tempo reale.

## 6. Riconoscere un boot corretto

Nel log devono comparire almeno queste evidenze:

```text
PLIC: 520 sources, max priority 7, S-context 5
CCACHE: 4 banks, 16 ways, sets/bank=1024, bytes/block=64
CCACHE: Node 0, index of the largest way enabled: 15
Megrez initramfs ready. Tools: sz rz insmod ip.
~ #
```

Il numero del PLIC S-context dipende dal boot hart scelto da OpenSBI; nella
configurazione verificata `Boot HART ID: 2` corrisponde a `S-context 5`. Xen
deve selezionare il contesto associato al boot hart, non necessariamente il
numero 5 in ogni boot.

Non devono comparire:

```text
device non-coherent but no non-coherent operations supported
Err,tbu NOT defined in dts!!!!
unable to handle guest store instruction ... at c03d440000
```

## 7. Dimostrare il funzionamento della NIC

Dal prompt domU verificare che l'interfaccia esista:

```sh
ip link show eth0
```

Portarla UP:

```sh
ip link set eth0 up
sleep 8
ip link show eth0
```

Il kernel deve riportare:

```text
Link is Up - 1Gbps/Full - flow control rx/tx
```

e `ip link` deve mostrare `UP` e `LOWER_UP`. Xen non deve panicare.

### DHCP

Richiedere un lease:

```sh
udhcpc -i eth0 -n -q
```

Nella LAN di riferimento il risultato verificato è:

```text
udhcpc: lease of 192.168.188.50 obtained from 192.168.188.1
```

L'initramfs Xen è minimale e può non contenere lo script che applica il lease.
Controllare quindi:

```sh
ip addr show dev eth0
ip route
```

Se il lease è stato ottenuto ma l'indirizzo non è stato configurato, usare il
test statico seguente.

### Ping con configurazione statica

```sh
ip addr flush dev eth0
ip addr add 192.168.188.110/24 dev eth0
ping -c 3 -W 2 192.168.188.132
```

Risultato atteso:

```text
3 packets transmitted, 3 packets received, 0% packet loss
```

### Interrupt e contatori RX/TX

```sh
cat /proc/interrupts
ip -s link show eth0
cat /proc/net/dev
```

`/proc/interrupts` deve contenere una riga equivalente a:

```text
16:          7  SiFive PLIC  61 Edge      eth0
```

Il valore esatto può cambiare, ma il contatore IRQ61 deve essere maggiore di
zero e aumentare generando traffico. Anche i contatori RX e TX di `eth0` devono
essere entrambi non nulli.

## 8. Sequenza compatta per la dimostrazione

Una volta raggiunto `~ #`, questa sequenza copre la parte osservabile della
demo:

```sh
ip link set eth0 up
sleep 8
ip addr flush dev eth0
ip addr add 192.168.188.110/24 dev eth0
ping -c 3 -W 2 192.168.188.132
cat /proc/interrupts
ip -s link show eth0
```

La dimostrazione è riuscita se:

1. Xen rimane operativo dopo `ip link set eth0 up`;
2. `eth0` raggiunge `LOWER_UP` a 1 Gbps;
3. il ping riceve tre risposte;
4. il contatore PLIC IRQ61 è maggiore di zero;
5. i contatori RX e TX aumentano.

## Risoluzione rapida dei problemi

### U-Boot usa il server sbagliato

Se compare `TFTP from server 192.168.188.1`, reimpostare:

```text
setenv serverip 192.168.188.132
setenv ipaddr 192.168.188.110
```

### `TFTP server died` o timeout

Verificare:

- server Node ancora in esecuzione;
- IP di `en0`;
- firewall macOS;
- cavo Ethernet e appartenenza alla stessa `/24`;
- root TFTP `stage/xen/board-xen-smoke`.

### La seriale esiste ma `screen` non si apre

Chiudere eventuali sessioni `screen`, verificare il device con
`/dev/cu.usbmodem*` e, se necessario, fare replug della sola debug probe. Non
serve togliere alimentazione alla board.

### Carrier presente ma nessun pacchetto RX

Controllare `/proc/interrupts`. IRQ61 fermo a zero indica che il percorso PLIC
fisico → Xen → vPLIC non sta consegnando gli interrupt al guest. Verificare nel
boot log che Xen abbia scelto il PLIC S-context associato al boot hart.

### Terminare la demo

Nel domU è possibile riavviare con:

```sh
reboot -f
```

Terminare il server TFTP nel terminale host con `Ctrl-C`.
