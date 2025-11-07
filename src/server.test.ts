import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Mock MCP SDK Server so we can capture registered handlers without real IO
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const handlers = new Map<any, (req: any) => any>();
  class Server {
    info: any;
    options: any;
    constructor(info: any, options: any) {
      this.info = info;
      this.options = options;
    }
    setRequestHandler(schema: any, handler: (req: any) => any) {
      handlers.set(schema, handler);
    }
    async connect(_transport: any) {
      // no-op in tests
    }
  }
  return { Server, __handlers: handlers };
});

// Stub stdio transports to avoid spawning child processes
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class StdioServerTransport {
    constructor(_opts?: any) {}
  }
  return { StdioServerTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class Client {
    constructor(_info: any, _opts: any) {}
    async connect(_transport: any) {
      // no-op
    }
    async callTool(_req: any): Promise<any> {
      return { content: [{ type: 'text', text: '' }], isError: false };
    }
    async close() {}
  }
  return { Client };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  class StdioClientTransport {
    constructor(_opts?: any) {}
  }
  return { StdioClientTransport };
});

// Mock SimpleSandbox and expose spies so tests can assert calls/returns
vi.mock('./simple-sandbox.js', () => {
  const initializeMock = vi.fn().mockResolvedValue(undefined);
  const executeMock = vi
    .fn<[_code: string], Promise<{ success: boolean; output?: string; error?: string }>>()
    .mockResolvedValue({ success: true, output: 'MOCK_OUTPUT' });

  class SimpleSandbox {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_mcpClients: Map<string, any>) {}
    async initialize() {
      return initializeMock();
    }
    async executeCode(code: string) {
      return executeMock(code);
    }
    async cleanup() {}
  }

  return { SimpleSandbox, __executeCodeMock: executeMock, __initializeMock: initializeMock };
});

describe('MCP Server (src/server.ts)', () => {
  let handlers: Map<any, (req: any) => any>;
  let ListToolsRequestSchema: any;
  let CallToolRequestSchema: any;
  let executeCodeMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // Import real schema objects so identity matches what server.ts uses
    const types = await import('@modelcontextprotocol/sdk/types.js');
    ListToolsRequestSchema = types.ListToolsRequestSchema;
    CallToolRequestSchema = types.CallToolRequestSchema;

    // Load server module AFTER mocks are in place to capture handler registration
    await import('./server.ts');

    // Pull the captured handlers from our mocked Server module
    const serverIndex = await import('@modelcontextprotocol/sdk/server/index.js');
    handlers = (serverIndex as any).__handlers as Map<any, (req: any) => any>;

    // Grab sandbox execute spy
    const sandboxMod = await import('./simple-sandbox.js');
    executeCodeMock = (sandboxMod as any).__executeCodeMock as ReturnType<typeof vi.fn>;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('注册了 execute_code 工具 (ListTools)', async () => {
    const listHandler = handlers.get(ListToolsRequestSchema);
    expect(typeof listHandler).toBe('function');
    const res = await listHandler?.({});
    expect(Array.isArray(res.tools)).toBe(true);
    const names = res.tools.map((t: any) => t.name);
    expect(names).toContain('execute_code');
  });

  it('接收 execute_code 请求并调用 SimpleSandbox.executeCode', async () => {
    const callHandler = handlers.get(CallToolRequestSchema);
    expect(typeof callHandler).toBe('function');

    const code = 'console.log("hello from test")';
    await callHandler?.({ params: { name: 'execute_code', arguments: { code } } });

    expect(executeCodeMock).toHaveBeenCalledTimes(1);
    expect(executeCodeMock).toHaveBeenCalledWith(code);
  });

  it('成功时返回正确 JSON 结果结构', async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    executeCodeMock.mockResolvedValueOnce({ success: true, output: 'RESULT_OK' });

    const res = await callHandler({
      params: { name: 'execute_code', arguments: { code: 'console.log(1)' } },
    });

    expect(res).toBeTruthy();
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]).toEqual({ type: 'text', text: 'RESULT_OK' });
    expect(res.isError).toBeUndefined();
  });

  it('错误处理：沙箱执行失败时返回错误', async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    executeCodeMock.mockResolvedValueOnce({ success: false, error: 'Boom!' });

    const res = await callHandler({
      params: { name: 'execute_code', arguments: { code: 'throw new Error()' } },
    });

    expect(Array.isArray(res.content)).toBe(true);
    const text = res.content[0]?.text as string;
    expect(text).toMatch(/执行错误/);
    expect(text).toContain('Boom!');
    expect(res.isError).toBe(true);
  });

  it('处理 list_available_tools 工具并返回文本', async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    const res = await callHandler({ params: { name: 'list_available_tools', arguments: {} } });
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]?.type).toBe('text');
    expect(String(res.content[0]?.text)).toContain('servers/');
  });

  it('未知工具名称时抛出错误', async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    await expect(
      callHandler({ params: { name: 'not_exist_tool', arguments: {} } })
    ).rejects.toThrow(/未知工具/);
  });
});
