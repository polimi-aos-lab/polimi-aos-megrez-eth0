import { basename, join } from 'node:path';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { SerialPort } from 'serialport';
import type { SerialPortLike } from './serial.js';
import { classifySerialText, mmcFailurePattern } from './board-classifier.js';
import type {
  Backend,
  BackendKind,
  BoardPhase,
  BootRequest,
  BootResult,
  DeployFile,
  DeployRequest,
  DeployResult,
  ObserveRequest,
  ObserveResult,
  OpContext,
  ResetRequest,
  ResetResult,
  RunRequest,
  RunResult,
  UbootCommandResult,
  UbootFatwriteRequest,
  UbootFatwriteResult,
  UbootLineEnding,
  UbootRunRequest,
  UbootRunResult,
  UbootStorageInterface,
} from './types.js';
import {
  YMODEM_ACK,
  YMODEM_C,
  YMODEM_EOT,
  YMODEM_NAK,
  buildYmodemFrames,
} from './ymodem.js';
import { DomainError, ErrorCode, NotImplementedError } from '../result.js';

export interface BoardBackendOptions {
  serialPath: string;
  baudRate: number;
  sdBootDir?: string;
  openPort?: () => SerialPortLike;
}

interface BoardObserveOutcome {
  reached: boolean;
  phase?: BoardPhase;
  matched?: string;
}

const UBOOT_PROMPT_PATTERN = /(?:^|[\r\n])(?:=>|U-Boot>)\s*$/;
const DEFAULT_UBOOT_LOAD_ADDR = '0x90000000';
const DEFAULT_UBOOT_TIMEOUT_MS = 30_000;
const DEFAULT_UBOOT_CHAR_DELAY_MS = 5;
const DEFAULT_UBOOT_STORAGE_INTERFACE: UbootStorageInterface = 'mmc';
const DEFAULT_UBOOT_STORAGE_DEV = 1;
const DEFAULT_UBOOT_STORAGE_PART = 1;

export class BoardBackend implements Backend {
  readonly kind: BackendKind = 'board';
  private port: SerialPortLike | undefined;
  private rxText = '';
  private rxBytes: number[] = [];
  private readonly waiters = new Set<() => void>();
  private activeContext: OpContext | undefined;

  constructor(private readonly options: BoardBackendOptions) {}

