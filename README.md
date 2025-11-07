# MCP Code Mode 实现示例

将 MCP (Model Context Protocol) 从传统的直接工具调用模式改造为 Code Mode（代码执行模式）。

## 核心概念

**传统 MCP 模式**：
```
用户请求 → LLM → 工具调用 → MCP Server → 结果 → LLM → 下一个工具调用 → ...
每次工具调用都要经过 LLM 处理
```

**Code Mode**：
```
用户请求 → LLM 生成代码 → 沙箱执行（调用 MCP）→ 最终结果 → LLM
中间数据在沙箱内流动，不经过 LLM
```

## 优势

| 维度 | 传统模式 | Code Mode | 提升 |
|------|---------|-----------|------|
| **Token 消耗** | ~150K tokens | ~2K tokens | **98.7%** |
| **工具数量** | 受限 | 大量工具 | **10x+** |
| **复杂控制流** | 需要多轮对话 | 直接写代码 | **快 5x** |
| **大数据处理** | 容易超限 | 沙箱内处理 | **无限制** |
| **安全性** | API key 可能泄露 | 隔离在 binding | **更安全** |

## 项目结构

```
mcp-code-mode-demo/
├── src/
│   ├── generator.ts       # MCP → TypeScript API 生成器
│   ├── sandbox.ts         # 沙箱执行器（使用 @anthropic-ai/sandbox-runtime）
│   └── agent.ts           # Code Mode Agent 实现
├── generated-api/         # 自动生成的 TypeScript API
│   ├── client.ts          # MCP 调用桥接
│   └── servers/           # 每个 MCP server 的 API
│       ├── filesystem/
│       │   ├── readFile.ts
│       │   ├── writeFile.ts
│       │   └── index.ts
│       └── fetch/
│           ├── fetch.ts
│           └── index.ts
├── examples/
│   ├── concept-demo.ts    # 核心概念演示
│   ├── generate-api.ts    # 生成 API 的示例
│   └── chat.ts            # 完整的交互式 Agent
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
cd mcp-code-mode-demo

# 安装项目依赖
npm install

# 安装 sandbox-runtime（全局）
npm install -g @anthropic-ai/sandbox-runtime
```

### 2. 生成 MCP TypeScript API

```bash
# 运行 API 生成器
npm run generate-api
```

这会：
- 连接配置的 MCP servers
- 获取工具定义
- 生成 TypeScript 接口和函数
- 输出到 `./generated-api/servers/`

### 3. 查看生成的 API

```bash
# 示例：查看 fetch 工具的定义
cat generated-api/servers/fetch/fetch.ts
```

生成的代码：
```typescript
import { callMCPTool } from '../../client.js';

export type FetchInput = {
  /** The URL to fetch */
  url: string;
  method?: string;
};

export type FetchOutput = any;

/**
 * Fetch a URL and return its content
 */
export async function fetch(input: FetchInput): Promise<FetchOutput> {
  return callMCPTool('fetch', 'fetch', input);
}
```

### 4. 运行概念演示

```bash
npm run example
```

### 5. 使用 Code Mode Agent（需要 API key）

```bash
export ANTHROPIC_API_KEY='your-api-key'
tsx examples/chat.ts
```

## 工作原理

### 步骤 1: MCP 工具 → TypeScript API

```typescript
// generator.ts 做的事情
const generator = new MCPToTypeScriptGenerator();

// 连接 MCP server
await generator.connectServer('filesystem', 'npx', [
  '-y', '@modelcontextprotocol/server-filesystem'
]);

// 获取工具列表
const tools = await client.listTools();

// 为每个工具生成 TypeScript 函数
for (const tool of tools) {
  generateToolFunction(tool);  // readFile.ts, writeFile.ts, ...
}
```

### 步骤 2: LLM 写代码调用 API

