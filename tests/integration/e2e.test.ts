import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SimpleSandbox } from '../../src/simple-sandbox.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fsp from 'fs/promises';

// E2E goals
// 1) 启动 MCP Server（模拟：使用官方 filesystem server）
// 2) 创建 SimpleSandbox 并连接 MCP clients
// 3) 执行包含 MCP 调用的用户代码
// 4) 验证输出正确
// 5) 测试错误情况（文件不存在）

describe.sequential('Integration/E2E: SimpleSandbox + MCP filesystem', () => {
  let sandbox: SimpleSandbox;
  const mcpClients = new Map<string, Client>();

  async function connectMCPServer(serverName: string, command: string, args: string[]) {
    const transport = new StdioClientTransport({ command, args });
    const client = new MCPClient(
      { name: `e2e-${serverName}`, version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
    mcpClients.set(serverName, client as unknown as Client);
    return client;
  }

  beforeAll(async () => {
    // 连接真实 filesystem MCP server，限制在当前工作目录
    await connectMCPServer('filesystem', 'npx', [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      process.cwd(),
    ]);

    sandbox = new SimpleSandbox(mcpClients as any);
    await sandbox.initialize();
  }, 30_000);

  afterAll(async () => {
    try {
      await sandbox.cleanup();
    } finally {
      const closing = Array.from(mcpClients.values()).map((c) => (c as any).close?.());
      await Promise.allSettled(closing);
      mcpClients.clear();
    }
  });

  it('reads package.json via filesystem server', async () => {
    const pkg = JSON.parse(await fsp.readFile('package.json', 'utf8')) as { name: string };
    const expectedName = pkg.name;

    const userCode = `
      import * as fs from "./servers/filesystem/index.js";
      const content = await fs.readFile({ path: "package.json" });
      const pkg = JSON.parse(content);
      console.log("Project name:", pkg.name);
    `;

    const res = await sandbox.executeCode(userCode);
    expect(res.success).toBe(true);
    expect(res.output || '').toContain(`Project name: ${expectedName}`);
  });

  it('returns error for nonexistent file', async () => {
    const errorCode = `
      import * as fs from "./servers/filesystem/index.js";
      await fs.readFile({ path: "__definitely_not_exists__.json" });
    `;
    const res = await sandbox.executeCode(errorCode);
    expect(res.success).toBe(false);
    // Error message may vary by platform/server, just assert non-empty
    expect((res.error || '').length).toBeGreaterThan(0);
  });
});