  async open(): Promise<void> {
    if (this.port?.isOpen === true) {
      return;
    }

    const serialPath = this.serialPath();
    const port = this.options.openPort === undefined
      ? new SerialPort({
        path: serialPath,
        baudRate: this.options.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        autoOpen: false,
      })
      : this.options.openPort();
    port.on('data', this.onData);
    this.port = port;

    await new Promise<void>((resolve, reject) => {
      port.open((error) => {
        if (error) {
          reject(new DomainError(ErrorCode.SERIAL_UNAVAILABLE, `cannot open ${serialPath}: ${error.message}`, { retriable: true, cause: error }));
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const port = this.port;
    if (port === undefined) {
      return;
    }

    this.port = undefined;
    port.off('data', this.onData);
    if (!port.isOpen) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      port.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async deploy(request: DeployRequest, context: OpContext): Promise<DeployResult> {
    return await this.withContext(context, async () => {
      if (request.method === 'sd-copy' || (request.method === undefined && this.options.sdBootDir !== undefined)) {
        return await this.deployToMountedSd(request.files, request.verify ?? true);
      }
      const deployed = [];
      for (const file of request.files) {
        deployed.push(await this.deployViaYmodem(file, context));
      }
      return { deployed, verified: false };
    });
  }

  async boot(request: BootRequest, context: OpContext): Promise<BootResult> {
    return await this.withContext(context, async () => {
      if (request.source === 'payload') {
        throw new NotImplementedError('payload boot is deferred until a payload deploy contract exists');
      }
      await this.writeText('boot\n', context);
      const waitFor = request.waitFor ?? 'linux_shell';
      if (waitFor === 'unknown' || waitFor === 'off') {
        throw new DomainError(ErrorCode.BAD_STATE, `boot cannot wait for phase ${waitFor}`, { retriable: true });
      }
      const outcome = await this.observeUntil({ until: waitFor, timeoutMs: request.timeoutMs ?? 120_000 }, context);
      if (!outcome.reached) {
        throw new DomainError(ErrorCode.TIMEOUT, `boot did not reach ${waitFor}`, { retriable: true });
      }
      return { reached: outcome.phase ?? waitFor, bootflow: 'sd@50460000.bootdev.part_1 /boot.scr' };
    });
  }

  async run(request: RunRequest, context: OpContext): Promise<RunResult> {
    return await this.withContext(context, async () => {
      const start = this.rxText.length;
      const marker = `__MCP_EXIT_${randomUUID().replaceAll('-', '')}`;
      await this.writeText(`(${request.command}); printf '\\n${marker}:%s\\n' "$?"\n`, context);
      const timeoutMs = request.timeoutMs ?? 30_000;
      const exitPattern = new RegExp(`${marker}:(\\d+)`);
      const outcome = await this.waitForPattern(exitPattern, start, timeoutMs, context);
      const rawOutput = this.rxText.slice(start);
      const exitMatch = exitPattern.exec(rawOutput);
      const exitCode = exitMatch === null ? undefined : Number.parseInt(exitMatch[1]!, 10);
      const beforeMarker = exitMatch === null ? rawOutput : rawOutput.slice(0, exitMatch.index);
      const output = this.stripCommandEcho(beforeMarker, request.command);
      const expectMatch = request.expect === undefined ? true : new RegExp(request.expect, 'm').test(output);
      return {
        output,
        ...(exitCode === undefined ? {} : { exitCode }),
        matched: outcome.reached && expectMatch,
        timedOut: !outcome.reached,
      };
    });
  }

  async ubootRun(request: UbootRunRequest, context: OpContext): Promise<UbootRunResult> {
    return await this.withContext(context, async () => {
      await this.open();
      await this.syncUbootPrompt(context, request.timeoutMs ?? 10_000);
      const outputStart = this.rxText.length;
      const timeoutMs = request.timeoutMs ?? DEFAULT_UBOOT_TIMEOUT_MS;
      const lineEnding = request.lineEnding ?? 'cr';
      const charDelayMs = request.charDelayMs ?? DEFAULT_UBOOT_CHAR_DELAY_MS;
      const commandResults: UbootCommandResult[] = [];
      let timedOut = false;

      for (const [index, command] of request.commands.entries()) {
        const waitForPrompt = index < request.commands.length - 1 || request.finalWaitForPrompt !== false;
        const result = await this.executeUbootCommand(command, context, {
          timeoutMs,
          waitForPrompt,
          lineEnding,
          charDelayMs,
          ...(index === request.commands.length - 1 && request.expect !== undefined && request.finalWaitForPrompt === false ? { expect: new RegExp(request.expect, 'm') } : {}),
        });
        commandResults.push(result);
        if (!result.promptReached && waitForPrompt) {
          timedOut = true;
          break;
        }
      }

      const output = this.cleanUbootTranscript(this.rxText.slice(outputStart));
      const matched = request.expect === undefined ? !timedOut : new RegExp(request.expect, 'm').test(output);
      if (request.expect !== undefined && !matched && request.finalWaitForPrompt === false) {
        timedOut = true;
      }
      return { output, commands: commandResults, matched, timedOut };
    });
  }

  async ubootFatwrite(request: UbootFatwriteRequest, context: OpContext): Promise<UbootFatwriteResult> {
    return await this.withContext(context, async () => {
      const file = await this.validateDeployFile(request.file);
      const destName = this.assertPlainFatName(request.destName ?? basename(request.file.path));
      const loadAddr = this.assertUbootAddress(request.loadAddr ?? DEFAULT_UBOOT_LOAD_ADDR);
      const storageInterface = request.interface ?? DEFAULT_UBOOT_STORAGE_INTERFACE;
      const dev = request.dev ?? DEFAULT_UBOOT_STORAGE_DEV;
      const part = request.part ?? DEFAULT_UBOOT_STORAGE_PART;
      const timeoutMs = request.timeoutMs ?? DEFAULT_UBOOT_TIMEOUT_MS;
      const lineEnding = request.lineEnding ?? 'cr';
      const charDelayMs = request.charDelayMs ?? DEFAULT_UBOOT_CHAR_DELAY_MS;

      await this.open();
      await this.syncUbootPrompt(context, timeoutMs);
      if (storageInterface === 'usb') {
        const usb = await this.executeUbootCommand('usb start', context, { timeoutMs, waitForPrompt: true, lineEnding, charDelayMs });
        this.assertUbootCommandSucceeded('usb start', usb.output);
      }
      const select = await this.executeUbootCommand(`${storageInterface} dev ${dev}`, context, { timeoutMs, waitForPrompt: true, lineEnding, charDelayMs });
      this.assertUbootCommandSucceeded(`${storageInterface} dev ${dev}`, select.output);

      await this.loadYmodemToRam(loadAddr, destName, file.data, context, { timeoutMs, lineEnding, charDelayMs });
      const sizeHex = `0x${file.data.byteLength.toString(16)}`;
      const fatwrite = await this.executeUbootCommand(
        `fatwrite ${storageInterface} ${dev}:${part} ${loadAddr} ${destName} ${sizeHex}`,
        context,
        { timeoutMs, waitForPrompt: true, lineEnding, charDelayMs },
      );
      this.assertUbootCommandSucceeded('fatwrite', fatwrite.output);

      const verify = request.verify ?? true;
      if (verify) {
        const listing = await this.executeUbootCommand(`fatls ${storageInterface} ${dev}:${part}`, context, {
          timeoutMs,
          waitForPrompt: true,
          lineEnding,
          charDelayMs,
        });
        this.assertUbootCommandSucceeded('fatls', listing.output);
        this.assertFatlsEntry(destName, file.data.byteLength, listing.output);
      }

      return { path: destName, size: file.data.byteLength, loadAddr, interface: storageInterface, dev, part, verified: verify };
    });
  }
  async observe(request: ObserveRequest, context: OpContext): Promise<ObserveResult> {
    return await this.withContext(context, async () => {
      const outcome = await this.observeUntil(request, context);
      return outcome.matched === undefined
        ? { reached: outcome.reached }
        : { reached: outcome.reached, matched: outcome.matched };
    });
  }

  async reset(_request: ResetRequest, _context: OpContext): Promise<ResetResult> {
    throw new NotImplementedError('reset policy is deferred to bead polimi-aos-megrez-eth0-60f.5');
  }

  private async deployToMountedSd(files: DeployFile[], verify: boolean): Promise<DeployResult> {
    if (this.options.sdBootDir === undefined) {
      throw new DomainError(ErrorCode.BAD_STATE, 'MCP_SD_BOOT_DIR, MEGREZ_SD_MOUNT, or SD_BOOT_DIR is required for sd-copy deploy', { retriable: true });
    }

    await mkdir(this.options.sdBootDir, { recursive: true });
    const deployed = [];
    for (const file of files) {
      const sourceStat = await stat(file.path);
      if (file.size !== undefined && sourceStat.size !== file.size) {
        throw new DomainError(ErrorCode.DEPLOY_VERIFY_FAILED, `source size mismatch for ${file.path}: expected ${file.size}, got ${sourceStat.size}`, { retriable: true });
      }

      const destination = join(this.options.sdBootDir, basename(file.path));
      await copyFile(file.path, destination);
      if (verify || file.sha256 !== undefined) {
        const destinationStat = await stat(destination);
        if (destinationStat.size !== sourceStat.size) {
          throw new DomainError(ErrorCode.DEPLOY_VERIFY_FAILED, `copied size mismatch for ${destination}`, { retriable: true });
        }
        if (file.sha256 !== undefined) {
          const digest = createHash('sha256').update(await readFile(destination)).digest('hex');
          if (digest.toLowerCase() !== file.sha256.toLowerCase()) {
            throw new DomainError(ErrorCode.DEPLOY_VERIFY_FAILED, `sha256 mismatch for ${destination}`, { retriable: true });
          }
        }
      }
      deployed.push({ path: destination, size: sourceStat.size });
    }
    return { deployed, verified: verify };
  }

  private async deployViaYmodem(file: DeployFile, context: OpContext): Promise<{ path: string; size: number }> {
    await this.open();
    const data = await readFile(file.path);
    const name = basename(file.path);
    const startCursor = this.rxBytes.length;
    await this.writeText('rz -y\n', context);
    await this.waitForByte(YMODEM_C, 30_000, context.signal, startCursor);
    const frames = buildYmodemFrames(name, data);
    let replyStart = this.rxBytes.length;
    await this.writeBytes(frames.header, context);
    await this.waitForByte(YMODEM_ACK, 10_000, context.signal, replyStart);
    await this.waitForByte(YMODEM_C, 10_000, context.signal);
    for (const block of frames.dataBlocks) {
      replyStart = this.rxBytes.length;
      await this.writeBytes(block, context);
      await this.waitForByte(YMODEM_ACK, 30_000, context.signal, replyStart);
    }
    replyStart = this.rxBytes.length;
    await this.writeBytes(Uint8Array.of(YMODEM_EOT), context);
    const eotReply = await this.waitForAnyByte([YMODEM_ACK, YMODEM_NAK], 10_000, context.signal, replyStart);
    if (eotReply === YMODEM_NAK) {
      replyStart = this.rxBytes.length;
      await this.writeBytes(Uint8Array.of(YMODEM_EOT), context);
      await this.waitForByte(YMODEM_ACK, 10_000, context.signal, replyStart);
    }
    await this.waitForAnyByte([YMODEM_C, YMODEM_ACK], 10_000, context.signal, replyStart);
    replyStart = this.rxBytes.length;
    await this.writeBytes(frames.end, context);
    await this.waitForByte(YMODEM_ACK, 10_000, context.signal, replyStart);
    return { path: name, size: data.byteLength };
  }

  private async executeUbootCommand(
    command: string,
    context: OpContext,
    options: {
      timeoutMs: number;
      waitForPrompt: boolean;
      lineEnding: UbootLineEnding;
      charDelayMs: number;
      expect?: RegExp;
    },
  ): Promise<{ command: string; output: string; promptReached: boolean }> {
    const start = this.rxText.length;
    await this.writeUbootCommand(command, context, options.lineEnding, options.charDelayMs);
    if (!options.waitForPrompt) {
      if (options.expect !== undefined) {
        const outcome = await this.waitForPattern(options.expect, start, options.timeoutMs, context);
        return { command, output: this.stripUbootCommandOutput(this.rxText.slice(start), command), promptReached: outcome.phase === 'uboot' };
      }
      return { command, output: this.stripUbootCommandOutput(this.rxText.slice(start), command), promptReached: false };
    }

    const promptReached = await this.waitForUbootPrompt(start, options.timeoutMs, context.signal);
    return { command, output: this.stripUbootCommandOutput(this.rxText.slice(start), command), promptReached };
  }

  private async loadYmodemToRam(
    loadAddr: string,
    destName: string,
    data: Uint8Array,
    context: OpContext,
    options: { timeoutMs: number; lineEnding: UbootLineEnding; charDelayMs: number },
  ): Promise<void> {
    const startCursor = this.rxBytes.length;
    const textStart = this.rxText.length;
    await this.writeUbootCommand(`loady ${loadAddr}`, context, options.lineEnding, options.charDelayMs);
    await this.waitForByte(YMODEM_C, options.timeoutMs, context.signal, startCursor);
    const frames = buildYmodemFrames(destName, data);

    let replyStart = this.rxBytes.length;
    await this.writeBytes(frames.header, context);
    await this.waitForByte(YMODEM_ACK, 10_000, context.signal, replyStart);
    await this.waitForByte(YMODEM_C, 10_000, context.signal, replyStart);
    for (const block of frames.dataBlocks) {
      replyStart = this.rxBytes.length;
      await this.writeBytes(block, context);
      await this.waitForByte(YMODEM_ACK, options.timeoutMs, context.signal, replyStart);
    }

    replyStart = this.rxBytes.length;
    await this.writeBytes(Uint8Array.of(YMODEM_EOT), context);
    const eotReply = await this.waitForAnyByte([YMODEM_ACK, YMODEM_NAK], 10_000, context.signal, replyStart);
    if (eotReply === YMODEM_NAK) {
      replyStart = this.rxBytes.length;
      await this.writeBytes(Uint8Array.of(YMODEM_EOT), context);
      await this.waitForByte(YMODEM_ACK, 10_000, context.signal, replyStart);
    }

    await this.waitForAnyByte([YMODEM_C, YMODEM_ACK], 10_000, context.signal, replyStart);
    replyStart = this.rxBytes.length;
    await this.writeBytes(frames.end, context);
    await this.waitForByte(YMODEM_ACK, 10_000, context.signal, replyStart);
    await this.waitForUbootPrompt(textStart, options.timeoutMs, context.signal);
  }

  private async syncUbootPrompt(context: OpContext, timeoutMs: number): Promise<void> {
    const start = this.rxText.length;
    await this.writeText('\r', context);
    const reached = await this.waitForUbootPrompt(start, timeoutMs, context.signal);
    if (!reached) {
      throw new DomainError(ErrorCode.TIMEOUT, 'timed out waiting for U-Boot prompt', { retriable: true });
    }
    context.setPhase('uboot');
  }

  private async waitForUbootPrompt(fromTextOffset: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (UBOOT_PROMPT_PATTERN.test(this.rxText.slice(fromTextOffset))) {
        return true;
      }
      await this.waitForData(Math.max(1, deadline - Date.now()), signal);
    }
    return false;
  }

  private async writeUbootCommand(command: string, context: OpContext, lineEnding: UbootLineEnding, charDelayMs: number): Promise<void> {
    const ending = lineEnding === 'cr' ? '\r' : lineEnding === 'lf' ? '\n' : '\r\n';
    const line = `${command}${ending}`;
    if (charDelayMs <= 0) {
      await this.writeText(line, context);
      return;
    }
    for (const char of line) {
      await this.writeText(char, context);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, charDelayMs).unref();
      });
    }
  }

  private async validateDeployFile(file: DeployFile): Promise<{ data: Buffer }> {
    const data = await readFile(file.path);
    if (file.size !== undefined && data.byteLength !== file.size) {
      throw new DomainError(ErrorCode.DEPLOY_VERIFY_FAILED, `source size mismatch for ${file.path}: expected ${file.size}, got ${data.byteLength}`, { retriable: true });
    }
    if (file.sha256 !== undefined) {
      const digest = createHash('sha256').update(data).digest('hex');
      if (digest.toLowerCase() !== file.sha256.toLowerCase()) {
        throw new DomainError(ErrorCode.DEPLOY_VERIFY_FAILED, `source sha256 mismatch for ${file.path}`, { retriable: true });
      }
    }
    return { data };
  }

  private assertPlainFatName(name: string): string {
    if (!/^[^/\s]+$/.test(name)) {
      throw new DomainError(ErrorCode.BAD_STATE, `U-Boot fatwrite destination must be a plain filename: ${name}`, { retriable: false });
    }
    return name;
  }

  private assertUbootAddress(address: string): string {
    if (!/^0x[0-9a-fA-F]+$/.test(address)) {
      throw new DomainError(ErrorCode.BAD_STATE, `U-Boot load address must be hexadecimal: ${address}`, { retriable: false });
    }
    return address;
  }

  private assertUbootCommandSucceeded(label: string, output: string): void {
    if (/\b(?:Unknown command|Usage:|Error|Unable|fail(?:ed)?|not found|Bad)\b/i.test(output)) {
      throw new DomainError(ErrorCode.BAD_STATE, `U-Boot ${label} failed`, { retriable: true, detail: output });
    }
  }

  private assertFatlsEntry(name: string, size: number, output: string): void {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const entryPattern = new RegExp(`(^|\\s)${size}\\s+${escaped}(\\s|$)`, 'm');
    if (!entryPattern.test(output)) {
      throw new DomainError(ErrorCode.DEPLOY_VERIFY_FAILED, `fatls did not show ${name} with size ${size}`, { retriable: true, detail: output });
    }
  }

  private async observeUntil(request: ObserveRequest, context: OpContext): Promise<BoardObserveOutcome> {
    const start = this.rxText.length;
    const timeoutMs = request.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    const pattern = request.pattern === undefined ? undefined : new RegExp(request.pattern, 'm');

    while (Date.now() < deadline) {
      const window = this.rxText.slice(start);
      if (mmcFailurePattern.test(window)) {
        context.setPhase('uboot');
        throw new DomainError(ErrorCode.BAD_STATE, 'MMC boot device unavailable on UART', { retriable: true });
      }
      const phase = classifySerialText(window);
      if (phase !== undefined) {
        context.setPhase(phase);
        if (phase === 'panic' && request.until !== 'panic') {
          throw new DomainError(ErrorCode.PANIC, 'kernel panic observed on UART', { retriable: false });
        }
        if (request.until !== 'pattern' && request.until !== 'timeout' && phase === request.until) {
          return { reached: true, phase, matched: phase };
        }
      }

      if (pattern !== undefined) {
        const match = pattern.exec(window);
        if (match !== null) {
          return phase === undefined
            ? { reached: true, matched: match[0] }
            : { reached: true, phase, matched: match[0] };
        }
      }

      await this.waitForData(Math.max(1, deadline - Date.now()), context.signal);
    }

    if (request.until === 'timeout') {
      return { reached: true, matched: 'timeout' };
    }
    return { reached: false };
  }

  private async waitForPattern(pattern: RegExp, fromTextOffset: number, timeoutMs: number, context: OpContext): Promise<BoardObserveOutcome> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const window = this.rxText.slice(fromTextOffset);
      const phase = classifySerialText(window);
      if (phase !== undefined) {
        context.setPhase(phase);
      }
      const match = pattern.exec(window);
      if (match !== null) {
        return phase === undefined
          ? { reached: true, matched: match[0] }
          : { reached: true, phase, matched: match[0] };
      }
      await this.waitForData(Math.max(1, deadline - Date.now()), context.signal);
    }
    return { reached: false };
  }

