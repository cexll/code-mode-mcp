import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Mock MCP SDK Server so we can capture registered handlers without real IO
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
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
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class StdioServerTransport {
    constructor(_opts?: any) {}
  }
  return { StdioServerTransport };
});

// Mock Client with controllable listTools responses
const mockListToolsMap = new Map<string, any>();
const listToolsMock = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class Client {
    private serverName?: string;
    constructor(_info: any, _opts: any) {
      // Store server name from info for later use
      this.serverName = _info.name?.replace("code-mode-", "");
    }
    async connect(_transport: any) {
      // no-op
    }
    async callTool(_req: any): Promise<any> {
      return { content: [{ type: "text", text: "" }], isError: false };
    }
    async listTools(): Promise<any> {
      listToolsMock();
      const mockData = mockListToolsMap.get(this.serverName || "");
      if (mockData?.shouldFail) {
        throw new Error(mockData.error || "Mock listTools error");
      }
      return mockData || { tools: [] };
    }
    async close() {}
  }
  return {
    Client,
    __mockListToolsMap: mockListToolsMap,
    __listToolsMock: listToolsMock,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  class StdioClientTransport {
    constructor(_opts?: any) {}
  }
  return { StdioClientTransport };
});

// Mock Sandbox and expose spies so tests can assert calls/returns
vi.mock("./sandbox.js", () => {
  const initializeMock = vi.fn().mockResolvedValue(undefined);
  const executeMock = vi
    .fn()
    .mockResolvedValue({ success: true, output: "MOCK_OUTPUT" });

  class Sandbox {
     
    constructor(_mcpClients: Map<string, any>) {}
    async initialize() {
      return initializeMock();
    }
    async executeCode(code: string) {
      return executeMock(code);
    }
    async cleanup() {}
  }

  return {
    Sandbox,
    __executeCodeMock: executeMock,
    __initializeMock: initializeMock,
  };
});

