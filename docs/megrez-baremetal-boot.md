# Demo Linux bare-metal via TFTP su Megrez

Questa guida riproduce la dimostrazione bare-metal del repository, senza Xen:

1. build del kernel Linux, dei moduli Ethernet e dell'initramfs;
2. generazione di un payload U-Boot che usa TFTP;
3. avvio diretto di Linux con `booti`;
4. verifica di moduli STMMAC, carrier, DHCP e connettività LAN.

Il risultato atteso è un Linux bare-metal che raggiunge la shell initramfs,
carica `dwmac-win2030` come modulo e porta UP le interfacce Ethernet disponibili.

## Differenze rispetto alla demo Xen

| Bare-metal | Xen dom0-less |
|---|---|
| Linux gira direttamente in S-mode | Linux gira come domU sotto Xen |
| driver NIC come moduli (`=m`) | driver NIC built-in (`=y`) |
| `booti` avvia Linux | `bootm` avvia Xen |
| nessun p2m o vPLIC | RAM direct-map, p2m e vPLIC IRQ61 |
| output seriale Linux diretto | output domU inoltrato attraverso Xen |

Per la demo Xen vedere [`megrez-xen-boot.md`](megrez-xen-boot.md).

## Configurazione di riferimento

La procedura usa lo stesso trasporto TFTP della demo Xen:

| Componente | Valore |
|---|---|
| Host TFTP | macOS, interfaccia `en0` |
| IP host | `192.168.188.132/24` |
| IP U-Boot/Linux statico | `192.168.188.110/24` |
| Porta seriale tipica | `/dev/cu.usbmodem3102` |
| UART | 115200 baud, 8N1, senza flow control |
| Kernel | `Image` |
| Device tree | `eic7700-milkv-megrez.dtb` |
| Initramfs | `initramfs-megrez.cpio.gz` |

Occorrono un cavo Ethernet collegato a una LAN attiva e la debug probe USB
della board. La probe e la board hanno alimentazioni distinte: replug della
probe non equivale a un reset della board.

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

Costruire kernel, moduli, initramfs e payload bare-metal TFTP:

```sh
BOOT_IFACE=tftp make image-baremetal JOBS=1
```

Il target esegue due fasi:

1. `build-artifacts.sh` con profilo `baremetal`, che compila STMMAC e
   `dwmac-win2030` come moduli;
2. `board-baremetal-smoke.sh`, che assembla l'initramfs con i moduli necessari,
   lo script di bring-up e un `boot.scr` TFTP.

Gli artefatti da servire sono in:

```text
stage/baremetal/boot/
  Image
  eic7700-milkv-megrez.dtb
  initramfs-megrez.cpio.gz
  boot.cmd
  boot.scr
  nic-bringup.sh
  README.txt
  lib/modules/<kernel-release>/...
```

Per rigenerare soltanto il payload, riusando kernel, moduli e initramfs già
costruiti:

```sh
BOOT_IFACE=tftp make board-baremetal-smoke
```

Il `boot.scr` generato esegue:

```text
tftpboot ${kernel_addr_r} Image
tftpboot ${fdt_addr_r} eic7700-milkv-megrez.dtb
tftpboot ${ramdisk_addr_r} initramfs-megrez.cpio.gz
setenv ramdisk_size ${filesize}
booti ${kernel_addr_r} ${ramdisk_addr_r}:${ramdisk_size} ${fdt_addr_r}
```

## 2. Avviare il server TFTP sul Mac

Verificare l'indirizzo dell'interfaccia collegata alla board:

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
  --root stage/baremetal/boot \
  --port 69
