import type { Backend, BackendKind } from './types.js';
import { BoardBackend } from './board.js';
import { MockBackend, type MockScenario } from './mock.js';
import { StubBackend } from './stub.js';

export interface BackendConfig {
  kind: BackendKind;
  serialPath: string;
  serialBaud: number;
  sdBootDir?: string;
  mockScenario: MockScenario;
  mockDelayMs: number;
}

export function createBackend(config: BackendConfig): Backend {
  switch (config.kind) {
    case 'board':
      return new BoardBackend({
        serialPath: config.serialPath,
        baudRate: config.serialBaud,
        ...(config.sdBootDir === undefined ? {} : { sdBootDir: config.sdBootDir }),
      });
    case 'mock':
      return new MockBackend({ scenario: config.mockScenario, delayMs: config.mockDelayMs });
    case 'stub':
      return new StubBackend(config.kind);
  }
}
