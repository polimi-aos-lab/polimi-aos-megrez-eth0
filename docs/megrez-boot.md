# Megrez boot payload and serial procedure

This repo does not rebuild Megrez U-Boot. It uses the on-board U-Boot and only
loads a repo-generated `boot.scr` from the SD card boot partition.

## Build the boot payload

```sh
make assemble-boot
```

Default output:

```text
stage/baremetal/boot/
  boot.cmd
  boot.scr
  Image
  eic7700-milkv-megrez.dtb
  initramfs-megrez.cpio.gz
  nic-bringup.sh
  README.txt
  lib/modules/<kernel-release>/...
```

`boot.cmd` sets Linux bootargs including `panic=-1` and
`sysrq_always_enabled=1`. The generated initramfs embeds the minimal module
closure for `dwmac-win2030`, auto-runs `/usr/sbin/megrez-net-up` before the
shell, and keeps `/root/nic-bringup.sh` as a retry/debug command.

To change the U-Boot SD enumeration, run:

```sh
STAGE_DIR=stage/baremetal BOOT_DEV=0 BOOT_PART=1 ./scripts/assemble-boot.sh
```

## Copy to SD

Use an SD card whose partition 1 is readable by the on-board U-Boot (the tested
Megrez card is FAT; ext4 is also fine if U-Boot can list it). Replace
`/dev/sdX1` with the actual partition.

```sh
sudo mkdir -p /mnt/megrez-boot
sudo mount /dev/sdX1 /mnt/megrez-boot
sudo cp -a stage/baremetal/boot/. /mnt/megrez-boot/
sync
sudo umount /mnt/megrez-boot
```

Prefer copying from the host OS. If you update the FAT partition from this
initramfs, it may mount as `msdos` without long-filename support; in that mode a
write to `initramfs-megrez.cpio.gz` can create a new 8.3 alias instead of
overwriting the file U-Boot resolves from `/initramfs-megrez.cpio.gz`.

## Serial console

Megrez UART settings:

```text
115200 baud, 8 data bits, 1 stop bit, no parity, no flow control
```

Use a 3.3 V USB-TTL adapter. Connect GND/RX/TX only; do not connect the red/VCC
wire. Stop U-Boot autoboot by pressing `s` when the countdown appears.

## One-shot U-Boot boot

The default assumes SD is `mmc 1:1`, matching the vendor SD update examples. If
that does not list the files, try `mmc 0:1`.

```text
mmc list
mmc dev 1
ext4ls mmc 1:1 /
load mmc 1:1 ${scriptaddr} /boot.scr
source ${scriptaddr}
```

Expected U-Boot evidence:

```text
Booting Megrez BSP Linux from mmc 1:1
```

and successful loads of `/Image`, `/eic7700-milkv-megrez.dtb`, and
`/initramfs-megrez.cpio.gz` before `booti` starts Linux.

## Persistent U-Boot bootcmd

Set this only after the one-shot boot works. It tries the repo boot script first
and then falls back to the existing distro boot flow.

```text
setenv megrez_bootdev 1
setenv megrez_bootpart 1
setenv megrez_try_boot 'mmc dev ${megrez_bootdev}; if mmc rescan; then if load mmc ${megrez_bootdev}:${megrez_bootpart} ${scriptaddr} /boot.scr; then source ${scriptaddr}; fi; fi'
setenv bootcmd 'run megrez_try_boot; run distro_bootcmd'
saveenv
boot
```

Recovery if this misboots:

```text
run distro_bootcmd
```

or restore the stock fallback command:

```text
setenv bootcmd 'run distro_bootcmd'
saveenv
```

## Linux/NIC smoke check

At the initramfs shell the assembled image has already attempted to load the
Ethernet modules and run `ip link set ... up` for `eth0`/`eth1`. Check it with:

```sh
cat /proc/cmdline
cat /proc/sys/kernel/sysrq
lsmod
ip link
/root/nic-bringup.sh   # retry/debug path
```

Acceptance evidence for this bead:

- `/proc/cmdline` contains `panic=-1` and `sysrq_always_enabled=1`.
- `/proc/sys/kernel/sysrq` prints `1`.
- `dwmac_win2030`/`stmmac` modules load without fatal probe errors.
- `ip link` shows the Megrez Ethernet interface(s), typically `eth0` and/or
  `eth1`; link carrier requires a connected cable.
- With a live LAN, request DHCP and verify ping. The assembled initramfs includes
  the BusyBox `udhcpc` default script so the lease installs an address and
  default route:

```sh
udhcpc -i eth0 -n -q
ip addr show eth0
ip route
ping -c 3 <lan-peer-ip>
```
