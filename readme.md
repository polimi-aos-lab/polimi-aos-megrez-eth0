# Demo Xen dom0-less con GMAC0 passthrough su Megrez (superquick)

Attenzione, le istruzioni assumono la board (e server tftp) installate in
sottorete 192.168.188.x. Cambiare gli indirizzi nel caso fossero diversi

Su host/server tftp

```sh
make build-container
make toolchain-check
make fetch-sources
# da zero
ENABLE_DOMU1_ETH_PASSTHROUGH=1 BOOT_IFACE=tftp DOMU1_STATIC_MEM_START=0xa0000000 DOMU1_STATIC_MEM_SIZE=0x20000000 DOMU1_DIRECT_MAP=1 make image-xen JOBS=1

# se già buildato prima
ENABLE_DOMU1_ETH_PASSTHROUGH=1 BOOT_IFACE=tftp DOMU1_STATIC_MEM_START=0xa0000000 DOMU1_STATIC_MEM_SIZE=0x20000000 DOMU1_DIRECT_MAP=1 make board-xen-smoke

# avvia server tftp
node scripts/tftp-serve.mjs --root stage/xen/board-xen-smoke --port 69
```

Su board (UART, e.g., screen)

```sh
tio -o 100 /dev/tty.usbmodem3102
```

```sh
setenv serverip 192.168.188.132; setenv ipaddr 192.168.188.110; setenv autostart no; tftpboot 0x88100000 boot.scr; source 0x88100000
...
...
~ #
ip link set eth0 up
ip addr add 192.168.188.110/24 dev eth0
ip route add default via 192.168.188.1 dev eth0
mkdir -p /etc
printf 'nameserver 192.168.188.1\n' > /etc/resolv.conf

ping -c 3 -W 2 192.168.188.132
ping -c 3 -W 2 8.8.8.8
ping -c 3 -W 2 www.google.com

```
