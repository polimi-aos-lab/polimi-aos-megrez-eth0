import { randomUUID } from 'node:crypto';
import type {
  Backend,
  BoardPhase,
  BootRequest,
  BootResult,
  DeployRequest,
  DeployResult,
  LogEntry,
  LogRef,
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
} from './backend/types.js';
import { LeaseManager, Mutex } from './lock.js';
import { LogBuffer } from './logbuf.js';
import { errorResult, okResult, type OpResult } from './result.js';
import type {
  AcquireInput,
  BootInput,
  CollectLogsInput,
  DeployInput,
  ObserveInput,
  ReleaseInput,
  ResetInput,
  RunInput,
  UbootFatwriteInput,
  UbootRunInput,
} from './schemas.js';

export interface BoardSessionOptions {
  leaseTtlMs: number;
  logBufferLines: number;
}

export interface CollectLogsData {
  entries: LogEntry[];
  nextSeq: number;
  dropped: boolean;
}

export class BoardSession {
  private readonly leases = new LeaseManager();
  private readonly mutex = new Mutex();
  private readonly logs: LogBuffer;
  private readonly opLogs = new Map<string, LogRef>();
  private phase: BoardPhase = 'unknown';

  constructor(private readonly backend: Backend, private readonly options: BoardSessionOptions) {
    this.logs = new LogBuffer(options.logBufferLines);
  }

