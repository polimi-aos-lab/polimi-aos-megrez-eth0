#!/usr/bin/env node
// Robust one-shot UART command: open, optionally send a line char-by-char,
// read for a bounded window, mirror to stdout AND a log file, then hard-exit.
// Unlike uart-poke.mjs it never waits on port.close() (which can hang while the
// guest console is streaming under sync_console), so it always terminates.
import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire(new URL('../mcp/package.json', import.meta.url));
const { SerialPort } = require('serialport');

const serialPath = process.env.SERIAL_PATH ?? '/dev/cu.usbmodem2102';
const baudRate = Number.parseInt(process.env.BAUD ?? '115200', 10);
const readMs = Number.parseInt(process.env.READ_MS ?? '6000', 10);
const txDelayMs = Number.parseInt(process.env.TX_CHAR_DELAY_MS ?? '12', 10);
const logPath = process.env.LOG_PATH ?? `stage/logs/board-serial-cmd-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
const send = process.argv[2] ?? '';

mkdirSync(dirname(logPath), { recursive: true });
const log = createWriteStream(logPath, { flags: 'a' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
port.on('data', (c) => {
  const text = c.toString('utf8');
  process.stdout.write(text);
  log.write(text);
});
port.on('error', (err) => {
  const msg = `\n[serial-cmd error] ${err.message}\n`;
  process.stdout.write(msg);
  log.write(msg);
});

function hardExit(code) {
  try { log.end(); } catch {}
  process.exit(code);
}

let opened = false;
port.open(async (err) => {
  if (err) {
    const msg = `[serial-cmd] open failed: ${err.message}\n`;
    process.stdout.write(msg);
    log.write(msg);
    hardExit(1);
    return;
  }
  opened = true;
  log.write('[serial-cmd] port opened\n');
  await sleep(300);
  if (send.length > 0) {
    for (const ch of send + '\r') {
      port.write(Buffer.from(ch, 'utf8'));
      if (txDelayMs > 0) await sleep(txDelayMs);
    }
  }
  // Bounded read window; hard-exit regardless of in-flight console stream.
  setTimeout(() => hardExit(0), readMs);
});

// Absolute watchdog: fire even if port.open() never calls back (wedged CDC).
setTimeout(() => {
  if (!opened) log.write('[serial-cmd] open watchdog: port never opened (wedged?)\n');
  hardExit(opened ? 0 : 3);
}, readMs + 5000);
