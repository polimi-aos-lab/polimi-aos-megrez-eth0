export const backendKindValues = ['board', 'mock', 'stub'] as const;
export type BackendKind = (typeof backendKindValues)[number];

export const boardPhaseValues = ['unknown', 'off', 'uboot', 'linux_boot', 'linux_shell', 'panic'] as const;
export type BoardPhase = (typeof boardPhaseValues)[number];

export const observeUntilValues = ['uboot', 'linux_boot', 'linux_shell', 'panic', 'pattern', 'timeout'] as const;
export type ObserveUntil = (typeof observeUntilValues)[number];

export const resetMethodValues = ['auto', 'reboot', 'sysrq', 'sbi', 'hardware'] as const;
export type ResetMethod = (typeof resetMethodValues)[number];

export interface LogEntry {
  seq: number;
  ts: string;
  dir: 'rx' | 'tx';
  text: string;
}

export interface LogRef {
  opId: string;
  fromSeq: number;
  toSeq: number;
}

export interface OpContext {
  opId: string;
  signal: AbortSignal;
  log(dir: 'rx' | 'tx', text: string): void;
  setPhase(phase: BoardPhase): void;
}

export interface DeployFile {
  path: string;
  sha256?: string;
  size?: number;
}

export interface DeployRequest {
  files: DeployFile[];
  method?: 'sd-copy' | 'ymodem';
  verify?: boolean;
}

export interface DeployResult {
  deployed: Array<{ path: string; size: number }>;
  verified: boolean;
}

export interface BootRequest {
  source: 'sd' | 'payload';
  waitFor?: BoardPhase;
  timeoutMs?: number;
}

export interface BootResult {
  reached: BoardPhase;
  bootflow?: string;
}

export interface RunRequest {
  command: string;
  timeoutMs?: number;
  expect?: string;
}

export interface RunResult {
  output: string;
  exitCode?: number;
  matched: boolean;
  timedOut: boolean;
}

export interface ObserveRequest {
  until: ObserveUntil;
  pattern?: string;
  timeoutMs?: number;
}

export interface ObserveResult {
  reached: boolean;
  matched?: string;
}

export interface ResetRequest {
  method?: ResetMethod;
  verify?: boolean;
}

export interface ResetResult {
  method: ResetMethod;
  reached: BoardPhase;
  degraded: boolean;
}

export interface Backend {
  readonly kind: BackendKind;
  open(): Promise<void>;
  close(): Promise<void>;
  deploy(request: DeployRequest, context: OpContext): Promise<DeployResult>;
  boot(request: BootRequest, context: OpContext): Promise<BootResult>;
  run(request: RunRequest, context: OpContext): Promise<RunResult>;
  observe(request: ObserveRequest, context: OpContext): Promise<ObserveResult>;
  reset(request: ResetRequest, context: OpContext): Promise<ResetResult>;
}
