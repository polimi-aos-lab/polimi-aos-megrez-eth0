#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(new URL('../package.json', import.meta.url));
const { SerialPort } = require('serialport');

const serialPath = process.env.SERIAL_PATH ?? '/dev/cu.usbmodem2102';
const baudRate = Number.parseInt(process.env.BAUD_RATE ?? '115200', 10);
const logPath = process.env.LOG_PATH ?? `stage/logs/board-uboot-tftp-watch-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
const serverIp = process.env.SERVERIP ?? process.env.serverip ?? '192.168.188.132';
const ipAddr = process.env.IPADDR ?? process.env.ipaddr ?? '192.168.188.110';
const scriptAddr = process.env.SCRIPT_ADDR ?? '0x88100000';
const bootScript = process.env.BOOT_SCRIPT ?? 'boot.scr';
const promptTimeoutMs = Number.parseInt(process.env.PROMPT_TIMEOUT_MS ?? '180000', 10);
const bootTimeoutMs = Number.parseInt(process.env.BOOT_TIMEOUT_MS ?? '180000', 10);
const pokeIntervalMs = Number.parseInt(process.env.POKE_INTERVAL_MS ?? '1000', 10);
const txCharDelayMs = Number.parseInt(process.env.TX_CHAR_DELAY_MS ?? '10', 10);
const commandTimeoutMs = Number.parseInt(process.env.COMMAND_TIMEOUT_MS ?? '120000', 10);
const exitOnSuccess = process.env.EXIT_ON_SUCCESS !== '0';
const postSuccessCommand = process.env.POST_SUCCESS_COMMAND ?? '';
const postSuccessDelayMs = Number.parseInt(process.env.POST_SUCCESS_DELAY_MS ?? '500', 10);


const promptPattern = /=>\s*$/m;
const resetPatterns = [
  /pll config ok/i,
  /DDR self test OK/i,
  /OpenSBI v/i,
  /U-Boot 20/i,
  /PHY[01] training process/i,
  /Reboot in five seconds/i,
];
const failPatterns = [
  /\(XEN\).*Panic on CPU/i,
  /Size of "memory" property doesn't match/i,
  /Failed to (assign|allocate) requested static memory/i,
  /Kernel panic - not syncing/i,
  /\(XEN\).*crash/i,
  /Unhandled (exception|trap|guest)/i,
  /CAUSE_[A-Z_]*GUEST_PAGE_FAULT/i,
  /failed to bring up eth/i,
];
const successPatterns = [
  /brought up eth\d/i,
  /link\/ether/i,
  / login:/,
  /Megrez initramfs ready/i,
];
const progressPatterns = [
  /Filename 'boot\.scr'/i,
  /## Executing script/i,
  /Starting kernel/i,
  /All set up/i,
  /xen,static-mem debug/i,
  /DIRECT-MAP STATIC BANK/i,
  /\*\*\* LOADING DOMU/i,
  /Freeing unused kernel/i,
  /Run \/init as init process/i,
  /Megrez initramfs ready/i,
  /stmmac/i,
  /eth\d: /i,
];

mkdirSync(dirname(logPath), { recursive: true });
const log = createWriteStream(logPath, { flags: 'a' });
let rolling = '';
let phase = 'open';
let exitStarted = false;
let promptSeen = false;
let monitoring = false;
let scanCarry = '';
let failHit = null;
let resetHit = null;
let successHit = null;
let promptReturn = false;
let postSuccessSent = false;
const reportedProgress = new Set();
const keepAlive = setInterval(() => {}, 1000);


function stamp(message) {
  return `[watch ${new Date().toISOString()}] ${message}\n`;
}

function writeBoth(text) {
  process.stdout.write(text);
  log.write(text);
}

function note(message) {
  writeBoth(stamp(message));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function runDetectors(text) {
  scanCarry = (scanCarry + text).slice(-8192);
  if (!failHit) failHit = failPatterns.find((pattern) => pattern.test(scanCarry)) ?? null;
  if (!resetHit) resetHit = resetPatterns.find((pattern) => pattern.test(scanCarry)) ?? null;
  if (!successHit) successHit = successPatterns.find((pattern) => pattern.test(scanCarry)) ?? null;
  for (const pattern of progressPatterns) {
    if (!reportedProgress.has(pattern.source) && pattern.test(scanCarry)) {
      reportedProgress.add(pattern.source);
      note(`progress marker detected: ${pattern}`);
    }
  }
  if (/=>\s*$/m.test(scanCarry)) promptReturn = true;
}

function appendChunk(buffer) {
  const text = buffer.toString('utf8');
  writeBoth(text);
  rolling = (rolling + text).slice(-65536);
  if (monitoring) runDetectors(text);
}

function writePort(port, line) {
  return new Promise((resolveWrite, rejectWrite) => {
    port.write(line, (err) => {
      if (err) {
        rejectWrite(err);
        return;
      }
      port.drain((drainErr) => (drainErr ? rejectWrite(drainErr) : resolveWrite()));
    });
  });
}

async function writePortSlow(port, text) {
  for (const ch of text) {
    await writePort(port, ch);
    if (txCharDelayMs > 0) await sleep(txCharDelayMs);
  }
}

async function waitForPromptOnly(timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (promptPattern.test(rolling)) {
      note(`U-Boot prompt detected after ${label}`);
      return;
    }
    await sleep(100);
  }
  throw new Error(`U-Boot prompt not detected after ${label} within ${timeoutMs} ms`);
}

async function sendUbootCommand(port, command, options = {}) {
  const waitPrompt = options.waitPrompt ?? true;
  const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
  note(`sending U-Boot command: ${command}`);
  rolling = '';
  await writePortSlow(port, `${command}\r`);
  if (waitPrompt) await waitForPromptOnly(timeoutMs, command);
}


async function closeAndExit(port, code, message) {
  if (exitStarted) return;
  exitStarted = true;
  note(message);
  await new Promise((resolveClose) => {
    if (!port?.isOpen) {
      resolveClose();
      return;
    }
    port.close(() => resolveClose());
  });
  clearInterval(keepAlive);

  log.end(() => process.exit(code));
}

async function waitForPrompt(port) {
  phase = 'wait-prompt';
  note(`waiting for U-Boot prompt on ${serialPath}; log=${resolve(logPath)}`);
  const deadline = Date.now() + promptTimeoutMs;
  let nextPoke = 0;

  while (Date.now() < deadline) {
    if (promptPattern.test(rolling)) {
      promptSeen = true;
      note('U-Boot prompt detected');
      return;
    }

    if (Date.now() >= nextPoke) {
      await writePortSlow(port, '\x03\r');
      nextPoke = Date.now() + pokeIntervalMs;
    }

    await sleep(100);
  }

  throw new Error(`U-Boot prompt not detected within ${promptTimeoutMs} ms`);
}

async function bootAndWatch(port) {
  phase = 'boot-watch';
  await sendUbootCommand(port, `setenv serverip ${serverIp}`);
  await sendUbootCommand(port, `setenv ipaddr ${ipAddr}`);
  await sendUbootCommand(port, 'setenv autostart no');
  await sendUbootCommand(port, `tftpboot ${scriptAddr} ${bootScript}`, { timeoutMs: commandTimeoutMs });
  await sendUbootCommand(port, `source ${scriptAddr}`, { waitPrompt: false });

  scanCarry = '';
  monitoring = true;
  const deadline = Date.now() + bootTimeoutMs;

  while (Date.now() < deadline) {
    if (failHit) {
      await closeAndExit(port, 20, `failure marker detected: ${failHit}`);
      return;
    }
    if (successHit && exitOnSuccess) {
      await closeAndExit(port, 0, `success marker detected: ${successHit}`);
      return;
    }
    if (successHit && postSuccessCommand && !postSuccessSent) {
      postSuccessSent = true;
      await sleep(postSuccessDelayMs);
      note(`sending post-success command: ${postSuccessCommand}`);
      await writePortSlow(port, `${postSuccessCommand}\r`);
    }
    if (resetHit) {
      await closeAndExit(port, 30, `board reset/reboot marker detected after boot command: ${resetHit}`);
      return;
    }
    if (promptReturn) {
      await closeAndExit(port, 31, 'returned to U-Boot prompt after boot command');
      return;
    }

    await sleep(100);
  }

  await closeAndExit(port, 40, `boot monitor timed out after ${bootTimeoutMs} ms`);
}

const port = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
port.on('data', appendChunk);
port.on('error', (err) => {
  note(`serial error: ${err.message}`);
  process.exitCode = 2;
});

async function main() {
  try {
    note(`opening ${serialPath} at ${baudRate}`);
    await new Promise((resolveOpen, rejectOpen) => {
      port.open((err) => (err ? rejectOpen(err) : resolveOpen()));
    });
    await waitForPrompt(port);
    await bootAndWatch(port);
  } catch (err) {
    await closeAndExit(port, 2, `${phase} failed: ${err.message}`);
  }
}

main();