  private async waitForByte(byte: number, timeoutMs: number, signal: AbortSignal, fromIndex = this.rxBytes.length): Promise<void> {
    await this.waitForAnyByte([byte], timeoutMs, signal, fromIndex);
  }

  private async waitForAnyByte(bytes: number[], timeoutMs: number, signal: AbortSignal, fromIndex = this.rxBytes.length): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let cursor = fromIndex;
    while (Date.now() < deadline) {
      for (let index = cursor; index < this.rxBytes.length; index += 1) {
        const value = this.rxBytes[index];
        if (value !== undefined && bytes.includes(value)) {
          return value;
        }
      }
      cursor = this.rxBytes.length;
      await this.waitForData(Math.max(1, deadline - Date.now()), signal);
    }
    throw new DomainError(ErrorCode.TIMEOUT, `timed out waiting for byte ${bytes.map((value) => `0x${value.toString(16)}`).join('/')}`, { retriable: true });
  }

  private async waitForData(timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new DomainError(ErrorCode.TIMEOUT, 'operation aborted', { retriable: true });
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
      const waiter = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new DomainError(ErrorCode.TIMEOUT, 'operation aborted', { retriable: true }));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.waiters.delete(waiter);
      };
      this.waiters.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async writeText(text: string, context: OpContext): Promise<void> {
    await this.writeBytes(Buffer.from(text, 'utf8'), context);
  }

  private async writeBytes(bytes: Uint8Array, context: OpContext): Promise<void> {
    await this.open();
    const port = this.port;
    if (port === undefined) {
      throw new DomainError(ErrorCode.SERIAL_UNAVAILABLE, 'serial port is not open', { retriable: true });
    }

    context.log('tx', Buffer.from(bytes).toString('binary'));
    await new Promise<void>((resolve, reject) => {
      port.write(Buffer.from(bytes), (writeError) => {
        if (writeError) {
          reject(writeError);
          return;
        }
        port.drain((drainError) => {
          if (drainError) {
            reject(drainError);
            return;
          }
          resolve();
        });
      });
    });
  }

  private stripCommandEcho(rawOutput: string, command: string): string {
    const normalized = rawOutput.replace(/\r/g, '');
    const lines = normalized.split('\n');
    if (lines[0]?.trim() === command.trim()) {
      lines.shift();
    }
    return lines.join('\n').replace(/\n?~ #\s*$/, '').trim();
  }

  private stripUbootCommandOutput(rawOutput: string, command: string): string {
    const normalized = this.cleanUbootTranscript(rawOutput);
    const lines = normalized.split('\n');
    while (lines.length > 0 && lines[0]?.trim().length === 0) {
      lines.shift();
    }
    if (lines[0]?.trim() === command.trim()) {
      lines.shift();
    }
    return lines
      .join('\n')
      .replace(/(?:^|\n)(?:=>|U-Boot>)\s*$/g, '')
      .trim();
  }

  private cleanUbootTranscript(text: string): string {
    return text
      .replace(/\r/g, '')
      .replace(/\u0001/g, '<SOH>')
      .replace(/\u0002/g, '<STX>')
      .replace(/\u0004/g, '<EOT>')
      .replace(/\u0006/g, '<ACK>')
      .replace(/\u0015/g, '<NAK>');
  }

  private serialPath(): string {
    if (process.platform === 'darwin' && this.options.serialPath.includes('/dev/tty.')) {
      return this.options.serialPath.replace('/dev/tty.', '/dev/cu.');
    }
    return this.options.serialPath;
  }

  private async withContext<T>(context: OpContext, operation: () => Promise<T>): Promise<T> {
    const previous = this.activeContext;
    this.activeContext = context;
    try {
      return await operation();
    } finally {
      this.activeContext = previous;
    }
  }

  private readonly onData = (chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    this.rxText = `${this.rxText}${text}`.slice(-262_144);
    this.rxBytes.push(...chunk);
    if (this.rxBytes.length > 262_144) {
      this.rxBytes.splice(0, this.rxBytes.length - 262_144);
    }
    this.activeContext?.log('rx', text);
    for (const waiter of this.waiters) {
      waiter();
    }
  };
}
