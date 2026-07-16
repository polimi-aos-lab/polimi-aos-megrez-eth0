import type { BoardPhase, LogRef } from './backend/types.js';

export enum ErrorCode {
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  NOT_ACQUIRED = 'NOT_ACQUIRED',
  LOCK_HELD = 'LOCK_HELD',
  LEASE_EXPIRED = 'LEASE_EXPIRED',
  TIMEOUT = 'TIMEOUT',
  PANIC = 'PANIC',
  SERIAL_UNAVAILABLE = 'SERIAL_UNAVAILABLE',
  DEPLOY_VERIFY_FAILED = 'DEPLOY_VERIFY_FAILED',
  RESET_DEGRADED = 'RESET_DEGRADED',
  BAD_STATE = 'BAD_STATE',
  INTERNAL = 'INTERNAL',
}

export interface OpError {
  code: ErrorCode;
  message: string;
  retriable: boolean;
  detail?: unknown;
}

export interface OpResult<T> {
  op: string;
  status: 'ok' | 'error';
  phase: BoardPhase;
  data?: T;
  logRef: LogRef;
  error?: OpError;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface ResultContext {
  op: string;
  phase: BoardPhase;
  logRef: LogRef;
  startedAtMs: number;
  endedAtMs?: number;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly retriable: boolean;
  readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, options: { retriable?: boolean; detail?: unknown; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.retriable = options.retriable ?? false;
    if (options.detail !== undefined) {
      this.detail = options.detail;
    }
  }
}

export class NotImplementedError extends DomainError {
  constructor(message: string) {
    super(ErrorCode.NOT_IMPLEMENTED, message, { retriable: false });
    this.name = 'NotImplementedError';
  }
}

const retriableErrors: Record<ErrorCode, boolean> = {
  [ErrorCode.NOT_IMPLEMENTED]: false,
  [ErrorCode.NOT_ACQUIRED]: true,
  [ErrorCode.LOCK_HELD]: true,
  [ErrorCode.LEASE_EXPIRED]: true,
  [ErrorCode.TIMEOUT]: true,
  [ErrorCode.PANIC]: false,
  [ErrorCode.SERIAL_UNAVAILABLE]: true,
  [ErrorCode.DEPLOY_VERIFY_FAILED]: true,
  [ErrorCode.RESET_DEGRADED]: true,
  [ErrorCode.BAD_STATE]: true,
  [ErrorCode.INTERNAL]: false,
};

export function resultError(error: unknown): OpError {
  if (error instanceof DomainError) {
    const base: OpError = {
      code: error.code,
      message: error.message,
      retriable: error.retriable,
    };
    return error.detail === undefined ? base : { ...base, detail: error.detail };
  }

  if (error instanceof Error) {
    return {
      code: ErrorCode.INTERNAL,
      message: error.message,
      retriable: retriableErrors[ErrorCode.INTERNAL],
    };
  }

  return {
    code: ErrorCode.INTERNAL,
    message: String(error),
    retriable: retriableErrors[ErrorCode.INTERNAL],
  };
}

export function okResult<T>(context: ResultContext, data: T): OpResult<T> {
  const endedAtMs = context.endedAtMs ?? Date.now();
  return {
    op: context.op,
    status: 'ok',
    phase: context.phase,
    data,
    logRef: context.logRef,
    startedAt: new Date(context.startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, endedAtMs - context.startedAtMs),
  };
}

export function errorResult(context: ResultContext, error: unknown): OpResult<never> {
  const endedAtMs = context.endedAtMs ?? Date.now();
  return {
    op: context.op,
    status: 'error',
    phase: context.phase,
    logRef: context.logRef,
    error: resultError(error),
    startedAt: new Date(context.startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, endedAtMs - context.startedAtMs),
  };
}

export function summarizeResult(result: OpResult<unknown>): string {
  if (result.status === 'error') {
    const code = result.error?.code ?? ErrorCode.INTERNAL;
    const message = result.error?.message ?? 'unknown error';
    return `${result.op}: ${code}: ${message}`;
  }

  return `${result.op}: ok (${result.phase})`;
}

export function mcpToolResult(result: OpResult<unknown>) {
  return {
    content: [{ type: 'text' as const, text: summarizeResult(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: result.status === 'error',
  };
}
