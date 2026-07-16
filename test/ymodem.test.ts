import { describe, expect, it } from 'vitest';

import {
  YMODEM_ACK,
  YMODEM_C,
  YMODEM_EOT,
  YMODEM_NAK,
  YMODEM_SOH,
  YMODEM_STX,
  buildYmodemFrames,
  crc16Xmodem,
} from '../src/backend/ymodem.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function trailingCrc(packet: Uint8Array): number {
  return (packet[packet.byteLength - 2]! << 8) | packet[packet.byteLength - 1]!;
}

describe('crc16Xmodem', () => {
  it('matches the XMODEM check value for the standard numeric vector', () => {
    expect(crc16Xmodem(textEncoder.encode('123456789'))).toBe(0x31c3);
  });
});

describe('buildYmodemFrames', () => {
  it('frames the header with the basename and decimal byte size metadata', () => {
    const frames = buildYmodemFrames('/tmp/nested/megrez payload.bin', textEncoder.encode('payload bytes'));
    const headerPayload = frames.header.slice(3, -2);
    const metadata = textDecoder.decode(headerPayload.slice(0, headerPayload.indexOf(0, 0)));
    const sizeOffset = metadata.length + 1;
    const sizeEnd = headerPayload.indexOf(0, sizeOffset);
    const size = textDecoder.decode(headerPayload.slice(sizeOffset, sizeEnd));

    expect(frames.header).toHaveLength(133);
    expect(frames.header[0]).toBe(YMODEM_SOH);
    expect(frames.header[1]).toBe(0);
    expect(frames.header[2]).toBe(0xff);
    expect(metadata).toBe('megrez payload.bin');
    expect(size).toBe('13');
    expect(trailingCrc(frames.header)).toBe(crc16Xmodem(headerPayload));
  });

  it('frames data blocks as numbered 1 KiB STX packets padded with CPM EOF bytes', () => {
    const frames = buildYmodemFrames('payload.bin', Uint8Array.of(0xde, 0xad, 0xbe, 0xef));
    const block = frames.dataBlocks[0];
    if (block === undefined) {
      throw new Error('expected one data block');
    }
    const payload = block.slice(3, -2);

    expect(frames.dataBlocks).toHaveLength(1);
    expect(block).toHaveLength(1029);
    expect(block[0]).toBe(YMODEM_STX);
    expect(block[1]).toBe(1);
    expect(block[2]).toBe(0xfe);
    expect([...payload.slice(0, 4)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...payload.slice(4, 8)]).toEqual([0x1a, 0x1a, 0x1a, 0x1a]);
    expect(trailingCrc(block)).toBe(crc16Xmodem(payload));
  });

  it('emits the empty final header packet used after EOT handshaking', () => {
    const frames = buildYmodemFrames('payload.bin', new Uint8Array());
    const payload = frames.end.slice(3, -2);

    expect(YMODEM_EOT).toBe(0x04);
    expect(YMODEM_ACK).toBe(0x06);
    expect(YMODEM_NAK).toBe(0x15);
    expect(YMODEM_C).toBe(0x43);
    expect(frames.end).toHaveLength(133);
    expect(frames.end[0]).toBe(YMODEM_SOH);
    expect(frames.end[1]).toBe(0);
    expect(frames.end[2]).toBe(0xff);
    expect([...payload]).toEqual(Array.from({ length: 128 }, () => 0));
    expect(trailingCrc(frames.end)).toBe(crc16Xmodem(payload));
  });
});
