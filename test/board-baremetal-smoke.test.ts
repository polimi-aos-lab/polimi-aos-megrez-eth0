import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smokeScript = join(repoRoot, 'scripts', 'board-baremetal-smoke.sh');

let tempRoot: string | undefined;
let stageDir: string | undefined;
let bootDir: string | undefined;
let fakeBin: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'megrez-baremetal-smoke-'));
  stageDir = join(tempRoot, 'stage');
  bootDir = join(tempRoot, 'boot');
  fakeBin = join(tempRoot, 'bin');

  await mkdir(stageDir);
  await mkdir(fakeBin);
  await writeFile(join(stageDir, 'Image'), 'kernel fixture\n');
  await writeFile(join(stageDir, 'board.dtb'), 'dtb fixture\n');
  await writeFile(join(stageDir, 'source-initramfs.cpio.gz'), 'initramfs fixture\n');

  const fakeMkimage = join(fakeBin, 'mkimage');
  await writeFile(
    fakeMkimage,
    '#!/bin/sh\nfor output do :; done\nprintf "fake U-Boot script\\n" > "${output}"\n',
  );
  await chmod(fakeMkimage, 0o755);
});

afterEach(async () => {
  if (tempRoot !== undefined) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  tempRoot = undefined;
  stageDir = undefined;
  bootDir = undefined;
  fakeBin = undefined;
});

function runSmoke(bootIface: string) {
  if (stageDir === undefined || bootDir === undefined || fakeBin === undefined) {
    throw new Error('fixture was not initialized');
  }

  return spawnSync(
    smokeScript,
    [
      '--stage-dir',
      stageDir,
      '--boot-dir',
      bootDir,
      '--image',
      'Image',
      '--dtb',
      'board.dtb',
      '--initramfs',
      'source-initramfs.cpio.gz',
      '--no-nic-initramfs',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
        BOOT_IFACE: bootIface,
        BOOT_DEV: '7',
        BOOT_PART: '3',
        BOOT_INITRAMFS_NAME: 'initramfs.cpio.gz',
        BOOTARGS: 'console=test panic=-1 sysrq=1',
        KERNEL_ADDR_R: '0x81000000',
        FDT_ADDR_R: '0x82000000',
        RAMDISK_ADDR_R: '0x83000000',
      },
    },
  );
}


describe('board-baremetal-smoke boot transport', () => {
  it.each([
    {
      name: 'TFTP fetches the kernel, DTB, and initramfs before booting them',
      bootIface: 'tftp',
      expectedCommands: [
        'tftpboot ${kernel_addr_r} Image',
        'tftpboot ${fdt_addr_r} board.dtb',
        'tftpboot ${ramdisk_addr_r} initramfs.cpio.gz',
        'booti ${kernel_addr_r} ${ramdisk_addr_r}:${ramdisk_size} ${fdt_addr_r}',
      ],
    },
    {
      name: 'MMC fetches the kernel, DTB, and initramfs before booting them',
      bootIface: 'mmc',
      expectedCommands: [
        'load mmc ${megrez_bootdev}:${megrez_bootpart} ${kernel_addr_r} /Image',
        'load mmc ${megrez_bootdev}:${megrez_bootpart} ${fdt_addr_r} /board.dtb',
        'load mmc ${megrez_bootdev}:${megrez_bootpart} ${ramdisk_addr_r} /initramfs.cpio.gz',
        'booti ${kernel_addr_r} ${ramdisk_addr_r}:${ramdisk_size} ${fdt_addr_r}',
      ],
    },
  ])('$name', async ({ bootIface, expectedCommands }) => {
    const result = runSmoke(bootIface);

    expect(result.status, result.stderr).toBe(0);
    if (bootDir === undefined) {
      throw new Error('fixture was not initialized');
    }
    const bootCmd = await readFile(join(bootDir, 'boot.cmd'), 'utf8');
    const commands = bootCmd.split('\n').filter((line) => /^(?:tftpboot|load mmc|booti) /.test(line));
    expect(commands).toEqual(expectedCommands);
  });

  it('rejects an unsupported transport before generating a payload', () => {
    const result = runSmoke('nvme');

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: unknown BOOT_IFACE nvme (want mmc|tftp)\n');
  });
});
