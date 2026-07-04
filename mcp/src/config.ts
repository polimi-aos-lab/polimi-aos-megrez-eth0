import type { BackendKind } from './backend/types.js';
import { parseMockScenario, type MockScenario } from './backend/mock.js';

const backendKinds: Record<BackendKind, true> = { board: true, mock: true, stub: true };

export interface Config {
  backend: BackendKind;
  serialPath: string;
  sdBootDir?: string;
  mockScenario: MockScenario;
  mockDelayMs: number;
  serialBaud: number;
  leaseTtlMs: number;
  logBufferLines: number;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function intEnv(name: string, fallback: number): number {
  const value = optionalEnv(name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function backendEnv(): BackendKind {
  const value = optionalEnv('MCP_BACKEND') ?? 'stub';
  if (backendKinds[value as BackendKind] !== true) {
    throw new Error(`MCP_BACKEND must be one of ${Object.keys(backendKinds).join(', ')}`);
  }
  return value as BackendKind;
}

export function readConfig(): Config {
  const serialPath = optionalEnv('SERIAL_PATH') ?? '/dev/tty.usbmodem2102';
  const sdBootDir = optionalEnv('MCP_SD_BOOT_DIR') ?? optionalEnv('MEGREZ_SD_MOUNT') ?? optionalEnv('SD_BOOT_DIR');
  return {
    backend: backendEnv(),
    serialPath,
    ...(sdBootDir === undefined ? {} : { sdBootDir }),
    mockScenario: parseMockScenario(optionalEnv('MCP_MOCK_SCENARIO')),
    mockDelayMs: intEnv('MCP_MOCK_DELAY_MS', 5),
    serialBaud: intEnv('SERIAL_BAUD', 115200),
    leaseTtlMs: intEnv('LEASE_TTL_MS', 10 * 60 * 1000),
    logBufferLines: intEnv('LOG_BUFFER_LINES', 4096),
  };
}
