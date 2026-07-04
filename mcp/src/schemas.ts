import { z } from 'zod/v4';
import { boardPhaseValues, observeUntilValues, resetMethodValues } from './backend/types.js';
import { ErrorCode } from './result.js';

const errorCodeValues = [
  ErrorCode.NOT_IMPLEMENTED,
  ErrorCode.NOT_ACQUIRED,
  ErrorCode.LOCK_HELD,
  ErrorCode.LEASE_EXPIRED,
  ErrorCode.TIMEOUT,
  ErrorCode.PANIC,
  ErrorCode.SERIAL_UNAVAILABLE,
  ErrorCode.DEPLOY_VERIFY_FAILED,
  ErrorCode.RESET_DEGRADED,
  ErrorCode.BAD_STATE,
  ErrorCode.INTERNAL,
] as const;

const IsoDateSchema = z.string().datetime({ offset: true });

export const BoardPhaseSchema = z.enum(boardPhaseValues);
export const ObserveUntilSchema = z.enum(observeUntilValues);
export const ResetMethodSchema = z.enum(resetMethodValues);
export const ErrorCodeSchema = z.enum(errorCodeValues);

export const LogEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: IsoDateSchema,
  dir: z.enum(['rx', 'tx']),
  text: z.string(),
});

export const LogRefSchema = z.object({
  opId: z.string(),
  fromSeq: z.number().int().nonnegative(),
  toSeq: z.number().int().nonnegative(),
});

export const OpErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retriable: z.boolean(),
  detail: z.unknown().optional(),
});

export function opResultShape(dataSchema: z.ZodTypeAny = z.unknown()) {
  return {
    op: z.string(),
    status: z.enum(['ok', 'error']),
    phase: BoardPhaseSchema,
    data: dataSchema.optional(),
    logRef: LogRefSchema,
    error: OpErrorSchema.optional(),
    startedAt: IsoDateSchema,
    endedAt: IsoDateSchema,
    durationMs: z.number().nonnegative(),
  };
}

export const acquireInputShape = {
  owner: z.string().min(1).optional(),
  ttlMs: z.number().int().positive().optional(),
};
export const AcquireInputSchema = z.object(acquireInputShape);
export type AcquireInput = z.infer<typeof AcquireInputSchema>;

export const acquireDataSchema = z.object({
  lease: z.string().uuid(),
  expiresAt: IsoDateSchema,
  owner: z.string().min(1).optional(),
});

export const releaseInputShape = { lease: z.string().uuid() };
export const ReleaseInputSchema = z.object(releaseInputShape);
export type ReleaseInput = z.infer<typeof ReleaseInputSchema>;
export const releaseDataSchema = z.object({ released: z.boolean() });

export const deployFileSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  size: z.number().int().nonnegative().optional(),
});
export const deployInputShape = {
  lease: z.string().uuid(),
  files: z.array(deployFileSchema).min(1),
  method: z.enum(['sd-copy', 'ymodem']).optional(),
  verify: z.boolean().optional(),
};
export const DeployInputSchema = z.object(deployInputShape);
export type DeployInput = z.infer<typeof DeployInputSchema>;
export const deployDataSchema = z.object({
  deployed: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative() })),
  verified: z.boolean(),
});

export const bootInputShape = {
  lease: z.string().uuid(),
  source: z.enum(['sd', 'payload']),
  waitFor: BoardPhaseSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
};
export const BootInputSchema = z.object(bootInputShape);
export type BootInput = z.infer<typeof BootInputSchema>;
export const bootDataSchema = z.object({
  reached: BoardPhaseSchema,
  bootflow: z.string().optional(),
});

export const runInputShape = {
  lease: z.string().uuid(),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  expect: z.string().min(1).optional(),
};
export const RunInputSchema = z.object(runInputShape);
export type RunInput = z.infer<typeof RunInputSchema>;
export const runDataSchema = z.object({
  output: z.string(),
  exitCode: z.number().int().optional(),
  matched: z.boolean(),
  timedOut: z.boolean(),
});

export const observeInputShape = {
  lease: z.string().uuid(),
  until: ObserveUntilSchema,
  pattern: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
};
export const ObserveInputSchema = z.object(observeInputShape);
export type ObserveInput = z.infer<typeof ObserveInputSchema>;
export const observeDataSchema = z.object({
  reached: z.boolean(),
  matched: z.string().optional(),
});

export const resetInputShape = {
  lease: z.string().uuid(),
  method: ResetMethodSchema.optional(),
  verify: z.boolean().optional(),
};
export const ResetInputSchema = z.object(resetInputShape);
export type ResetInput = z.infer<typeof ResetInputSchema>;
export const resetDataSchema = z.object({
  method: ResetMethodSchema,
  reached: BoardPhaseSchema,
  degraded: z.boolean(),
});

export const collectLogsInputShape = {
  opId: z.string().optional(),
  fromSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(10000).optional(),
};
export const CollectLogsInputSchema = z.object(collectLogsInputShape);
export type CollectLogsInput = z.infer<typeof CollectLogsInputSchema>;
export const collectLogsDataSchema = z.object({
  entries: z.array(LogEntrySchema),
  nextSeq: z.number().int().nonnegative(),
  dropped: z.boolean(),
});

export const acquireOutputShape = opResultShape(acquireDataSchema);
export const releaseOutputShape = opResultShape(releaseDataSchema);
export const deployOutputShape = opResultShape(deployDataSchema);
export const bootOutputShape = opResultShape(bootDataSchema);
export const runOutputShape = opResultShape(runDataSchema);
export const observeOutputShape = opResultShape(observeDataSchema);
export const resetOutputShape = opResultShape(resetDataSchema);
export const collectLogsOutputShape = opResultShape(collectLogsDataSchema);
