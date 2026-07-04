import type { Buffer } from 'node:buffer';

export type SerialCallback = (error?: Error | null) => void;
export type SerialDataHandler = (chunk: Buffer) => void;

export interface SerialPortLike {
  isOpen: boolean;
  open(callback: SerialCallback): void;
  close(callback: SerialCallback): void;
  write(data: Buffer, callback: SerialCallback): void;
  drain(callback: SerialCallback): void;
  on(event: 'data', handler: SerialDataHandler): this;
  off(event: 'data', handler: SerialDataHandler): this;
}