```

Se macOS nega l'apertura della porta UDP 69, ripetere con `sudo`. Alla prima
esecuzione macOS può chiedere di autorizzare Node nel firewall.

## 3. Aprire la console seriale

In un secondo terminale trovare la porta disponibile:

```sh
printf '%s\n' /dev/cu.usbmodem*
```

Aprirla con `screen`, sostituendo il device se necessario:

```sh
screen /dev/cu.usbmodem3102 115200
```

Per fare detach: `Ctrl-A`, poi `d`. Per terminare `screen`: `Ctrl-A`, poi `\\`,
quindi confermare con `y`.

Se la porta esiste ma l'apertura rimane bloccata, chiudere eventuali altre
sessioni seriali e fare replug della sola debug probe USB.

## 4. Riavviare e fermarsi in U-Boot

Se Linux o il domU Xen sono già avviati, eseguire:

```sh
reboot -f
```

Nel caso Xen è normale vedere il messaggio di reset SBI seguito dal reboot
dell'hypervisor. Durante il countdown U-Boot premere `s` o `Ctrl-C` finché
compare:

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
automaticamente kernel, DTB e initramfs dalla stessa root TFTP, quindi avvia
Linux con `booti`.

L'evidenza iniziale attesa è:

```text
Booting Megrez BSP Linux via TFTP from 192.168.188.132
```

Durante i tre trasferimenti devono comparire:

```text
Filename 'Image'.
Filename 'eic7700-milkv-megrez.dtb'.
Filename 'initramfs-megrez.cpio.gz'.
```

Non inviare altri caratteri durante il boot.

## 6. Riconoscere un boot corretto

La command line deve includere:

```text
console=ttyS0,115200n8
rdinit=/init
panic=-1
sysrq_always_enabled=1
```

Durante l'avvio l'initramfs esegue automaticamente `megrez-net-up`, che:

1. monta `/proc`, `/sys` e `/dev`;
2. abilita SysRq;
3. carica la closure di moduli PHY, STMMAC e `dwmac-win2030`;
4. porta UP `eth0`, `eth1` e la prima interfaccia non-loopback trovata;
5. mostra `ip link` e la coda di `dmesg`.

Quando compare la shell initramfs verificare:

```sh
cat /proc/cmdline
cat /proc/sys/kernel/sysrq
lsmod
ip link
```

Risultati attesi:

- `/proc/cmdline` contiene `panic=-1` e `sysrq_always_enabled=1`;
- `/proc/sys/kernel/sysrq` restituisce `1`;
- `lsmod` include `dwmac_win2030`, `stmmac_platform`, `stmmac` e i moduli PHY;
- almeno una delle interfacce Ethernet è presente;
- con il cavo collegato, l'interfaccia usata raggiunge `LOWER_UP`.

## 7. Ripetere manualmente il bring-up NIC

Se l'automatismo non ha portato UP l'interfaccia:

```sh
/root/nic-bringup.sh
ip link
```

Individuare la porta fisicamente collegata. Se è `eth1`, sostituire `eth0` nei
comandi successivi.

Controllare stato e contatori:

```sh
ip -s link show eth0
```

## 8. Verificare DHCP e connettività

L'initramfs bare-metal include lo script BusyBox che applica indirizzo e route
del lease DHCP:

```sh
udhcpc -i eth0 -n -q
ip addr show dev eth0
ip route
```

Verificare quindi il Mac usato come server TFTP:

```sh
ping -c 3 -W 2 192.168.188.132
```

Se DHCP non è disponibile, configurare temporaneamente l'indirizzo di
riferimento:

```sh
ip addr flush dev eth0
ip addr add 192.168.188.110/24 dev eth0
ping -c 3 -W 2 192.168.188.132
```

Controllare infine interrupt e traffico:

```sh
cat /proc/interrupts
ip -s link show eth0
cat /proc/net/dev
```

La dimostrazione è riuscita se:

1. Linux raggiunge la shell senza Xen;
2. i moduli NIC si caricano senza errori fatali;
3. l'interfaccia collegata raggiunge carrier;
4. il ping riceve tre risposte;
5. i contatori RX e TX aumentano.

## Sequenza compatta della demo

Sul Mac:

```sh
BOOT_IFACE=tftp make image-baremetal JOBS=1
node scripts/tftp-serve.mjs --root stage/baremetal/boot --port 69
```

Da U-Boot:

```text
setenv serverip 192.168.188.132
setenv ipaddr 192.168.188.110
setenv autostart no
tftpboot 0x88100000 boot.scr
source 0x88100000
```

Dalla shell Linux:

```sh
cat /proc/cmdline
lsmod
/root/nic-bringup.sh
udhcpc -i eth0 -n -q
ip addr show dev eth0
ip route
ping -c 3 -W 2 192.168.188.132
ip -s link show eth0
```

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
- root TFTP `stage/baremetal/boot`;
- presenza dei quattro file `boot.scr`, `Image`, DTB e initramfs.

### `boot.scr` prova a leggere `mmc`

Il payload è stato generato con il trasporto predefinito. Rigenerarlo
esplicitamente:

```sh
BOOT_IFACE=tftp make board-baremetal-smoke
```

Verificare poi che `stage/baremetal/boot/boot.cmd` contenga `tftpboot`.

### Moduli non caricati

Verificare:

```sh
find /lib/modules -type f -name '*.ko'
cat /proc/modules
/root/nic-bringup.sh
```

Kernel e moduli devono provenire dalla stessa esecuzione di
`make image-baremetal`; un vermagic diverso impedisce il caricamento.

### Interfaccia presente ma senza carrier

Verificare quale porta fisica corrisponde a `eth0` o `eth1`, il cavo e lo stato
dello switch. Il PHY usa polling e il carrier può richiedere alcuni secondi.

### Terminare la demo

Riavviare Linux con:

```sh
reboot -f
```

Terminare il server TFTP sul Mac con `Ctrl-C`.
