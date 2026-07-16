#!/usr/bin/env node
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { SerialPort } = require('serialport');

function usage() {
  console.log(`Usage: uboot-run.mjs [options] <command> [<command> ...]

Send paced commands to an already stopped U-Boot prompt over the Megrez UART.

Examples:
  scripts/uboot-run.mjs 'echo ok'
  scripts/uboot-run.mjs 'mmc dev 1' 'fatls mmc 1:1 /'
  scripts/uboot-run.mjs --log stage/boot.log --no-final-prompt \
    'if load mmc 1:1 0x88100000 /boot.scr; then source 0x88100000; else echo BOOTSCR_LOAD_FAILED; fi'

Options:
  --serial PATH          Serial device (default: SERIAL_PATH or /dev/tty.usbmodem2102)
  --baud RATE            Baud rate (default: BAUD or 115200)
  --timeout MS           Per-command wait timeout (default: TIMEOUT_MS or 30000)
  --prompt REGEX         Prompt regex (default: PROMPT_RE or =>\\s*$)
  --line-ending KIND     cr, lf, or crlf (default: LINE_ENDING or cr)
  --char-delay MS        Delay between written characters (default: CHAR_DELAY_MS or 5)
  --expect REGEX         For the final command, wait for this regex instead of only prompt
  --no-final-prompt      Do not require the final command to reach the U-Boot prompt
  --log PATH             Write the full transcript to PATH
  -h, --help             Show this help

Environment:
  SERIAL_PATH, BAUD, TIMEOUT_MS, PROMPT_RE, LINE_ENDING, CHAR_DELAY_MS

Close screen/picocom first. This command owns the UART until it exits.`);
}

function parseArgs(argv) {
  const options = {
    serialPath: process.env.SERIAL_PATH ?? '/dev/tty.usbmodem2102',
    baudRate: parsePositiveInt(process.env.BAUD ?? '115200', 'BAUD'),
    timeoutMs: parsePositiveInt(process.env.TIMEOUT_MS ?? '30000', 'TIMEOUT_MS'),
    promptSource: process.env.PROMPT_RE ?? '=>\\s*$',
    lineEndingName: process.env.LINE_ENDING ?? 'cr',
    charDelayMs: parseNonNegativeInt(process.env.CHAR_DELAY_MS ?? '5', 'CHAR_DELAY_MS'),
    expectSource: undefined,
    waitFinalPrompt: true,
    logPath: undefined,
  };
  const commands = [];

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
      case '--timeout':
        options.timeoutMs = parsePositiveInt(requireValue(argv, ++index, arg), arg);
        break;
      case '--prompt':
        options.promptSource = requireValue(argv, ++index, arg);
        break;
      case '--line-ending':
        options.lineEndingName = requireValue(argv, ++index, arg);
        break;
      case '--char-delay':
        options.charDelayMs = parseNonNegativeInt(requireValue(argv, ++index, arg), arg);
        break;
      case '--expect':
        options.expectSource = requireValue(argv, ++index, arg);
        break;
      case '--no-final-prompt':
        options.waitFinalPrompt = false;
        break;
      case '--log':
        options.logPath = requireValue(argv, ++index, arg);
        break;
      case '--':
        commands.push(...argv.slice(index + 1));
        index = argv.length;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`unknown option: ${arg}`);
        }
        commands.push(arg);
        break;
    }
  }

  if (commands.length === 0) {
    usage();
    process.exit(2);
  }

  return { options, commands };
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${value}`);
  }
  return parsed;
}

function lineEndingFromName(name) {
  switch (name) {
    case 'cr':
      return '\r';
    case 'lf':
      return '\n';
    case 'crlf':
      return '\r\n';
    default:
      throw new Error(`--line-ending must be cr, lf, or crlf, got: ${name}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stderr.write(`==> ${message}\n`);
}

const { options, commands } = parseArgs(process.argv.slice(2));
const promptRe = new RegExp(options.promptSource, 'm');
const expectRe = options.expectSource === undefined ? undefined : new RegExp(options.expectSource, 'm');
const lineEnding = lineEndingFromName(options.lineEndingName);
const port = new SerialPort({
  path: options.serialPath,
  baudRate: options.baudRate,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: false,
});

let rxText = '';
const logStream = options.logPath === undefined
  ? undefined
  : createWriteStream(options.logPath);
port.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  rxText += text;
  logStream?.write(text.replace(/\r/g, ''));
});

function transcriptFrom(cursor) {
  return rxText.slice(cursor).replace(/\r/g, '');
}

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

async function openPort() {
  const attempts = 15;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await withTimeout(
        new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve()))),
        3000,
        'serial open',
      );
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
      log(`serial open failed (${error.message}); retry ${attempt}/${attempts}`);
      await sleep(2000);
    }
  }
}

async function closePort() {
  if (!port.isOpen) {
    return;
  }
  await withTimeout(
    new Promise((resolve, reject) => port.close((error) => (error ? reject(error) : resolve()))),
    3000,
    'serial close',
  );
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
  if (options.charDelayMs === 0) {
    await writeBytes(Buffer.from(text, 'utf8'));
    return;
  }
  for (const char of text) {
    await writeBytes(Buffer.from(char, 'utf8'));
    await sleep(options.charDelayMs);
  }
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function waitForPrompt(cursor, label) {
  await waitUntil(() => promptRe.test(transcriptFrom(cursor)), options.timeoutMs, label);
}

async function waitForExpect(cursor, label) {
  if (expectRe === undefined) {
    return;
  }
  await waitUntil(() => expectRe.test(transcriptFrom(cursor)), options.timeoutMs, label);
}

async function runCommand(command, shouldWaitForPrompt, shouldWaitForExpect) {
  const cursor = rxText.length;
  await writeText(`${command}${lineEnding}`);
  if (shouldWaitForExpect) {
    await waitForExpect(cursor, `expected pattern after ${command}`);
  }
  if (shouldWaitForPrompt) {
    await waitForPrompt(cursor, command);
  }
  const transcript = transcriptFrom(cursor);
  process.stdout.write(transcript);
  if (!transcript.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

try {
  log(`opening ${options.serialPath} @ ${options.baudRate}`);
  await openPort();

  log('synchronizing with U-Boot prompt');
  const syncCursor = rxText.length;
  await writeText(lineEnding);
  await waitForPrompt(syncCursor, 'U-Boot prompt');

  for (const [index, command] of commands.entries()) {
    const isFinal = index === commands.length - 1;
    const waitForPromptAfterCommand = !isFinal || options.waitFinalPrompt;
    const waitForExpectAfterCommand = isFinal && expectRe !== undefined;
    log(`sending: ${command}`);
    await runCommand(command, waitForPromptAfterCommand, waitForExpectAfterCommand);
  }
} finally {
  if (logStream !== undefined) {
    await new Promise((resolve) => logStream.end(resolve));
  }
  if (options.logPath !== undefined) {
    await writeFile(options.logPath, rxText.replace(/\r/g, ''));
  }
  await closePort().catch(() => undefined);
}
