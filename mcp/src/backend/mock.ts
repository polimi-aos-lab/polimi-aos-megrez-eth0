import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { BoardBackend } from './board.js';
import type { SerialCallback, SerialDataHandler, SerialPortLike } from './serial.js';
import type {
  Backend,
  BackendKind,
  BoardPhase,
  BootRequest,
  BootResult,
  DeployRequest,
  DeployResult,
  ObserveRequest,
  ObserveResult,
  OpContext,
  ResetRequest,
  ResetResult,
  RunRequest,
  RunResult,
  UbootFatwriteRequest,
  UbootFatwriteResult,
  UbootRunRequest,
  UbootRunResult,
} from './types.js';
import { YMODEM_ACK, YMODEM_C, YMODEM_EOT, YMODEM_NAK, YMODEM_SOH, YMODEM_STX } from './ymodem.js';
import { DomainError, ErrorCode, NotImplementedError } from '../result.js';

export type MockScenario = 'normal' | 'panic' | 'hang' | 'mmc-fail' | 'partial-lines' | 'noisy' | 'slow-prompt';

export interface MockBackendOptions {
  scenario: MockScenario;
  delayMs: number;
}

const scenarioTable: Record<MockScenario, true> = {
  normal: true,
  panic: true,
  hang: true,
  'mmc-fail': true,
  'partial-lines': true,
  noisy: true,
  'slow-prompt': true,
};

export function parseMockScenario(value: string | undefined): MockScenario {
  if (value === undefined || value.length === 0) {
    return 'normal';
  }
  if (scenarioTable[value as MockScenario] !== true) {
    throw new Error(`MCP_MOCK_SCENARIO must be one of ${Object.keys(scenarioTable).join(', ')}`);
  }
  return value as MockScenario;
}

class ScriptedSerialPort extends EventEmitter implements SerialPortLike {
  isOpen = false;

  constructor(private readonly engine: ScenarioEngine) {
    super();
  }

  open(callback: SerialCallback): void {
    this.isOpen = true;
    this.engine.attach(this);
    callback(null);
    this.engine.onOpen();
  }

  close(callback: SerialCallback): void {
    this.isOpen = false;
    callback(null);
  }

  write(data: Buffer, callback: SerialCallback): void {
    this.engine.onTx(data);
    callback(null);
  }

  drain(callback: SerialCallback): void {
    callback(null);
  }

  override on(event: 'data', handler: SerialDataHandler): this {
    return super.on(event, handler);
  }

  override off(event: 'data', handler: SerialDataHandler): this {
    return super.off(event, handler);
  }

  emitRx(text: string | Uint8Array, delayMs: number): void {
    const chunks = typeof text === 'string' ? this.chunkText(text) : [Buffer.from(text)];
    chunks.forEach((chunk, index) => {
      setTimeout(() => {
        if (this.isOpen) {
          this.emit('data', Buffer.from(chunk));
        }
      }, delayMs * (index + 1)).unref();
    });
  }

  private chunkText(text: string): Buffer[] {
    if (this.engine.scenario !== 'partial-lines') {
      return [Buffer.from(text, 'utf8')];
    }
    const midpoint = Math.max(1, Math.floor(text.length / 2));
    return [Buffer.from(text.slice(0, midpoint), 'utf8'), Buffer.from(text.slice(midpoint), 'utf8')];
  }
}

class ScenarioEngine {
  phase: BoardPhase = 'uboot';
  private port: ScriptedSerialPort | undefined;
  private ymodemState: 'idle' | 'header' | 'data' | 'second-eot' | 'end-header' = 'idle';
  private commandBuffer = '';
  private ymodemSize = 0;
  private readonly fatFiles = new Map<string, number>();

  constructor(readonly scenario: MockScenario, private readonly delayMs: number) {}

  attach(port: ScriptedSerialPort): void {
    this.port = port;
  }

  onOpen(): void {
    this.emit('U-Boot 2024.01-mock\r\nHit any key to stop autoboot:  2\r\n=> ');
  }

