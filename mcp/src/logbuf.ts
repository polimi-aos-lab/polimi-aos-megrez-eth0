import type { LogEntry } from './backend/types.js';

export interface CollectLogsOptions {
  opId?: string;
  fromSeq?: number;
  limit?: number;
}

export interface CollectLogsResult {
  entries: LogEntry[];
  nextSeq: number;
  dropped: boolean;
}

export class LogBuffer {
  private readonly entries: Array<LogEntry | undefined>;
  private head = 0;
  private size = 0;
  private nextSeq = 1;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error('log buffer capacity must be a positive integer');
    }
    this.entries = new Array<LogEntry | undefined>(capacity);
  }

  mark(): number {
    return this.nextSeq;
  }

  push(dir: 'rx' | 'tx', text: string): LogEntry {
    const entry: LogEntry = { seq: this.nextSeq, ts: new Date().toISOString(), dir, text };
    if (this.size < this.capacity) {
      this.entries[(this.head + this.size) % this.capacity] = entry;
      this.size += 1;
    } else {
      this.entries[this.head] = entry;
      this.head = (this.head + 1) % this.capacity;
    }
    this.nextSeq += 1;
    return entry;
  }

  slice(fromSeq: number, toSeq: number): LogEntry[] {
    if (this.size === 0 || fromSeq > toSeq) {
      return [];
    }

    const start = Math.max(fromSeq, this.oldestSeq());
    const end = Math.min(toSeq, this.nextSeq - 1);
    const entries: LogEntry[] = [];
    for (let seq = start; seq <= end; seq += 1) {
      const entry = this.entryBySeq(seq);
      if (entry !== undefined) {
        entries.push({ ...entry });
      }
    }
    return entries;
  }

  collect(options: CollectLogsOptions = {}): CollectLogsResult {
    const oldestSeq = this.oldestSeq();
    const requestedStart = options.fromSeq ?? oldestSeq;
    const start = Math.max(requestedStart, oldestSeq);
    const maxCount = options.limit ?? this.capacity;
    const end = Math.min(this.nextSeq - 1, start + Math.max(0, maxCount) - 1);
    const entries = this.slice(start, end);
    return {
      entries,
      nextSeq: entries.length === 0 ? start : entries[entries.length - 1]!.seq + 1,
      dropped: requestedStart < oldestSeq,
    };
  }

  private oldestSeq(): number {
    if (this.size === 0) {
      return this.nextSeq;
    }
    return this.entries[this.head]!.seq;
  }

  private entryBySeq(seq: number): LogEntry | undefined {
    const offset = seq - this.oldestSeq();
    if (offset < 0 || offset >= this.size) {
      return undefined;
    }
    return this.entries[(this.head + offset) % this.capacity];
  }
}