  async acquire(input: AcquireInput): Promise<OpResult<{ lease: string; expiresAt: string; owner?: string }>> {
    const opId = randomUUID();
    const startedAtMs = Date.now();
    const fromSeq = this.logs.mark();
    try {
      const lease = this.leases.acquire(input.owner, input.ttlMs ?? this.options.leaseTtlMs);
      await this.backend.open();
      const data = lease.owner === undefined
        ? { lease: lease.token, expiresAt: new Date(lease.expiresAtMs).toISOString() }
        : { lease: lease.token, expiresAt: new Date(lease.expiresAtMs).toISOString(), owner: lease.owner };
      return okResult({ op: 'acquire', phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, data);
    } catch (error) {
      return errorResult({ op: 'acquire', phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, error);
    }
  }

  async release(input: ReleaseInput): Promise<OpResult<{ released: boolean }>> {
    const opId = randomUUID();
    const startedAtMs = Date.now();
    const fromSeq = this.logs.mark();
    try {
      this.leases.release(input.lease);
      await this.backend.close();
      return okResult({ op: 'release', phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, { released: true });
    } catch (error) {
      return errorResult({ op: 'release', phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, error);
    }
  }

  collectLogs(input: CollectLogsInput): OpResult<CollectLogsData> {
    const opId = randomUUID();
    const startedAtMs = Date.now();
    const fromSeq = this.logs.mark();
    if (input.opId !== undefined) {
      const ref = this.opLogs.get(input.opId);
      const entries = ref === undefined ? [] : this.logs.slice(ref.fromSeq, ref.toSeq);
      return okResult(
        { op: 'collect_logs', phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs },
        { entries, nextSeq: ref === undefined ? this.logs.mark() : ref.toSeq + 1, dropped: false },
      );
    }

    const data = this.logs.collect({
      ...(input.fromSeq === undefined ? {} : { fromSeq: input.fromSeq }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return okResult({ op: 'collect_logs', phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, data);
  }

  deploy(input: DeployInput): Promise<OpResult<DeployResult>> {
    const files = input.files.map((file) => ({
      path: file.path,
      ...(file.sha256 === undefined ? {} : { sha256: file.sha256 }),
      ...(file.size === undefined ? {} : { size: file.size }),
    }));
    const request: DeployRequest = {
      files,
      ...(input.method === undefined ? {} : { method: input.method }),
      ...(input.verify === undefined ? {} : { verify: input.verify }),
    };
    return this.withBackendOp('deploy', input.lease, undefined, (context) => this.backend.deploy(request, context));
  }

  boot(input: BootInput): Promise<OpResult<BootResult>> {
    const request: BootRequest = {
      source: input.source,
      ...(input.waitFor === undefined ? {} : { waitFor: input.waitFor }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    };
    return this.withBackendOp('boot', input.lease, input.timeoutMs, (context) => this.backend.boot(request, context));
  }

  run(input: RunInput): Promise<OpResult<RunResult>> {
    const request: RunRequest = {
      command: input.command,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.expect === undefined ? {} : { expect: input.expect }),
    };
    return this.withBackendOp('run', input.lease, input.timeoutMs, (context) => this.backend.run(request, context));
  }

  ubootRun(input: UbootRunInput): Promise<OpResult<UbootRunResult>> {
    const request: UbootRunRequest = {
      commands: input.commands,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.expect === undefined ? {} : { expect: input.expect }),
      ...(input.finalWaitForPrompt === undefined ? {} : { finalWaitForPrompt: input.finalWaitForPrompt }),
      ...(input.lineEnding === undefined ? {} : { lineEnding: input.lineEnding }),
      ...(input.charDelayMs === undefined ? {} : { charDelayMs: input.charDelayMs }),
    };
    return this.withBackendOp('uboot_run', input.lease, input.timeoutMs, (context) => this.backend.ubootRun(request, context));
  }

  ubootFatwrite(input: UbootFatwriteInput): Promise<OpResult<UbootFatwriteResult>> {
    const request: UbootFatwriteRequest = {
      file: {
        path: input.file.path,
        ...(input.file.sha256 === undefined ? {} : { sha256: input.file.sha256 }),
        ...(input.file.size === undefined ? {} : { size: input.file.size }),
      },
      ...(input.destName === undefined ? {} : { destName: input.destName }),
      ...(input.loadAddr === undefined ? {} : { loadAddr: input.loadAddr }),
      ...(input.interface === undefined ? {} : { interface: input.interface }),
      ...(input.dev === undefined ? {} : { dev: input.dev }),
      ...(input.part === undefined ? {} : { part: input.part }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.verify === undefined ? {} : { verify: input.verify }),
      ...(input.lineEnding === undefined ? {} : { lineEnding: input.lineEnding }),
      ...(input.charDelayMs === undefined ? {} : { charDelayMs: input.charDelayMs }),
    };
    return this.withBackendOp('uboot_fatwrite', input.lease, input.timeoutMs, (context) => this.backend.ubootFatwrite(request, context));
  }

  observe(input: ObserveInput): Promise<OpResult<ObserveResult>> {
    const request: ObserveRequest = {
      until: input.until,
      ...(input.pattern === undefined ? {} : { pattern: input.pattern }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    };
    return this.withBackendOp('observe', input.lease, input.timeoutMs, (context) => this.backend.observe(request, context));
  }

  reset(input: ResetInput): Promise<OpResult<ResetResult>> {
    const request: ResetRequest = {
      ...(input.method === undefined ? {} : { method: input.method }),
      ...(input.verify === undefined ? {} : { verify: input.verify }),
    };
    return this.withBackendOp('reset', input.lease, undefined, (context) => this.backend.reset(request, context));
  }

  private async withBackendOp<T>(
    op: string,
    lease: string,
    timeoutMs: number | undefined,
    invoke: (context: OpContext) => Promise<T>,
  ): Promise<OpResult<T>> {
    const opId = randomUUID();
    const startedAtMs = Date.now();
    const fromSeq = this.logs.mark();
    const abort = new AbortController();
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => abort.abort(), timeoutMs);
    timeout?.unref();

    try {
      this.leases.require(lease);
      const data = await this.mutex.runExclusive(async () => {
        const context: OpContext = {
          opId,
          signal: abort.signal,
          log: (dir, text) => {
            this.logs.push(dir, text);
          },
          setPhase: (phase) => {
            this.phase = phase;
          },
        };
        return await invoke(context);
      });
      return okResult({ op, phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, data);
    } catch (error) {
      return errorResult({ op, phase: this.phase, logRef: this.logRef(opId, fromSeq), startedAtMs }, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private logRef(opId: string, fromSeq: number): LogRef {
    const ref = { opId, fromSeq, toSeq: Math.max(0, this.logs.mark() - 1) };
    this.opLogs.set(opId, ref);
    if (this.opLogs.size > this.options.logBufferLines) {
      const oldest = this.opLogs.keys().next().value;
      if (oldest !== undefined) {
        this.opLogs.delete(oldest);
      }
    }
    return ref;
  }
}
