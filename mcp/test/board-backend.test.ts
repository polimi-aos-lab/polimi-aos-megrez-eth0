import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BoardBackend } from '../src/backend/board.js';
import type { OpContext } from '../src/backend/types.js';
import { ErrorCode } from '../src/result.js';

let tempRoot: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'megrez-board-backend-'));
});

afterEach(async () => {
  if (tempRoot !== undefined) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe('BoardBackend sd-copy deploy', () => {
  it('copies a payload into the mounted SD boot directory and verifies its sha256 without opening serial', async () => {
    if (tempRoot === undefined) {
      throw new Error('tempRoot was not initialized');
    }
    const inputDir = join(tempRoot, 'input');
    const sdBootDir = join(tempRoot, 'boot');
    const sourcePath = join(inputDir, 'kernel.itb');
    const payload = Buffer.from('megrez kernel payload\n', 'utf8');
    await mkdir(inputDir);
    await writeFile(sourcePath, payload);
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const backend = new BoardBackend({ serialPath: '/dev/tty-do-not-open', baudRate: 115_200, sdBootDir });
    backend.open = async () => {
      throw new Error('sd-copy deploy must not open a serial device');
    };
    const context: OpContext = {
      opId: 'test-deploy-success',
      signal: new AbortController().signal,
      log: () => {},
      setPhase: () => {},
    };

    const result = await backend.deploy(
      { method: 'sd-copy', verify: true, files: [{ path: sourcePath, size: payload.byteLength, sha256 }] },
      context,
    );

    const destination = join(sdBootDir, 'kernel.itb');
    expect(result).toEqual({ deployed: [{ path: destination, size: payload.byteLength }], verified: true });
    expect(await readFile(destination)).toEqual(payload);
  });

  it('rejects a declared source size that does not match before copying', async () => {
    if (tempRoot === undefined) {
      throw new Error('tempRoot was not initialized');
    }
    const inputDir = join(tempRoot, 'input');
    const sdBootDir = join(tempRoot, 'boot');
    const sourcePath = join(inputDir, 'kernel.itb');
    await mkdir(inputDir);
    await writeFile(sourcePath, Buffer.from('1234', 'utf8'));
    const backend = new BoardBackend({ serialPath: '/dev/tty-do-not-open', baudRate: 115_200, sdBootDir });
    backend.open = async () => {
      throw new Error('sd-copy deploy must not open a serial device');
    };
    const context: OpContext = {
      opId: 'test-deploy-size-failure',
      signal: new AbortController().signal,
      log: () => {},
      setPhase: () => {},
    };

    await expect(
      backend.deploy({ method: 'sd-copy', verify: true, files: [{ path: sourcePath, size: 5 }] }, context),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPLOY_VERIFY_FAILED,
      message: `source size mismatch for ${sourcePath}: expected 5, got 4`,
      retriable: true,
    });
    await expect(readFile(join(sdBootDir, 'kernel.itb'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a copied payload whose sha256 does not match', async () => {
    if (tempRoot === undefined) {
      throw new Error('tempRoot was not initialized');
    }
    const inputDir = join(tempRoot, 'input');
    const sdBootDir = join(tempRoot, 'boot');
    const sourcePath = join(inputDir, 'kernel.itb');
    const payload = Buffer.from('megrez kernel payload\n', 'utf8');
    await mkdir(inputDir);
    await writeFile(sourcePath, payload);
    const backend = new BoardBackend({ serialPath: '/dev/tty-do-not-open', baudRate: 115_200, sdBootDir });
    backend.open = async () => {
      throw new Error('sd-copy deploy must not open a serial device');
    };
    const context: OpContext = {
      opId: 'test-deploy-sha-failure',
      signal: new AbortController().signal,
      log: () => {},
      setPhase: () => {},
    };

    await expect(
      backend.deploy(
        { method: 'sd-copy', verify: true, files: [{ path: sourcePath, size: payload.byteLength, sha256: '0'.repeat(64) }] },
        context,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.DEPLOY_VERIFY_FAILED,
      message: `sha256 mismatch for ${join(sdBootDir, 'kernel.itb')}`,
      retriable: true,
    });
  });
});

describe('BoardBackend reset', () => {
  it('reports NOT_IMPLEMENTED without opening a serial device', async () => {
    const backend = new BoardBackend({ serialPath: '/dev/tty-do-not-open', baudRate: 115_200 });
    backend.open = async () => {
      throw new Error('reset must not open a serial device before reporting implementation status');
    };
    const context: OpContext = {
      opId: 'test-reset-not-implemented',
      signal: new AbortController().signal,
      log: () => {},
      setPhase: () => {},
    };

    await expect(backend.reset({ method: 'auto', verify: true }, context)).rejects.toMatchObject({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: 'reset policy is deferred to bead polimi-aos-megrez-eth0-60f.5',
      retriable: false,
    });
  });
});