  onTx(data: Buffer): void {
    const firstByte = data[0];
    if (firstByte === YMODEM_SOH || firstByte === YMODEM_STX || firstByte === YMODEM_EOT) {
      this.onYmodemTx(data);
      return;
    }

    const text = data.toString('utf8');
    if (text.includes('rz -y')) {
      this.ymodemState = 'header';
      this.emitBytes(Uint8Array.of(YMODEM_C));
      return;
    }

    const markerMatch = /\(([^]*)\); printf '\\n(__MCP_EXIT_[0-9a-f]+):%s\\n' "\$\?"\n/.exec(text);
    if (markerMatch !== null) {
      this.onRunCommand(markerMatch[1] ?? '', markerMatch[2] ?? '__MCP_EXIT_missing');
      return;
    }

    this.commandBuffer += text;
    while (/[\r\n]/.test(this.commandBuffer)) {
      const splitAt = this.commandBuffer.search(/[\r\n]/);
      const rawLine = this.commandBuffer.slice(0, splitAt);
      this.commandBuffer = this.commandBuffer.slice(splitAt + 1).replace(/^[\r\n]+/, '');
      this.onUbootCommand(rawLine.trim());
    }
  }

  emitForObserve(request: ObserveRequest): void {
    if (request.until === 'uboot') {
      this.phase = 'uboot';
      this.emit('=> ');
      return;
    }
    if (request.until === 'linux_boot') {
      this.phase = 'linux_boot';
      this.emit('[    0.000000] Linux version mock\r\n');
      return;
    }
    if (request.until === 'linux_shell') {
      this.phase = 'linux_shell';
      this.emit('~ # ');
      return;
    }
    if (request.until === 'panic' || this.scenario === 'panic') {
      this.phase = 'panic';
      this.emit('Kernel panic - not syncing: mock observe panic\r\nCall Trace:\r\n');
      return;
    }
    if (request.until === 'pattern') {
      this.emit('mock pattern line with interleaved kernel message\r\n');
    }
  }

  private onBootCommand(): void {
    this.phase = 'uboot';
    if (this.scenario === 'mmc-fail') {
      this.emit("Card did not respond to voltage select!\r\nCan't set block device\r\n=> ");
      return;
    }
    this.emit('Booting Megrez BSP Linux from mmc 1:1\r\nStarting kernel ...\r\n[    0.000000] Linux version mock\r\n');
    this.phase = 'linux_boot';
    if (this.scenario === 'hang') {
      return;
    }
    if (this.scenario === 'panic') {
      this.phase = 'panic';
      this.emit('Kernel panic - not syncing: mock panic\r\nCall Trace:\r\n');
      return;
    }
    if (this.scenario === 'noisy') {
      this.emit('[   45.600000] random: crng init done\r\n');
    }
    this.phase = 'linux_shell';
    this.emit('Megrez initramfs ready. Tools: sz rz insmod ip.\r\n~ # ');
  }

  private onRunCommand(command: string, marker: string): void {
    if (this.phase !== 'linux_shell') {
      return;
    }
    if (/panic/.test(command)) {
      this.phase = 'panic';
      this.emit('Kernel panic - not syncing: requested mock panic\r\nCall Trace:\r\n');
      return;
    }
    if (/sleep|hang/.test(command)) {
      this.emit(`${command}\r\n`);
      return;
    }
    if (/reboot/.test(command) && this.scenario === 'mmc-fail') {
      this.phase = 'uboot';
      this.emit("Card did not respond to voltage select!\r\nCan't set block device\r\n=> ");
      return;
    }

    const output = this.outputForCommand(command);
    const rc = /false|exit 1/.test(command) ? 1 : 0;
    const noise = this.scenario === 'noisy' ? '\r\n[   46.100000] mock kernel message interleaved\r\n' : '';
    this.emit(`${command}\r\n${output}${noise}\r\n${marker}:${rc}\r\n~ # `);
  }

