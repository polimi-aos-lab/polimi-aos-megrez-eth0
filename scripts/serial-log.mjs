#!/usr/bin/env node
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(new URL('../mcp/package.json', import.meta.url));
const { SerialPort } = require('serialport');

function usage() {
  console.log(`Usage: serial-log.mjs [options]

Read raw UART text from the Megrez board and print it to stdout.

Options:
  --serial PATH      Serial device (default: SERIAL_PATH or /dev/tty.usbmodem2102)
  --baud RATE        Baud rate (default: BAUD or 115200)
  --duration MS      Stop after this many milliseconds (default: 60000)
  --log PATH         Save captured text to PATH
  -h, --help         Show this help`);
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

const options = {
  serialPath: process.env.SERIAL_PATH ?? '/dev/tty.usbmodem2102',
  baudRate: parsePositiveInt(process.env.BAUD ?? '115200', 'BAUD'),
  durationMs: parsePositiveInt(process.env.DURATION_MS ?? '60000', 'DURATION_MS'),
  logPath: undefined,
};

const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  switch (arg) {
    case '-h':
    case '--help':
      usage();
      process.exit(0);
      break;
    case '--serial':
      options.serialPath = requireValue(argv, ++index, arg);
      break;
    case '--baud':
      options.baudRate = parsePositiveInt(requireValue(argv, ++index, arg), arg);
      break;
    case '--duration':
      options.durationMs = parsePositiveInt(requireValue(argv, ++index, arg), arg);
      break;
    case '--log':
      options.logPath = requireValue(argv, ++index, arg);
      break;
    default:
      throw new Error(`unknown option: ${arg}`);
  }
}

const port = new SerialPort({
  path: options.serialPath,
  baudRate: options.baudRate,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: false,
});
const chunks = [];

port.on('data', (chunk) => {
  chunks.push(Buffer.from(chunk));
  process.stdout.write(chunk.toString('utf8'));
});

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout during ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function openPort(timeoutMs) {
  try {
    await withTimeout(
      new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve()))),
      timeoutMs,
      'serial open',
    );
  } catch (error) {
    port.destroy(error);
    throw error;
  }
}

async function closePort(timeoutMs) {
  if (!port.isOpen) {
    return;
  }
  try {
    await withTimeout(
      new Promise((resolve, reject) => port.close((error) => (error ? reject(error) : resolve()))),
      timeoutMs,
      'serial close',
    );
  } catch (error) {
    port.destroy(error);
    throw error;
  }
}

process.stderr.write(`==> opening ${options.serialPath} @ ${options.baudRate}; reading ${options.durationMs} ms\n`);
await openPort(3000);
await new Promise((resolve) => setTimeout(resolve, options.durationMs));
await closePort(3000);

if (options.logPath !== undefined) {
  await writeFile(options.logPath, Buffer.concat(chunks).toString('utf8'));
  process.stderr.write(`\n==> wrote ${options.logPath}\n`);
}
