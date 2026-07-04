import { randomUUID } from 'node:crypto';
import { DomainError, ErrorCode } from './result.js';

export interface LeaseSnapshot {
  token: string;
  expiresAtMs: number;
  owner?: string;
}

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class LeaseManager {
  private lease: LeaseSnapshot | undefined = undefined;

  acquire(owner: string | undefined, ttlMs: number): LeaseSnapshot {
    const now = Date.now();
    if (this.lease !== undefined && this.lease.expiresAtMs <= now) {
      this.lease = undefined;
    }

    if (this.lease !== undefined) {
      if ((this.lease.owner ?? '') !== (owner ?? '')) {
        throw new DomainError(ErrorCode.LOCK_HELD, 'board lease is held by another owner', { retriable: true });
      }
      this.lease = { ...this.lease, expiresAtMs: now + ttlMs };
      return { ...this.lease };
    }

    this.lease = owner === undefined
      ? { token: randomUUID(), expiresAtMs: now + ttlMs }
      : { token: randomUUID(), owner, expiresAtMs: now + ttlMs };
    return { ...this.lease };
  }

  release(token: string): void {
    if (this.lease === undefined) {
      throw new DomainError(ErrorCode.NOT_ACQUIRED, 'board lease is not held', { retriable: true });
    }
    if (this.lease.expiresAtMs <= Date.now()) {
      this.lease = undefined;
      throw new DomainError(ErrorCode.LEASE_EXPIRED, 'board lease expired', { retriable: true });
    }
    if (this.lease.token !== token) {
      throw new DomainError(ErrorCode.NOT_ACQUIRED, 'lease token does not match current board lease', { retriable: true });
    }
    this.lease = undefined;
  }

  require(token: string): LeaseSnapshot {
    if (this.lease === undefined) {
      throw new DomainError(ErrorCode.NOT_ACQUIRED, 'board lease is not held', { retriable: true });
    }
    if (this.lease.expiresAtMs <= Date.now()) {
      this.lease = undefined;
      throw new DomainError(ErrorCode.LEASE_EXPIRED, 'board lease expired', { retriable: true });
    }
    if (this.lease.token !== token) {
      throw new DomainError(ErrorCode.NOT_ACQUIRED, 'lease token does not match current board lease', { retriable: true });
    }
    return { ...this.lease };
  }

  current(): LeaseSnapshot | undefined {
    if (this.lease !== undefined && this.lease.expiresAtMs <= Date.now()) {
      this.lease = undefined;
    }
    return this.lease === undefined ? undefined : { ...this.lease };
  }
}