  private onUbootCommand(command: string): void {
    if (command.length === 0) {
      this.emit('\r\n=> ');
      return;
    }
    if (command === 'boot' || command === 'run bootcmd' || command.startsWith('source ')) {
      this.onBootCommand();
      return;
    }
    if (/^mmc dev \d+$/.test(command)) {
      const dev = command.split(/\s+/)[2] ?? '0';
      this.emit(`${command}\r\nswitch to partitions #0, OK\r\nmmc${dev} is current device\r\n=> `);
      return;
    }
    if (command === 'usb start') {
      this.emit(`${command}\r\nscanning bus usb@50490000 for devices... 3 USB Device(s) found\r\n=> `);
      return;
    }
    if (/^usb dev \d+$/.test(command)) {
      this.emit(`${command}\r\nUSB device ${command.split(/\s+/)[2] ?? '0'} is current device\r\n=> `);
      return;
    }
    if (command.startsWith('loady ')) {
      this.ymodemState = 'header';
      this.ymodemSize = 0;
      this.emit(`${command}\r\n## Ready for binary (ymodem) download to ${command.split(/\s+/)[1] ?? '0x0'} at 115200 bps...\r\n`);
      this.emitBytes(Uint8Array.of(YMODEM_C));
      return;
    }
    const fatwrite = /^fatwrite\s+(mmc|usb)\s+(\d+):(\d+)\s+0x[0-9a-fA-F]+\s+(\S+)\s+(0x[0-9a-fA-F]+|\d+)$/.exec(command);
    if (fatwrite !== null) {
      const name = fatwrite[4] ?? 'unknown.bin';
      const sizeText = fatwrite[5] ?? '0';
      const size = sizeText.startsWith('0x') ? Number.parseInt(sizeText.slice(2), 16) : Number.parseInt(sizeText, 10);
      this.fatFiles.set(name, size);
      this.emit(`${command}\r\n${size} bytes written in 24 ms\r\n=> `);
      return;
    }
    if (/^fatls\s+(mmc|usb)\s+\d+:\d+/.test(command)) {
      const entries = [...this.fatFiles.entries()]
        .map(([name, size]) => ` ${size.toString().padStart(10)}   ${name}\r\n`)
        .join('');
      this.emit(`${command}\r\n${entries}${this.fatFiles.size} file(s), 0 dir(s)\r\n=> `);
      return;
    }
    this.emit(`${command}\r\nUnknown command '${command.split(/\s+/)[0] ?? command}' - try 'help'\r\n=> `);
  }

  private onYmodemTx(data: Buffer): void {
    const firstByte = data[0];
    if (this.ymodemState === 'header' && firstByte === YMODEM_SOH) {
      this.ymodemSize = this.parseYmodemSize(data);
      this.ymodemState = 'data';
      this.emitBytes(Uint8Array.of(YMODEM_ACK, YMODEM_C));
      return;
    }
    if (this.ymodemState === 'data' && firstByte === YMODEM_STX) {
      this.emitBytes(Uint8Array.of(YMODEM_ACK));
      return;
    }
    if (this.ymodemState === 'data' && firstByte === YMODEM_EOT) {
      this.ymodemState = 'second-eot';
      this.emitBytes(Uint8Array.of(YMODEM_NAK));
      return;
    }
    if (this.ymodemState === 'second-eot' && firstByte === YMODEM_EOT) {
      this.ymodemState = 'end-header';
      this.emitBytes(Uint8Array.of(YMODEM_ACK, YMODEM_C));
      return;
    }
    if (this.ymodemState === 'end-header' && firstByte === YMODEM_SOH) {
      this.ymodemState = 'idle';
      this.emitBytes(Uint8Array.of(YMODEM_ACK));
      this.emit(`\r\n## Total Size      = 0x${this.ymodemSize.toString(16)} = ${this.ymodemSize} Bytes\r\n=> `);
    }
  }

