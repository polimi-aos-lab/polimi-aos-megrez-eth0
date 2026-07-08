#!/usr/bin/env node
import dgram from 'node:dgram';
import { createReadStream, statSync } from 'node:fs';
import { access, constants, realpath } from 'node:fs/promises';
import path from 'node:path';

const OPCODE_RRQ = 1;
const OPCODE_WRQ = 2;
const OPCODE_DATA = 3;
const OPCODE_ACK = 4;
const OPCODE_ERROR = 5;
const BLOCK_SIZE = 512;
const MAX_RETRIES = 5;

function usage() {
  console.log(`Usage: tftp-serve.mjs [options]

Serve files read-only over TFTP for U-Boot tests.

Options:
  --root PATH     Directory to serve (default: stage/xen/board-xen-smoke)
  --host HOST     Address to bind (default: 0.0.0.0)
  --port PORT     UDP port (default: 6969; use 69 for real U-Boot TFTP)
  --timeout MS    ACK timeout before retransmit (default: 5000)
  -h, --help      Show this help

Examples:
  scripts/tftp-serve.mjs --root stage/xen/board-xen-smoke --port 6969
  sudo scripts/tftp-serve.mjs --root stage/xen/board-xen-smoke --port 69`);
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be an integer in 1..65535, got: ${value}`);
  }
  return parsed;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    root: 'stage/xen/board-xen-smoke',
    host: '0.0.0.0',
    port: 6969,
    timeoutMs: 5000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      case '--root':
        options.root = requireValue(argv, ++index, arg);
        break;
      case '--host':
        options.host = requireValue(argv, ++index, arg);
        break;
      case '--port':
        options.port = parsePositiveInt(requireValue(argv, ++index, arg), arg);
        break;
      case '--timeout':
        options.timeoutMs = parsePositiveInt(requireValue(argv, ++index, arg), arg);
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

function parseRequest(packet) {
  if (packet.length < 4) {
    throw new Error('short packet');
  }

  const opcode = packet.readUInt16BE(0);
  const parts = packet.subarray(2).toString('ascii').split('\0');
  const filename = parts[0] ?? '';
  const mode = (parts[1] ?? '').toLowerCase();
  return { opcode, filename, mode };
}

function dataPacket(block, data) {
  const packet = Buffer.allocUnsafe(4 + data.length);
  packet.writeUInt16BE(OPCODE_DATA, 0);
  packet.writeUInt16BE(block, 2);
  data.copy(packet, 4);
  return packet;
}

function errorPacket(code, message) {
  return Buffer.concat([
    Buffer.from([0, OPCODE_ERROR, 0, code]),
    Buffer.from(message, 'ascii'),
    Buffer.from([0]),
  ]);
}

function sendError(server, port, address, code, message) {
  server.send(errorPacket(code, message), port, address);
}

async function resolveRequestPath(rootReal, filename) {
  const cleaned = filename.replace(/^\/+/, '');
  if (cleaned.length === 0 || cleaned.includes('\0') || path.isAbsolute(filename)) {
    throw Object.assign(new Error('bad filename'), { tftpCode: 2 });
  }

  const candidate = path.resolve(rootReal, cleaned);
  const relative = path.relative(rootReal, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('path traversal rejected'), { tftpCode: 2 });
  }

  await access(candidate, constants.R_OK);
  const stats = statSync(candidate);
  if (!stats.isFile()) {
    throw Object.assign(new Error('not a regular file'), { tftpCode: 1 });
  }
  return candidate;
}

function readBlock(stream, size) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    function cleanup() {
      stream.off('readable', onReadable);
      stream.off('end', onEnd);
      stream.off('error', onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onEnd() {
      cleanup();
      resolve(Buffer.concat(chunks, total));
    }

    function onReadable() {
      let chunk;
      while ((chunk = stream.read(size - total)) !== null) {
        chunks.push(chunk);
        total += chunk.length;
        if (total === size) {
          cleanup();
          resolve(Buffer.concat(chunks, total));
          return;
        }
      }
    }

    stream.on('readable', onReadable);
    stream.on('end', onEnd);
    stream.on('error', onError);
    onReadable();
  });
}

async function serveTransfer(filePath, clientPort, clientAddress, timeoutMs) {
  const socket = dgram.createSocket('udp4');
  const stream = createReadStream(filePath, { highWaterMark: BLOCK_SIZE });
  let block = 1;
  let current = await readBlock(stream, BLOCK_SIZE);
  let finalBlockSent = current.length < BLOCK_SIZE;
  let retries = 0;
  let timer;

  function sendCurrent() {
    socket.send(dataPacket(block, current), clientPort, clientAddress);
    clearTimeout(timer);
    timer = setTimeout(() => {
      retries += 1;
      if (retries > MAX_RETRIES) {
        console.error(`tftp: timeout ${clientAddress}:${clientPort} ${path.basename(filePath)} block ${block}`);
        stream.destroy();
        socket.close();
        return;
      }
      sendCurrent();
    }, timeoutMs);
  }

  socket.on('message', async (packet, remote) => {
    if (remote.address !== clientAddress || remote.port !== clientPort || packet.length < 4) {
      return;
    }
    if (packet.readUInt16BE(0) !== OPCODE_ACK || packet.readUInt16BE(2) !== block) {
      return;
    }

    clearTimeout(timer);
    retries = 0;

    if (finalBlockSent) {
      stream.destroy();
      socket.close();
      return;
    }

    block = (block + 1) & 0xffff;
    if (block === 0) {
      block = 1;
    }
    current = await readBlock(stream, BLOCK_SIZE);
    finalBlockSent = current.length < BLOCK_SIZE;
    sendCurrent();
  });

  socket.on('close', () => clearTimeout(timer));
  socket.bind(0, () => sendCurrent());
}

const options = parseArgs(process.argv.slice(2));
const rootReal = await realpath(options.root);
const server = dgram.createSocket('udp4');

server.on('message', async (packet, remote) => {
  let request;
  try {
    request = parseRequest(packet);
  } catch (error) {
    sendError(server, remote.port, remote.address, 4, error.message);
    return;
  }

  if (request.opcode === OPCODE_WRQ) {
    sendError(server, remote.port, remote.address, 2, 'writes disabled');
    return;
  }
  if (request.opcode !== OPCODE_RRQ) {
    sendError(server, remote.port, remote.address, 4, 'unsupported opcode');
    return;
  }
  if (request.mode !== 'octet' && request.mode !== 'netascii') {
    sendError(server, remote.port, remote.address, 4, 'unsupported mode');
    return;
  }

  try {
    const filePath = await resolveRequestPath(rootReal, request.filename);
    console.error(`tftp: RRQ ${request.filename} from ${remote.address}:${remote.port}`);
    await serveTransfer(filePath, remote.port, remote.address, options.timeoutMs);
  } catch (error) {
    const code = error.tftpCode ?? 1;
    sendError(server, remote.port, remote.address, code, error.message);
  }
});

server.bind(options.port, options.host, () => {
  const address = server.address();
  console.error(`tftp: serving ${rootReal} on ${address.address}:${address.port}`);
});