```typescript
// LLM 看到的工具结构（文件树）
servers/
├── filesystem/
│   ├── readFile.ts
│   └── writeFile.ts
└── fetch/
    └── fetch.ts

// LLM 生成的代码
import * as fs from './servers/filesystem/index.js';
import * as fetch from './servers/fetch/index.js';

// 读取本地配置
const config = await fs.readFile({ path: './config.json' });

// 调用 API
const response = await fetch.fetch({
  url: 'https://api.example.com',
  method: 'POST',
  body: config
});

console.log('Result:', response);
```

### 步骤 3: 沙箱执行代码

```typescript
// sandbox.ts 做的事情
const sandbox = new CodeModeSandbox(mcpClients);

// 在隔离环境中执行 LLM 生成的代码
const result = await sandbox.executeCode(llmGeneratedCode);

// 只有 console.log 的内容返回给 LLM
// 中间的 API 调用数据都在沙箱内
```

### 步骤 4: 安全隔离（sandbox-runtime）

```typescript
// 配置沙箱权限
const config = {
  network: {
    allowedDomains: ['api.github.com'],  // 只允许这些域名
    deniedDomains: []
  },
  filesystem: {
    denyRead: ['~/.ssh', '~/.aws'],      // 禁止读取敏感文件
    allowWrite: ['.', '/tmp'],            // 只允许写这些目录
    denyWrite: ['.env', '.git']           // 禁止写这些文件
  }
};

await SandboxManager.initialize(config);
```

## 实现细节

### 1. MCP Client 注入

沙箱代码需要调用实际的 MCP server，通过桥接实现：

```typescript
// generated-api/client.ts
declare const __MCP_CLIENTS__: Map<string, any>;

export async function callMCPTool(
  serverName: string,
  toolName: string,
  input: any
) {
  const client = __MCP_CLIENTS__.get(serverName);
  const response = await client.callTool({ name: toolName, arguments: input });
  return response;
}
```

在实际实现中，需要通过 IPC（进程间通信）让沙箱内的代码调用主进程的 MCP client。

### 2. 按需加载工具定义

```typescript
// Agent 不加载所有工具，而是让 LLM 按需读取
tools: [
  {
    name: 'read_tool_definition',
    description: 'Read the TypeScript definition of a specific MCP tool',
    input_schema: {
      type: 'object',
      properties: {
        server_name: { type: 'string' },
        tool_name: { type: 'string' }
      }
    }
  }
]
```

### 3. 沙箱配置示例

创建 `~/.srt-settings.json`：
```json
{
  "network": {
    "allowedDomains": [
      "github.com",
      "*.github.com",
      "npmjs.org"
    ]
  },
  "filesystem": {
    "denyRead": ["~/.ssh"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env"]
  }
}
```

## 与 Cloudflare Code Mode 的对比

| 维度 | Anthropic 实现 | Cloudflare 实现 |
|------|---------------|----------------|
| **沙箱技术** | `sandbox-runtime` (macOS/Linux 原生) | V8 isolates |
| **启动速度** | ~100ms | ~5ms |
| **隔离方式** | 文件系统 + 网络分离 | Bindings |
| **工具发现** | 文件树 + `read_tool_definition` | 全部加载到单个 API |
| **状态管理** | 文件系统持久化 + Skills | 无状态（用完即扔） |
| **适用场景** | 本地开发、长期 Agent | 云端、无服务器 |

## 参考文档

- [Anthropic: Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Cloudflare: Code Mode](https://blog.cloudflare.com/code-mode/)
- [Anthropic Sandbox Runtime](https://github.com/anthropic-experimental/sandbox-runtime)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## 注意事项

⚠️ **这是一个演示项目**，展示核心概念。生产环境需要：

1. **完善的 IPC 机制**：沙箱与主进程的通信
2. **错误处理**：超时、资源限制、异常恢复
3. **安全审计**：代码执行前的静态分析
4. **性能优化**：沙箱池、工具缓存
5. **监控日志**：执行跟踪、违规检测

## License

MIT
