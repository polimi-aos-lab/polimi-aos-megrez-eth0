import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StubBackend } from '../src/backend/stub.js';
import { LeaseManager } from '../src/lock.js';
import { ErrorCode, type OpResult } from '../src/result.js';
import { BoardSession } from '../src/session.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const missingLease = '00000000-0000-4000-8000-000000000000';

function newSession(): BoardSession {
  return new BoardSession(new StubBackend(), { leaseTtlMs: 1_000, logBufferLines: 8 });
}

function expectErrorCode(result: OpResult<unknown>, op: string, code: ErrorCode): void {
  expect(result.op).toBe(op);
  expect(result.status).toBe('error');
  expect(result.data).toBeUndefined();
  expect(result.error).toMatchObject({ code });
}

function expectThrownCode(action: () => unknown, code: ErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`expected ${code} to be thrown`);
}

describe('LeaseManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a lease and renews the same owner without changing the token', () => {
    const leases = new LeaseManager();

    const first = leases.acquire('alice', 1_000);

    expect(first).toMatchObject({
      owner: 'alice',
      expiresAtMs: now.getTime() + 1_000,
    });
    expect(first.token).toMatch(/^[0-9a-f-]{36}$/);

    vi.setSystemTime(now.getTime() + 250);
    const renewed = leases.acquire('alice', 1_000);

    expect(renewed).toEqual({
      token: first.token,
      owner: 'alice',
      expiresAtMs: now.getTime() + 1_250,
    });
    expect(leases.current()).toEqual(renewed);
  });

  it('rejects a different owner while the current lease is live', () => {
    const leases = new LeaseManager();
    const held = leases.acquire('alice', 1_000);

    expectThrownCode(() => leases.acquire('bob', 1_000), ErrorCode.LOCK_HELD);
    expect(leases.current()).toEqual(held);
  });

  it('rejects release with the wrong token and keeps the live lease', () => {
    const leases = new LeaseManager();
    const held = leases.acquire('alice', 1_000);

    expectThrownCode(() => leases.release('wrong-token'), ErrorCode.NOT_ACQUIRED);
    expect(leases.current()).toEqual(held);

    leases.release(held.token);
    expect(leases.current()).toBeUndefined();
  });
});

describe('BoardSession lock behavior with StubBackend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a lease and renews same-owner acquire as the same session lease', async () => {
    const session = newSession();

    const first = await session.acquire({ owner: 'alice', ttlMs: 1_000 });

    expect(first.op).toBe('acquire');
    expect(first.status).toBe('ok');
    expect(first.data).toMatchObject({
      owner: 'alice',
      expiresAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    const firstLease = first.data?.lease;
    expect(firstLease).toMatch(/^[0-9a-f-]{36}$/);

    vi.setSystemTime(now.getTime() + 250);
    const renewed = await session.acquire({ owner: 'alice', ttlMs: 1_000 });

    expect(renewed.status).toBe('ok');
    expect(renewed.data).toEqual({
      lease: firstLease,
      owner: 'alice',
      expiresAt: new Date(now.getTime() + 1_250).toISOString(),
    });
  });

  it('returns LOCK_HELD when another owner tries to acquire the live session lease', async () => {
    const session = newSession();

    await session.acquire({ owner: 'alice', ttlMs: 1_000 });
    const blocked = await session.acquire({ owner: 'bob', ttlMs: 1_000 });

    expectErrorCode(blocked, 'acquire', ErrorCode.LOCK_HELD);
    expect(blocked.error).toMatchObject({ retriable: true });
  });

  it('returns NOT_ACQUIRED for mutating operations without a live lease', async () => {
    const cases: Array<{ name: string; run: (session: BoardSession) => Promise<OpResult<unknown>> }> = [
      {
        name: 'deploy',
        run: (session) => session.deploy({ lease: missingLease, files: [{ path: 'payload.bin' }] }),
      },
      {
        name: 'boot',
        run: (session) => session.boot({ lease: missingLease, source: 'sd' }),
      },
      {
        name: 'run',
        run: (session) => session.run({ lease: missingLease, command: 'uname -a' }),
      },
      {
        name: 'observe',
        run: (session) => session.observe({ lease: missingLease, until: 'linux_shell' }),
      },
      {
        name: 'reset',
        run: (session) => session.reset({ lease: missingLease }),
      },
      {
        name: 'release',
        run: (session) => session.release({ lease: missingLease }),
      },
    ];

    for (const { name, run } of cases) {
      const result = await run(newSession());
      expectErrorCode(result, name, ErrorCode.NOT_ACQUIRED);
      expect(result.error).toMatchObject({ retriable: true });
    }
  });

  it('surfaces StubBackend deploy as NOT_IMPLEMENTED after validating a live lease', async () => {
    const session = newSession();
    const acquired = await session.acquire({ owner: 'alice', ttlMs: 1_000 });
    const lease = acquired.data?.lease;
    if (lease === undefined) {
      throw new Error('expected acquire to return a lease');
    }

    const result = await session.deploy({
      lease,
      files: [{ path: 'payload.bin', size: 42 }],
      method: 'sd-copy',
      verify: true,
    });

    expectErrorCode(result, 'deploy', ErrorCode.NOT_IMPLEMENTED);
    expect(result.error).toMatchObject({
      retriable: false,
      message: 'deploy deferred to bead polimi-aos-megrez-eth0-60f.2',
    });
  });

  it('collects logs without a lease and returns an entries array', () => {
    const session = newSession();

    const result = session.collectLogs({});

    expect(result.op).toBe('collect_logs');
    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ entries: [], nextSeq: 1, dropped: false });
  });
});