describe("MCP Server (src/server.ts)", () => {
  let handlers: Map<any, (req: any) => any>;
  let ListToolsRequestSchema: any;
  let CallToolRequestSchema: any;
  let executeCodeMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // Import real schema objects so identity matches what server.ts uses
    const types = await import("@modelcontextprotocol/sdk/types.js");
    ListToolsRequestSchema = types.ListToolsRequestSchema;
    CallToolRequestSchema = types.CallToolRequestSchema;

    // Load server module AFTER mocks are in place to capture handler registration
    await import("./server.ts");

    // Pull the captured handlers from our mocked Server module
    const serverIndex = await import(
      "@modelcontextprotocol/sdk/server/index.js"
    );
    handlers = (serverIndex as any).__handlers as Map<any, (req: any) => any>;

    // Grab sandbox execute spy
    const sandboxMod = await import("./sandbox.js");
    executeCodeMock = (sandboxMod as any).__executeCodeMock as ReturnType<
      typeof vi.fn
    >;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("注册了 execute_code 工具 (ListTools)", async () => {
    const listHandler = handlers.get(ListToolsRequestSchema);
    expect(typeof listHandler).toBe("function");
    const res = await listHandler?.({});
    expect(Array.isArray(res.tools)).toBe(true);
    const names = res.tools.map((t: any) => t.name);
    expect(names).toContain("execute_code");
  });

  it("接收 execute_code 请求并调用 Sandbox.executeCode", async () => {
    const callHandler = handlers.get(CallToolRequestSchema);
    expect(typeof callHandler).toBe("function");

    const code = 'console.log("hello from test")';
    await callHandler?.({
      params: { name: "execute_code", arguments: { code } },
    });

    expect(executeCodeMock).toHaveBeenCalledTimes(1);
    expect(executeCodeMock).toHaveBeenCalledWith(code);
  });

  it("成功时返回正确 JSON 结果结构", async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    executeCodeMock.mockResolvedValueOnce({
      success: true,
      output: "RESULT_OK",
    });

    const res = await callHandler({
      params: { name: "execute_code", arguments: { code: "console.log(1)" } },
    });

    expect(res).toBeTruthy();
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]).toEqual({ type: "text", text: "RESULT_OK" });
    expect(res.isError).toBeUndefined();
  });

  it("错误处理：沙箱执行失败时返回错误", async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    executeCodeMock.mockResolvedValueOnce({ success: false, error: "Boom!" });

    const res = await callHandler({
      params: {
        name: "execute_code",
        arguments: { code: "throw new Error()" },
      },
    });

    expect(Array.isArray(res.content)).toBe(true);
    const text = res.content[0]?.text as string;
    expect(text).toMatch(/执行错误/);
    expect(text).toContain("Boom!");
    expect(res.isError).toBe(true);
  });

  it("处理 list_available_tools：动态生成工具树", async () => {
    // 设置 mock 数据：模拟 filesystem 和 fetch servers
    mockListToolsMap.set("filesystem", {
      tools: [
        { name: "read_file", description: "Read a file" },
        { name: "write_file", description: "Write a file" },
        { name: "list_directory", description: "List directory" },
      ],
    });
    mockListToolsMap.set("fetch", {
      tools: [{ name: "fetch", description: "Fetch URL" }],
    });
    mockListToolsMap.set("sequential-thinking", {
      tools: [
        { name: "sequentialthinking", description: "Sequential thinking" },
      ],
    });
    mockListToolsMap.set("codex-cli", {
      tools: [
        { name: "ask-codex", description: "Ask Codex" },
        { name: "batch-codex", description: "Batch Codex" },
      ],
    });

    const callHandler = handlers.get(CallToolRequestSchema)!;
    const res = await callHandler({
      params: { name: "list_available_tools", arguments: {} },
    });

    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]?.type).toBe("text");

    const text = String(res.content[0]?.text);
    expect(text).toContain("可用工具:");
    expect(text).toContain("servers/");

    // 验证包含所有 servers
    expect(text).toContain("filesystem/");
    expect(text).toContain("fetch/");
    expect(text).toContain("sequential-thinking/");
    expect(text).toContain("codex-cli/");

    // 验证包含工具名称
    expect(text).toContain("read_file");
    expect(text).toContain("write_file");
    expect(text).toContain("list_directory");
    expect(text).toContain("fetch");
    expect(text).toContain("sequentialthinking");
    expect(text).toContain("ask-codex");
    expect(text).toContain("batch-codex");

    // 验证树状结构符号存在
    expect(text).toMatch(/[├└]/); // Tree branch symbols

    // 验证 listTools 被调用
    expect(listToolsMock).toHaveBeenCalled();
  });

  it("list_available_tools：处理 listTools 失败的 server", async () => {
    // 设置 mock：一个成功，一个失败
    mockListToolsMap.set("filesystem", {
      tools: [{ name: "read_file", description: "Read a file" }],
    });
    mockListToolsMap.set("fetch", {
      shouldFail: true,
      error: "Connection timeout",
    });

    const callHandler = handlers.get(CallToolRequestSchema)!;
    const res = await callHandler({
      params: { name: "list_available_tools", arguments: {} },
    });

    const text = String(res.content[0]?.text);

    // 成功的 server 应该显示
    expect(text).toContain("filesystem/");
    expect(text).toContain("read_file");

    // 失败的 server 应该显示错误信息
    expect(text).toContain("fetch/");
    expect(text).toContain("获取失败");
    expect(text).toContain("Connection timeout");

    // 不应该抛出错误，而是继续处理
    expect(res.isError).toBeUndefined();
  });

  it("未知工具名称时抛出错误", async () => {
    const callHandler = handlers.get(CallToolRequestSchema)!;
    await expect(
      callHandler({ params: { name: "not_exist_tool", arguments: {} } }),
    ).rejects.toThrow(/未知工具/);
  });
});
