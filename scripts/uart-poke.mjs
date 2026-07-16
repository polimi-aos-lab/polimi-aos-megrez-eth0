#!/usr/bin/env node
// Minimal UART interaction: open once, send a line, read for a window, print.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { SerialPort } = require('serialport');

const serialPath = process.env.SERIAL_PATH ?? '/dev/cu.usbmodem3102';
const baudRate = Number.parseInt(process.env.BAUD ?? '115200', 10);
const readMs = Number.parseInt(process.env.READ_MS ?? '8000', 10);
const send = process.argv[2] ?? '';

const port = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
port.on('data', (c) => process.stdout.write(c.toString('utf8')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

port.open(async (err) => {
  if (err) { console.error('open failed:', err.message); process.exit(1); }
  await sleep(300);
  if (send.length > 0) {
    for (const ch of send + '\r') { port.write(Buffer.from(ch, 'utf8')); await sleep(5); }
  }
  await sleep(readMs);
  port.close(() => process.exit(0));
});
