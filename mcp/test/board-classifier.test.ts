import { describe, expect, it } from 'vitest';

import { classifySerialText } from '../src/backend/board-classifier.js';

describe('classifySerialText', () => {
  it.each([
    {
      name: 'U-Boot prompt',
      text: 'U-Boot 2024.10\nDRAM:  2 GiB\n=> ',
      expected: 'uboot',
    },
    {
      name: 'U-Boot autoboot countdown',
      text: 'Hit any key to stop autoboot:  0\nAutoboot in 2 seconds',
      expected: 'uboot',
    },
    {
      name: 'kernel boot log',
      text: '[    0.000000] Linux version 6.12.0-megrez (builder@ci)\n[    1.000000] Freeing unused kernel memory',
      expected: 'linux_boot',
    },
    {
      name: 'Linux root shell prompt',
      text: 'Megrez initramfs ready\n~ # ',
      expected: 'linux_shell',
    },
    {
      name: 'kernel panic',
      text: '[   12.345678] Kernel panic - not syncing: VFS: Unable to mount root fs\nCall Trace:',
      expected: 'panic',
    },
  ] as const)('classifies $name as $expected', ({ text, expected }) => {
    expect(classifySerialText(text)).toBe(expected);
  });

  it('treats panic as higher priority than an earlier shell prompt', () => {
    expect(classifySerialText('~ # \n[   12.345678] panic: fatal exception')).toBe('panic');
  });
});
