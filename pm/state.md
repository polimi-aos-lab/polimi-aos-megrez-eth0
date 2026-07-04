# polimi-aos-megrez-eth0 — State

Updated: 2026-07-04

## Roadmap

Active (children + detail in bd; run `bd show <id>`):

1. `…-60f` — Fase 2: MCP loop su Linux bare (board reale) via UART. Loop agente
   deploy/observe/reset contro il driver esistente su Linux bare, tutto su HW.
   Open: `60f.1` scheletro MCP TS single-backend
   (deploy/boot/run/observe/reset); `60f.2` backend board (ymodem UART, observe
   /dev/tty, boot bootcmd); `60f.3` mock seriale pty per dev offline; `60f.4`
   `make qemu-xen-smoke` (smoke-test non-MCP del boot Xen, P2); `60f.5` reset()
   SBI-SRST/SysRq (panic=-1, sysrq).
2. `…-sju` — Fase 3: Xen dom0-less + NIC passthrough su Megrez. Driver esistente
   funzionante in passthrough. Open: `sju.1` DT passthrough NIC eic7700 al domU;
   `sju.2` boot Xen→domU sul Megrez; `sju.3` NIC up nel domU sotto Xen; `sju.4`
   loop agente HW (delta SD via UART → reset → observe).

Parked: relè USB reset HW (miglioramento del reset SBI/SysRq) · immagine
multi-arch via registry (se il flusso diventa ripetitivo).

## Handoff

Written: 2026-07-04 · assistant

Done: closed `dvq.5` and auto-closed Fase 1 `dvq`. `scripts/assemble-boot.sh`
now patches the generated initramfs `/init` to auto-run `/usr/sbin/megrez-net-up`,
brings eth0/eth1 UP with `ip link set`, and embeds a BusyBox `udhcpc`
default.script. `docs/megrez-boot.md` documents automatic NIC bring-up, DHCP,
and the FAT/8.3 live-update gotcha. State: HW verified on Megrez via
`/dev/tty.usbmodem2102`; U-Boot bootflow loaded `/boot.scr`, Linux booted with
`panic=-1`/SysRq, eth0/eth1 came UP, `udhcpc -i eth0 -n -q` configured
192.168.188.110/24, and `ping -c 3 192.168.188.1` passed 3/3. Next:
1) start Fase 2 with `60f.1`/`60f.2` in dependency order 2) reuse UART path
`/dev/tty.usbmodem2102` 3) prefer hardware reset over software reboot when MMC
is not detected. Gotchas: live writes to the FAT boot partition from initramfs
may create 8.3 aliases instead of replacing U-Boot's LFN target; host-side copy
is safer. Blockers: none for Fase 2 start.
