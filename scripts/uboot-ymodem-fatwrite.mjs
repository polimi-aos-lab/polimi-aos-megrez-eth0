#!/usr/bin/env node
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  buildYmodemFrames,
  YMODEM_ACK,
  YMODEM_C,
  YMODEM_EOT,
  YMODEM_NAK,
} from '../dist/src/backend/ymodem.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const { SerialPort } = require('serialport');

function usage() {
  console.log(`Usage: uboot-ymodem-fatwrite.mjs <source-file> [dest-name]

Deploy one small file to the Megrez SD boot partition from a U-Boot prompt:
  1. send: mmc dev <MMC_DEV>
  2. send: loady <LOAD_ADDR>
  3. transfer the file via YMODEM
  4. send: fatwrite mmc <MMC_DEV>:<MMC_PART> <LOAD_ADDR> <dest-name> <hex-size>
  5. send: fatls mmc <MMC_DEV>:<MMC_PART> <dest-name>

Environment:
  SERIAL_PATH  default /dev/cu.usbmodem2102
  BAUD         default 115200
  MMC_DEV      default 1
  MMC_PART     default 1
  LOAD_ADDR    default 0x90000000
  PROMPT_RE    default =>\\s*$
  LINE_ENDING  default cr      (cr | lf | crlf)
  CHAR_DELAY_MS default 5      (paced U-Boot command text)
  POST_YMODEM_DELAY_MS default 1000
Close screen/picocom first. This script owns the UART until it exits.`);
}

const args = process.argv.slice(2);
if (args[0] === '-h' || args[0] === '--help' || args.length < 1) {
  usage();
  process.exit(args.length < 1 ? 2 : 0);
}

const sourcePath = resolve(args[0]);
const destName = args[1] ?? basename(sourcePath);
if (destName.length === 0 || destName.includes('/')) {
  throw new Error(`dest-name must be a plain filename, got: ${destName}`);
}

const serialPath = process.env.SERIAL_PATH ?? '/dev/cu.usbmodem2102';
const baudRate = Number.parseInt(process.env.BAUD ?? '115200', 10);
const mmcDev = process.env.MMC_DEV ?? '1';
const mmcPart = process.env.MMC_PART ?? '1';
const loadAddr = process.env.LOAD_ADDR ?? '0x90000000';
const promptRe = new RegExp(process.env.PROMPT_RE ?? '=>\\s*$');
const charDelayMs = Number.parseInt(process.env.CHAR_DELAY_MS ?? '5', 10);
const postYmodemDelayMs = Number.parseInt(process.env.POST_YMODEM_DELAY_MS ?? '1000', 10);
const lineEnding = lineEndingFromEnv(process.env.LINE_ENDING ?? 'cr');
const data = await readFile(sourcePath);
const fatwriteSize = `0x${data.byteLength.toString(16)}`;

const port = new SerialPort({
  path: serialPath,
  baudRate,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: false,
});

let rxText = '';
let rxBytes = [];
port.on('data', (chunk) => {
  rxBytes.push(...chunk);
  rxText += chunk.toString('utf8');
});

function log(message) {
  process.stderr.write(`==> ${message}\n`);
}

