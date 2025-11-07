import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SimpleSandbox } from './simple-sandbox.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Per AGENTS.md: keep tests strict and focused on failure paths.

describe('Error handling and edge cases', () => {
  let sandbox: SimpleSandbox;
  let mockMcpClients: Map<string, Client>;

  beforeEach(async () => {
    mockMcpClients = new Map();
    const okClient: Partial<Client> = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'OK' }],
        isError: false,
      }) as any,
    };
    mockMcpClients.set('filesystem', okClient as Client);

    sandbox = new SimpleSandbox(mockMcpClients as any);
    await sandbox.initialize();
  });

  afterEach(async () => {
    await sandbox.cleanup();
    vi.clearAllMocks();
  });

  it('1) 文件不存在: readFile(nonexistent.txt) → 抛出并被沙箱捕获', async () => {
    const client = mockMcpClients.get('filesystem') as any;
    // Simulate MCP server returning an error payload for missing file
    client.callTool.mockResolvedValueOnce({
      isError: true,
      content: [
        { type: 'text', text: "ENOENT: no such file or directory, open 'nonexistent.txt'" },
      ],
    });

    const code = `
      import { readFile } from "./servers/filesystem/read_file.js";
      await readFile({ path: "nonexistent.txt" });
    `;

    const res = await sandbox.executeCode(code);
    expect(res.success).toBe(false);
    expect(res.error || '').toMatch(/ENOENT|nonexistent\.txt|read_file failed/i);
  });

  it('2) MCP Server 连接失败: 未注册的服务器名', async () => {
    // Use a fresh sandbox with NO clients registered
    const sandbox2 = new SimpleSandbox(new Map() as any);
    await sandbox2.initialize();
    try {
      const code = `
        import { readFile } from "./servers/filesystem/read_file.js";
        await readFile({ path: "test.txt" });
      `;
      const res = await sandbox2.executeCode(code);
      expect(res.success).toBe(false);
      expect(res.error || '').toMatch(/MCP server not connected: \s*filesystem/i);
    } finally {
      await sandbox2.cleanup();
    }
  });

  it('3) 无效的 MCP 响应格式: 返回非预期结构但应优雅回退', async () => {
    const client = mockMcpClients.get('filesystem') as any;
    // Return a shape that read_file.js does not explicitly handle
    client.callTool.mockResolvedValueOnce({ foo: 'bar', nested: { a: 1 } });

    const code = `
      import { readFile } from "./servers/filesystem/read_file.js";
      const out = await readFile({ path: "whatever.txt" });
      console.log(out);
    `;
    const res = await sandbox.executeCode(code);
    expect(res.success).toBe(true);
    // read_file.ts falls back to JSON.stringify(resp)
    expect(res.output || '').toMatch(/"foo"\s*:\s*"bar"/);
    expect(res.output || '').toMatch(/"nested"/);
  });

  it('4) IPC 通信失败: 子进程缺少 process.send', async () => {
    const code = `
      import { readFile } from "./servers/filesystem/read_file.js";
      // Simulate IPC not available in child process
      (process as any).send = undefined;
      await readFile({ path: "test.txt" });
    `;
    const res = await sandbox.executeCode(code);
    expect(res.success).toBe(false);
    expect(res.error || '').toMatch(/IPC channel not available: process\.send is undefined/);
  });

  it(
    '5) 超出 CPU 限制: 计算卡死应在 10s 超时终止',
    async () => {
      const code = 'while(true) {}';
      const start = Date.now();
      const res = await sandbox.executeCode(code);
      const elapsed = Date.now() - start;
      expect(res.success).toBe(false);
      expect(res.error || '').toMatch(/timeout|killed/i);
      expect(elapsed).toBeGreaterThanOrEqual(9000);
    },
    15000
  );

  // Optional memory stress (disabled by default to avoid OOM on CI)
  it.skip('5b) 超出内存限制: 大量分配应崩溃/被终止 (可在受控环境启用)', async () => {
    const code = `
      const chunks: Buffer[] = [];
      for (let i = 0; i < 1024; i++) {
        chunks.push(Buffer.alloc(32 * 1024 * 1024)); // ~32MB each
      }
      console.log('allocated', chunks.length);
    `;
    const res = await sandbox.executeCode(code);
    expect(res.success).toBe(false);
  });
});

