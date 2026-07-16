import type { BoardPhase } from './types.js';

export const panicPattern = /(?:kernel panic|\bpanic\b|Oops:|Unable to handle kernel|Internal error:|Call Trace:)/i;
export const linuxShellPattern = /(?:^|\n)(?:~|\/|root@[^\s:]+:[^\n#]*)\s+#\s*$/;
export const ubootPattern = /(?:^|\n)(?:Hit any key to stop autoboot|Autoboot in \d+ seconds|=>\s*)$/i;
export const linuxBootPattern = /(?:Linux version|Booting Linux|Run \/init as init process|Freeing unused kernel|Megrez initramfs ready)/i;
export const mmcFailurePattern = /(?:Card did not respond|Can't set block device|MMC.*unavailable)/i;

export function classifySerialText(text: string): BoardPhase | undefined {
  if (panicPattern.test(text)) {
    return 'panic';
  }
  if (linuxShellPattern.test(text)) {
    return 'linux_shell';
  }
  if (ubootPattern.test(text)) {
    return 'uboot';
  }
  if (linuxBootPattern.test(text)) {
    return 'linux_boot';
  }
  return undefined;
}
