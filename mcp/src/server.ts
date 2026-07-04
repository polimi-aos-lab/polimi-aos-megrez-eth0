import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import { createBackend } from './backend/select.js';
import { mcpToolResult } from './result.js';
import { BoardSession } from './session.js';
import {
  acquireInputShape,
  acquireOutputShape,
  bootInputShape,
  bootOutputShape,
  collectLogsInputShape,
  collectLogsOutputShape,
  deployInputShape,
  deployOutputShape,
  observeInputShape,
  observeOutputShape,
  releaseInputShape,
  releaseOutputShape,
  resetInputShape,
  resetOutputShape,
  runInputShape,
  runOutputShape,
} from './schemas.js';

export function createMcpServer(config: Config): McpServer {
  const server = new McpServer({ name: 'polimi-aos-megrez-board', version: '0.1.0' });
  const backend = createBackend({
    kind: config.backend,
    serialPath: config.serialPath,
    serialBaud: config.serialBaud,
    ...(config.sdBootDir === undefined ? {} : { sdBootDir: config.sdBootDir }),
    mockScenario: config.mockScenario,
    mockDelayMs: config.mockDelayMs,
  });
  const session = new BoardSession(backend, {
    leaseTtlMs: config.leaseTtlMs,
    logBufferLines: config.logBufferLines,
  });

  server.registerTool(
    'acquire',
    {
      title: 'Acquire board lease',
      description: 'Acquire the exclusive single-board UART lease before deploy/boot/run/observe/reset.',
      inputSchema: acquireInputShape,
      outputSchema: acquireOutputShape,
    },
    async (input) => mcpToolResult(await session.acquire(input)),
  );

  server.registerTool(
    'release',
    {
      title: 'Release board lease',
      description: 'Release a previously acquired board lease token.',
      inputSchema: releaseInputShape,
      outputSchema: releaseOutputShape,
    },
    async (input) => mcpToolResult(await session.release(input)),
  );

  server.registerTool(
    'deploy',
    {
      title: 'Deploy board payload',
      description: 'Deploy files to the board through the selected single backend. Raw UART is collected separately with collect_logs.',
      inputSchema: deployInputShape,
      outputSchema: deployOutputShape,
    },
    async (input) => mcpToolResult(await session.deploy(input)),
  );

  server.registerTool(
    'boot',
    {
      title: 'Boot board',
      description: 'Drive the board through the existing U-Boot boot flow and classify the reached phase.',
      inputSchema: bootInputShape,
      outputSchema: bootOutputShape,
    },
    async (input) => mcpToolResult(await session.boot(input)),
  );

  server.registerTool(
    'run',
    {
      title: 'Run Linux shell command',
      description: 'Run one command at the Linux shell and return structured output rather than raw UART bytes.',
      inputSchema: runInputShape,
      outputSchema: runOutputShape,
    },
    async (input) => mcpToolResult(await session.run(input)),
  );

  server.registerTool(
    'observe',
    {
      title: 'Observe board state',
      description: 'Observe UART until a semantic state, pattern, panic, or timeout is classified.',
      inputSchema: observeInputShape,
      outputSchema: observeOutputShape,
    },
    async (input) => mcpToolResult(await session.observe(input)),
  );

  server.registerTool(
    'reset',
    {
      title: 'Reset board',
      description: 'Reset the board using the requested policy and report degraded reset paths explicitly.',
      inputSchema: resetInputShape,
      outputSchema: resetOutputShape,
    },
    async (input) => mcpToolResult(await session.reset(input)),
  );

  server.registerTool(
    'collect_logs',
    {
      title: 'Collect raw UART logs',
      description: 'Fetch raw UART log entries by operation id or sequence pointer. Semantic tool results only contain a logRef.',
      inputSchema: collectLogsInputShape,
      outputSchema: collectLogsOutputShape,
    },
    (input) => mcpToolResult(session.collectLogs(input)),
  );

  return server;
}