  private parseYmodemSize(data: Buffer): number {
    const metadata = data.subarray(3, 3 + 128).toString('utf8').replace(/\0+$/, '');
    const fields = metadata.split('\0');
    const parsed = Number.parseInt(fields[1] ?? '0', 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private emit(text: string): void {
    this.port?.emitRx(text, this.scenario === 'slow-prompt' ? this.delayMs * 10 : this.delayMs);
  }

  private emitBytes(bytes: Uint8Array): void {
    this.port?.emitRx(bytes, this.delayMs);
  }

  private outputForCommand(command: string): string {
    if (/cat \/proc\/cmdline/.test(command)) {
      return 'console=ttyS0,115200n8 earlycon=sbi rdinit=/init rw panic=-1 sysrq_always_enabled=1';
    }
    if (/cat \/proc\/sys\/kernel\/sysrq/.test(command)) {
      return '1';
    }
    if (/ip link/.test(command)) {
      return '1: lo: <LOOPBACK,UP>\n2: eth0: <BROADCAST,MULTICAST,UP>\n3: eth1: <BROADCAST,MULTICAST,UP>';
    }
    if (/udhcpc/.test(command)) {
      return 'udhcpc: lease of 192.168.188.110 obtained';
    }
    if (/ping/.test(command)) {
      return '3 packets transmitted, 3 packets received, 0% packet loss';
    }
    return `mock output for: ${command}`;
  }
}

export class MockBackend implements Backend {
  readonly kind: BackendKind = 'mock';
  private readonly engine: ScenarioEngine;
  private readonly port: ScriptedSerialPort;
  private readonly board: BoardBackend;

  constructor(private readonly options: MockBackendOptions) {
    this.engine = new ScenarioEngine(options.scenario, options.delayMs);
    this.port = new ScriptedSerialPort(this.engine);
    this.board = new BoardBackend({ serialPath: 'mock', baudRate: 115200, openPort: () => this.port });
  }

  async open(): Promise<void> {
    await this.board.open();
  }

  async close(): Promise<void> {
    await this.board.close();
  }

  async deploy(request: DeployRequest, context: OpContext): Promise<DeployResult> {
    if (request.method === 'ymodem') {
      return await this.board.deploy(request, context);
    }

    const deployed = [];
    for (const file of request.files) {
      const size = file.size ?? await this.fileSize(file.path);
      context.log('rx', `mock deploy ${basename(file.path)} ${size}\\r\\n`);
      deployed.push({ path: basename(file.path), size });
    }
    return { deployed, verified: request.verify ?? false };
  }

  async boot(request: BootRequest, context: OpContext): Promise<BootResult> {
    const effectiveRequest = this.options.scenario === 'hang' && request.timeoutMs === undefined
      ? { ...request, timeoutMs: Math.max(20, this.options.delayMs * 4) }
      : request;
    return await this.board.boot(effectiveRequest, context);
  }

  async run(request: RunRequest, context: OpContext): Promise<RunResult> {
    if (this.engine.phase !== 'linux_shell') {
      throw new DomainError(ErrorCode.BAD_STATE, `mock board is not at a Linux shell: ${this.engine.phase}`, { retriable: true });
    }
    return await this.board.run(request, context);
  }

  async ubootRun(request: UbootRunRequest, context: OpContext): Promise<UbootRunResult> {
    return await this.board.ubootRun(request, context);
  }

  async ubootFatwrite(request: UbootFatwriteRequest, context: OpContext): Promise<UbootFatwriteResult> {
    return await this.board.ubootFatwrite(request, context);
  }

  async observe(request: ObserveRequest, context: OpContext): Promise<ObserveResult> {
    await this.board.open();
    if (request.until === 'timeout') {
      return await this.board.observe({ ...request, timeoutMs: request.timeoutMs ?? this.options.delayMs }, context);
    }
    this.engine.emitForObserve(request);
    const effectiveRequest = request.timeoutMs === undefined ? { ...request, timeoutMs: Math.max(100, this.options.delayMs * 20) } : request;
    return await this.board.observe(effectiveRequest, context);
  }

  private async fileSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  }

  async reset(_request: ResetRequest, _context: OpContext): Promise<ResetResult> {
    throw new NotImplementedError('mock reset policy is deferred to bead polimi-aos-megrez-eth0-60f.5');
  }
}
