import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBackend } from '../src/backend/select.js';
import { MockBackend, type MockScenario } from '../src/backend/mock.js';
import type { BoardPhase, OpContext } from '../src/backend/types.js';
import { readConfig } from '../src/config.js';
import { DomainError, ErrorCode } from '../src/result.js';

interface CapturedContext {
  context: OpContext;
  logs: Array<{ dir: 'rx' | 'tx'; text: string }>;
  phases: BoardPhase[];
}

function captureContext(opId = 'mock-test'): CapturedContext {
  const logs: Array<{ dir: 'rx' | 'tx'; text: string }> = [];
  const phases: BoardPhase[] = [];
  const controller = new AbortController();

  return {
    logs,
    phases,
    context: {
      opId,
      signal: controller.signal,
      log: (dir, text) => {
        logs.push({ dir, text });
      },
      setPhase: (phase) => {
        phases.push(phase);
      },
    },
  };
}

function newBackend(scenario: MockScenario = 'normal'): MockBackend {
  return new MockBackend({ scenario, delayMs: 0 });
}

function transcript(capture: CapturedContext): string {
  return capture.logs.map((entry) => entry.text).join('');
}

async function expectDomainCode(action: Promise<unknown>, code: ErrorCode): Promise<DomainError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    const domainError = error as DomainError;
    expect(domainError.code).toBe(code);
    return domainError;
  }

  throw new Error(`expected ${code} to be thrown`);
}

const readConfigEnvKeys = [
  'MCP_BACKEND',
  'MCP_MOCK_SCENARIO',
  'MCP_MOCK_DELAY_MS',
  'SERIAL_PATH',
  'SERIAL_BAUD',
  'MCP_SD_BOOT_DIR',
  'MEGREZ_SD_MOUNT',
  'SD_BOOT_DIR',
  'LEASE_TTL_MS',
  'LOG_BUFFER_LINES',
] as const;
type ReadConfigEnvKey = (typeof readConfigEnvKeys)[number];


async function withReadConfigEnv(env: Record<string, string>, action: () => Promise<void>): Promise<void> {
  const previous: Partial<Record<ReadConfigEnvKey, string>> = {};
  for (const key of readConfigEnvKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      previous[key] = value;
    }
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  try {
    await action();
  } finally {
    for (const key of readConfigEnvKeys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('MockBackend boot', () => {
  it('emits a U-Boot to Linux shell transcript and reports the reached shell phase', async () => {
    const backend = newBackend();
    const capture = captureContext();

    const result = await backend.boot({ source: 'sd' }, capture.context);
    const output = transcript(capture);

    expect(result).toEqual({ reached: 'linux_shell', bootflow: 'sd@50460000.bootdev.part_1 /boot.scr' });
    expect(capture.phases).toEqual(['uboot', 'linux_boot', 'linux_shell']);
    expect(output).toContain('U-Boot 2024.01-mock');
    expect(output).toContain('Hit any key to stop autoboot');
    expect(output).toContain('Booting Megrez BSP Linux from mmc 1:1');
    expect(output).toContain('[    0.000000] Linux version mock');
    expect(output).toContain('Megrez initramfs ready');
    expect(output).toContain('~ # ');
  });

});

describe('MockBackend run', () => {
  it('runs commands through the BoardBackend marker wrapper and strips transport framing from the result', async () => {
    const backend = newBackend();
    const capture = captureContext();
    await backend.boot({ source: 'sd' }, capture.context);

    const result = await backend.run({ command: 'cat /proc/cmdline', expect: 'earlycon=sbi' }, capture.context);
    const output = 'console=ttyS0,115200n8 earlycon=sbi rdinit=/init rw panic=-1 sysrq_always_enabled=1';
    const log = transcript(capture);

    expect(result).toEqual({ output, exitCode: 0, matched: true, timedOut: false });
    expect(log).toContain("(cat /proc/cmdline); printf '\\n__MCP_EXIT_");
    expect(log).toContain('cat /proc/cmdline\r\n');
    expect(log).toContain(`${output}\r\n`);
    expect(log).toMatch(/__MCP_EXIT_[0-9a-f]{32}:0\r\n~ # /);
  });
});

describe('MockBackend observe', () => {
  it('observes a Linux boot transcript through the BoardBackend classifier', async () => {
    const backend = newBackend();
    const capture = captureContext();

    const result = await backend.observe({ until: 'linux_boot' }, capture.context);

    expect(result).toEqual({ reached: true, matched: 'linux_boot' });
    expect(capture.phases.at(-1)).toBe('linux_boot');
    expect(transcript(capture)).toContain('[    0.000000] Linux version mock');
  });
});

describe('MockBackend deploy and reset', () => {
  it('reports deployed basenames and sizes without using a serial device', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'megrez-mock-backend-'));
    try {
      const payloadPath = join(tempRoot, 'nested', 'payload.itb');
      await mkdir(join(tempRoot, 'nested'));
      await writeFile(payloadPath, 'mock payload bytes');
      const backend = newBackend();
      const capture = captureContext();

      const result = await backend.deploy({ files: [{ path: payloadPath }], verify: true }, capture.context);

      expect(result).toEqual({ deployed: [{ path: 'payload.itb', size: 18 }], verified: true });
      expect(transcript(capture)).toContain('mock deploy payload.itb 18\\r\\n');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('reports reset as not implemented', async () => {
    const backend = newBackend();
    const capture = captureContext();

    await expectDomainCode(backend.reset({ method: 'auto', verify: true }, capture.context), ErrorCode.NOT_IMPLEMENTED);
  });
});

describe('mock backend selection wiring', () => {

  it('threads readConfig mock selection through createBackend into observable mock behavior', async () => {
    await withReadConfigEnv(
      {
        MCP_BACKEND: 'mock',
        MCP_MOCK_SCENARIO: 'hang',
        MCP_MOCK_DELAY_MS: '1',
        SERIAL_PATH: '/dev/not-used-by-mock',
        SERIAL_BAUD: '9600',
        LEASE_TTL_MS: '1234',
        LOG_BUFFER_LINES: '16',
      },
      async () => {
        const config = readConfig();
        const backend = createBackend({
          kind: config.backend,
          serialPath: config.serialPath,
          ...(config.sdBootDir === undefined ? {} : { sdBootDir: config.sdBootDir }),
          serialBaud: config.serialBaud,
          mockScenario: config.mockScenario,
          mockDelayMs: config.mockDelayMs,
        });
        const capture = captureContext();

        expect(backend.kind).toBe('mock');
        await expectDomainCode(backend.boot({ source: 'sd' }, capture.context), ErrorCode.TIMEOUT);
      },
    );
  });
});
