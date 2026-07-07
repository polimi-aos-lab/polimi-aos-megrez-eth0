# ADR 0002 — Xen: polling RX console vSBI demand-driven

- **Status:** Accepted
- **Date:** 2026-07-07
- **Deciders:** vzaccaria
- **Context tracker:** bead `polimi-aos-megrez-eth0-sju.6`

## Contesto

Nel boot Xen dom0-less su Milk-V Megrez/EIC7700X il domU Linux arriva alla
shell initramfs su `hvc0`, ma la shell non riceve caratteri dalla UART fisica.
Il prompt è visibile perché il path TX guest funziona già:

```text
Linux hvc0 -> SBI CONSOLE_PUTCHAR -> Xen vsbi_uart_putchar() -> console seriale
```

Il path RX previsto è:

```text
UART fisica
  -> driver seriale Xen/ns16550
  -> serial_rx_interrupt()/serial_rx()
  -> __serial_rx()
  -> console_rx == DOM1
  -> vsbi_uart_rx_char_xen()
  -> ring input vSBI del dominio
  -> SBI CONSOLE_GETCHAR
  -> vsbi_uart_getchar()
  -> Linux hvc0/TTY/shell
```

Fatti accertati sul target:

- Il DT domU contiene `vsbi_uart`; quindi `domain_vsbi_uart_init()` inizializza
  il backend Xen del vSBI UART.
- Xen stampa `*** Serial input to DOM1`, quindi `console_rx` è diretto al domU.
- Il caller RISC-V di `vsbi_uart_rx_char_xen()` esiste già nel ramo `default` di
  `__serial_rx()` quando `console_rx >= 2`.
- Con `com1=poll`, il driver ns16550 si aspetta che `ns16550_poll()` sia chiamato
  da un timer Xen; sul port RISC-V corrente Xen stampa
  `init_timer_interrupt: need to be implemented`, quindi quel polling periodico
  non drena la FIFO UART.
- Senza `com1=poll`, il boot si ferma prima del guest con
  `Assertion setup_irq failed at arch/riscv/irq.c:55`; il path IRQ seriale non è
  usabile come soluzione per questo board smoke.

## Decisione

Rendere l'RX console vSBI **demand-driven**: ogni chiamata guest a SBI legacy
`CONSOLE_GETCHAR` forza un polling non bloccante della console seriale fisica
prima di leggere il ring vSBI del dominio.

Modifica Xen applicata:

1. In `xen/drivers/char/serial.c` estrarre il corpo di RX singolo in
   `serial_rx_one()` e aggiungere:

   ```c
   void serial_rx_poll(int handle, struct cpu_user_regs *regs)
   ```

   La funzione:
   - ignora `handle == -1`;
   - usa il `struct serial_port` già registrato;
   - legge solo tramite `driver->getc` se disponibile;
   - drena al massimo `serial_rxbufsz` caratteri;
   - riusa la stessa dispatch di `serial_rx_interrupt()` verso `port->rx`,
     `rx_hi`, `rx_lo` o il buffer RX software.

2. In `xen/include/xen/serial.h` esportare `serial_rx_poll()`.

3. In `xen/drivers/char/console.c` aggiungere:

   ```c
   void console_poll_input(struct cpu_user_regs *regs)
   {
       serial_rx_poll(sercon_handle, regs);
   }
   ```

   Questa scelta evita di hard-codare `SERHND_DTUART`, `COM1` o dettagli del
   backend dentro `vsbi_uart.c`: si usa il serial handle già scelto dalla console
   Xen (`sercon_handle`).

4. In `xen/include/xen/console.h` esportare `console_poll_input()` e forward
   dichiarare `struct cpu_user_regs`.

5. In `xen/arch/riscv/vsbi_uart.c`, dentro `vsbi_uart_getchar()`, chiamare:

   ```c
   console_poll_input(regs);
   ```

   prima di prendere il lock del ring vSBI e consumare `intf->in[]`.

Flusso finale:

```text
Linux hvc0 polls SBI CONSOLE_GETCHAR
  -> vsbi_uart_getchar()
  -> console_poll_input(regs)
  -> serial_rx_poll(sercon_handle, regs)
  -> serial_rx_one()
  -> serial_rx callback / __serial_rx()
  -> vsbi_uart_rx_char_xen(DOM1, c)
  -> ring vSBI
  -> vsbi_uart_getchar() dequeues c
  -> Linux TTY/shell receives c
```

## Conseguenze

**Positive**

- Il path RX domU non dipende più dal timer Xen usato da `ns16550_poll()` in
  modalità `com1=poll`.
- Il fix è locale al percorso console/vSBI e riusa la dispatch seriale Xen
  esistente; non introduce un secondo canale RX parallelo.
- Il codice resta agnostico rispetto al backend seriale effettivo: `vsbi_uart` non
  conosce `COM1`, `DTUART` o `ns16550`.
- Il comportamento di `serial_rx_interrupt()` resta equivalente: ora chiama lo
  stesso helper `serial_rx_one()` usato dal polling esplicito.

**Negative / rischi**

- Il polling RX avviene quando il guest chiede `CONSOLE_GETCHAR`; non sostituisce
  una vera implementazione del timer interrupt Xen/RISC-V.
- Se in futuro serve console RX indipendente dal polling guest, input verso Xen
  console o gestione robusta di escape console senza guest attivo, bisogna
  completare timer/IRQ seriali Xen invece di estendere questo workaround.
- Il tema `vtimer` guest resta separato: il boot-to-shell non prova che timer,
  timeout, preemption e networking guest siano sani.

## Alternative considerate

- **Usare serial IRQ invece di `com1=poll`**: scartato sul target corrente perché
  il boot fallisce con `Assertion setup_irq failed at arch/riscv/irq.c:55`.
- **Sistemare subito il timer interrupt Xen/RISC-V**: soluzione più generale, ma
  fuori dal bead `sju.6`; richiede lavoro su time/IRQ hypervisor e validazione più
  ampia. Il bug richiesto è la shell domU non interattiva.
- **Hard-codare `serial_rx_poll(SERHND_DTUART, regs)` in `vsbi_uart_getchar()`**:
  scartato perché lega vSBI UART a una specifica console fisica; `sercon_handle`
  è già la fonte corretta della console Xen.
- **Aggiungere un path RX vSBI separato**: scartato perché duplicava la logica
  `serial_rx`/`__serial_rx` già responsabile di console switching e routing verso
  `console_rx`.

## Verifica

Build Xen:

```text
make build-xen
```

Payload TFTP finale:

```text
make board-xen-smoke \
  BOOT_IFACE=tftp \
  XEN_BOOTARGS='bootscrub=0 com1=poll sched=null sync_console' \
  DOMU1_KERNEL=stage/Image.gz \
  DOMU1_KERNEL_LOAD_ADDR=0x8a200000 \
  DOMU1_BOOTARGS='rw root=/dev/ram console=hvc0 earlycon=sbi rdinit=/init panic=-1 sysrq_always_enabled=1'
```

Boot hardware finale da U-Boot/TFTP:

```text
setenv serverip 192.168.188.132
setenv ipaddr 192.168.188.110
setenv tftpdstp 6969
setenv autostart no
tftpboot 0x88100000 boot.scr
source 0x88100000
```

Evidenza finale senza log temporanei:

```text
~ # echo sju6-ok
sju6-ok
~ #
```

Log locale della sessione hardware:

```text
stage/logs/sju.6-final-clean-boot.log
```
