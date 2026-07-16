export const YMODEM_SOH = 0x01;
export const YMODEM_STX = 0x02;
export const YMODEM_EOT = 0x04;
export const YMODEM_ACK = 0x06;
export const YMODEM_NAK = 0x15;
export const YMODEM_C = 0x43;

const CPMEOF = 0x1a;

export interface YmodemFrames {
  header: Uint8Array;
  dataBlocks: Uint8Array[];
  end: Uint8Array;
}

export function crc16Xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function buildYmodemFrames(fileName: string, data: Uint8Array): YmodemFrames {
  const cleanName = fileName.split('/').pop() ?? fileName;
  const metadata = new TextEncoder().encode(`${cleanName}\0${data.byteLength}\0`);
  if (metadata.byteLength > 128) {
    throw new Error('YMODEM metadata exceeds 128 bytes');
  }

  const dataBlocks: Uint8Array[] = [];
  let blockNumber = 1;
  for (let offset = 0; offset < data.byteLength || (data.byteLength === 0 && offset === 0); offset += 1024) {
    const payload = new Uint8Array(1024);
    payload.fill(CPMEOF);
    payload.set(data.slice(offset, Math.min(data.byteLength, offset + 1024)));
    dataBlocks.push(buildPacket(YMODEM_STX, blockNumber, payload));
    blockNumber = (blockNumber + 1) & 0xff;
    if (data.byteLength === 0) {
      break;
    }
  }

  return {
    header: buildPacket(YMODEM_SOH, 0, padded(metadata, 128)),
    dataBlocks,
    end: buildPacket(YMODEM_SOH, 0, padded(new Uint8Array(), 128)),
  };
}

function padded(data: Uint8Array, size: number): Uint8Array {
  const payload = new Uint8Array(size);
  payload.fill(0);
  payload.set(data.slice(0, size));
  return payload;
}

function buildPacket(kind: number, blockNumber: number, payload: Uint8Array): Uint8Array {
  const packet = new Uint8Array(3 + payload.byteLength + 2);
  const crc = crc16Xmodem(payload);
  packet[0] = kind;
  packet[1] = blockNumber & 0xff;
  packet[2] = 0xff - packet[1];
  packet.set(payload, 3);
  packet[packet.byteLength - 2] = (crc >> 8) & 0xff;
  packet[packet.byteLength - 1] = crc & 0xff;
  return packet;
}
