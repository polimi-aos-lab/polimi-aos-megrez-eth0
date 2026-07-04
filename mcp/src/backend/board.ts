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

    const port = this.options.openPort === undefined
      ? new SerialPort({
        path: this.options.serialPath,
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
          reject(new DomainError(ErrorCode.SERIAL_UNAVAILABLE, `cannot open ${this.options.serialPath}: ${error.message}`, { retriable: true, cause: error }));
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
    await this.writeBytes(frames.header, context);
    await this.waitForByte(YMODEM_ACK, 10_000, context.signal);
    await this.waitForByte(YMODEM_C, 10_000, context.signal);
    for (const block of frames.dataBlocks) {
      await this.writeBytes(block, context);
      await this.waitForByte(YMODEM_ACK, 30_000, context.signal);
    }
    await this.writeBytes(Uint8Array.of(YMODEM_EOT), context);
    const eotReply = await this.waitForAnyByte([YMODEM_ACK, YMODEM_NAK], 10_000, context.signal);
    if (eotReply === YMODEM_NAK) {
      await this.writeBytes(Uint8Array.of(YMODEM_EOT), context);
      await this.waitForByte(YMODEM_ACK, 10_000, context.signal);
    }
    await this.waitForAnyByte([YMODEM_C, YMODEM_ACK], 10_000, context.signal);
    await this.writeBytes(frames.end, context);
    await this.waitForByte(YMODEM_ACK, 10_000, context.signal);
    return { path: name, size: data.byteLength };
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