function lineEndingFromEnv(value) {
  switch (value) {
    case 'cr':
      return '\r';
    case 'lf':
      return '\n';
    case 'crlf':
      return '\r\n';
    default:
      throw new Error(`LINE_ENDING must be cr, lf, or crlf, got: ${value}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transcriptFrom(cursor) {
  return rxText.slice(cursor).replace(/\r/g, '');
}

async function openPort() {
  await new Promise((resolve, reject) => {
    port.open((error) => (error ? reject(error) : resolve()));
  });
}

async function writeBytes(bytes) {
  const buffer = Buffer.from(bytes);
  await new Promise((resolve, reject) => {
    port.write(buffer, (error) => {
      if (error) {
        reject(error);
        return;
      }
      port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
    });
  });
}

async function writeText(text) {
  for (const char of text) {
    await writeBytes(Buffer.from(char, 'utf8'));
    if (charDelayMs > 0) {
      await sleep(charDelayMs);
    }
  }
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function waitForPrompt(cursor, label, timeoutMs = 15_000) {
  await waitUntil(() => promptRe.test(transcriptFrom(cursor)), timeoutMs, label);
}

async function waitForByte(value, startIndex, label, timeoutMs = 30_000) {
  await waitUntil(() => rxBytes.slice(startIndex).includes(value), timeoutMs, label);
}

async function waitForAnyByte(values, startIndex, label, timeoutMs = 30_000) {
  const valueSet = new Set(values);
  await waitUntil(() => rxBytes.slice(startIndex).some((value) => valueSet.has(value)), timeoutMs, label);
  return rxBytes.slice(startIndex).find((value) => valueSet.has(value));
}

async function command(text, label = text, timeoutMs = 15_000) {
  const cursor = rxText.length;
  await writeText(`${text}${lineEnding}`);
  await waitForPrompt(cursor, label, timeoutMs);
  return transcriptFrom(cursor);
}

try {
  log(`opening ${serialPath} @ ${baudRate}`);
  await openPort();

  log('synchronizing with U-Boot prompt');
  let cursor = rxText.length;
  await writeText(lineEnding);
  await waitForPrompt(cursor, 'U-Boot prompt', 10_000);

  log(`selecting mmc ${mmcDev}`);
  process.stdout.write(await command(`mmc dev ${mmcDev}`, 'mmc dev'));

  log(`requesting YMODEM load to ${loadAddr}`);
  const loadyCursor = rxText.length;
  const startBytes = rxBytes.length;
  await writeText(`loady ${loadAddr}${lineEnding}`);
  await waitForByte(YMODEM_C, startBytes, 'YMODEM receiver C', 30_000);

  log(`sending ${destName} (${data.byteLength} bytes) via YMODEM`);
  const frames = buildYmodemFrames(destName, new Uint8Array(data));
  let replyStart = rxBytes.length;
  await writeBytes(frames.header);
  await waitForByte(YMODEM_ACK, replyStart, 'YMODEM header ACK', 10_000);
  await waitForByte(YMODEM_C, replyStart, 'YMODEM data C', 10_000);

  let blockIndex = 0;
  for (const block of frames.dataBlocks) {
    blockIndex += 1;
    replyStart = rxBytes.length;
    await writeBytes(block);
    await waitForByte(YMODEM_ACK, replyStart, `YMODEM block ${blockIndex} ACK`, 30_000);
  }

  replyStart = rxBytes.length;
  await writeBytes(Uint8Array.of(YMODEM_EOT));
  const eotReply = await waitForAnyByte([YMODEM_ACK, YMODEM_NAK], replyStart, 'YMODEM EOT ACK/NAK', 10_000);
  if (eotReply === YMODEM_NAK) {
    replyStart = rxBytes.length;
    await writeBytes(Uint8Array.of(YMODEM_EOT));
    await waitForByte(YMODEM_ACK, replyStart, 'YMODEM second EOT ACK', 10_000);
  }
  await waitForAnyByte([YMODEM_C, YMODEM_ACK], replyStart, 'YMODEM final C/ACK', 10_000);
  replyStart = rxBytes.length;
  await writeBytes(frames.end);
  await waitForByte(YMODEM_ACK, replyStart, 'YMODEM end ACK', 10_000);
  await waitForPrompt(loadyCursor, 'U-Boot prompt after loady', 30_000);
  await sleep(postYmodemDelayMs);

  log(`writing ${destName} to mmc ${mmcDev}:${mmcPart} (${fatwriteSize})`);
  process.stdout.write(await command(
    `fatwrite mmc ${mmcDev}:${mmcPart} ${loadAddr} ${destName} ${fatwriteSize}`,
    'fatwrite',
    60_000,
  ));

  log(`verifying directory entry for ${destName}`);
  process.stdout.write(await command(`fatls mmc ${mmcDev}:${mmcPart} ${destName}`, 'fatls', 15_000));
  log('deploy complete');
} finally {
  try {
    if (port.isOpen) {
      port.close(() => undefined);
    }
  } catch {
    // Best-effort close; process exit releases the file descriptor.
  }
}
