# 从传统 MCP 迁移到 Code Mode

本指南帮助你将现有的 MCP 应用迁移到 Code Mode 模式。

## 迁移检查清单

### ✅ 适合迁移的场景

- [ ] 使用超过 10 个 MCP 工具
- [ ] 需要处理大文件或大数据集
- [ ] 有复杂的多步骤工作流
- [ ] 需要循环、条件判断等控制流
- [ ] Token 成本过高
- [ ] 响应速度慢（多轮往返）

### ⚠️ 暂时不适合的场景

- [ ] 只使用 1-3 个简单工具
- [ ] 不需要复杂逻辑
- [ ] 对沙箱隔离有特殊要求（需要自定义）

## 迁移步骤

### 步骤 1: 审计现有 MCP 配置

**传统配置** (`.mcp.json`):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"]
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your-token"
      }
    }
  }
}
```

记录：
- 使用了哪些 MCP servers
- 每个 server 的启动参数
- 环境变量配置

### 步骤 2: 生成 TypeScript API

创建生成脚本 `scripts/generate-mcp-api.ts`:

```typescript
import { MCPToTypeScriptGenerator } from '../src/generator.js';

async function main() {
  const generator = new MCPToTypeScriptGenerator();

  // 从你的 .mcp.json 迁移过来
  await generator.connectServer(
    'filesystem',
    'npx',
    ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/workspace']
  );

  await generator.connectServer(
    'fetch',
    'npx',
    ['-y', '@modelcontextprotocol/server-fetch']
  );

  await generator.connectServer(
    'github',
    'npx',
    ['-y', '@modelcontextprotocol/server-github']
  );

  await generator.generateTypeScriptAPI('./generated-api');
  await generator.close();
}

main();
```

运行：
```bash
tsx scripts/generate-mcp-api.ts
```

### 步骤 3: 配置沙箱权限

创建 `~/.srt-settings.json`:

```json
{
  "network": {
    "allowedDomains": [
      "github.com",
      "*.github.com",
      "api.github.com"
    ]
  },
  "filesystem": {
    "denyRead": [
      "~/.ssh",
      "~/.aws"
    ],
    "allowWrite": [
      "/path/to/workspace",
      "/tmp"
    ],
    "denyWrite": [
      ".env",
      ".git"
    ]
  }
}
```

**迁移提示**:
- `allowedDomains`: 列出你的 MCP servers 需要访问的所有域名
- `allowWrite`: 只包含你的工作目录
- `denyRead/denyWrite`: 保护敏感文件

### 步骤 4: 改造 Agent 代码

**传统代码**:
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 加载所有 MCP 工具
const tools = await loadAllMCPTools(); // 可能有 100+ 个工具定义

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: [{ role: 'user', content: userMessage }],
  tools: tools, // 所有工具都传给模型
});

// 处理工具调用...
```

**Code Mode 代码**:
```typescript
import { CodeModeAgent } from './src/agent.js';

const agent = new CodeModeAgent(
  process.env.ANTHROPIC_API_KEY!,
  './generated-api'
);

// 连接 MCP servers（与生成 API 时相同）
await agent.connectMCPServer('filesystem', 'npx', [...]);
await agent.connectMCPServer('fetch', 'npx', [...]);
await agent.connectMCPServer('github', 'npx', [...]);

// 直接对话，内部自动处理代码执行
const response = await agent.chat(userMessage);
```

### 步骤 5: 测试和验证

创建测试脚本验证迁移效果：

```typescript
// tests/migration-test.ts
import { CodeModeAgent } from '../src/agent.js';

async function runTests() {
  const agent = new CodeModeAgent(
    process.env.ANTHROPIC_API_KEY!,
    './generated-api'
  );

  // 连接 servers
  await agent.connectMCPServer('filesystem', ...);
  await agent.connectMCPServer('fetch', ...);

  console.log('测试 1: 文件操作');
  const test1 = await agent.chat('列出当前目录的所有文件');
  console.log(test1);

  console.log('\n测试 2: HTTP 请求');
  const test2 = await agent.chat('获取 https://api.github.com/users/github');
  console.log(test2);

  console.log('\n测试 3: 复杂工作流');
  const test3 = await agent.chat(
    '读取 package.json，访问其 repository URL，保存响应到 repo-info.json'
  );
  console.log(test3);

  await agent.cleanup();
}

runTests();
```

## 性能对比测试

迁移前后做性能对比：

```typescript
// benchmarks/compare.ts

async function benchmarkTraditional() {
  const start = Date.now();
  // 传统 MCP 方式执行任务
  const result = await runTraditionalMCP(task);
  const duration = Date.now() - start;

  return {
    duration,
    tokensUsed: result.usage.total_tokens,
    roundTrips: result.roundTrips,
  };
}

async function benchmarkCodeMode() {
  const start = Date.now();
  // Code Mode 方式执行任务
  const result = await runCodeMode(task);
  const duration = Date.now() - start;

  return {
    duration,
    tokensUsed: result.usage.total_tokens,
    roundTrips: 1,
  };
}

// 对比结果
const traditional = await benchmarkTraditional();
const codeMode = await benchmarkCodeMode();

console.log('传统模式:', traditional);
console.log('Code Mode:', codeMode);
console.log('提升:');
console.log(`  时间: ${((1 - codeMode.duration/traditional.duration) * 100).toFixed(1)}%`);
console.log(`  Token: ${((1 - codeMode.tokensUsed/traditional.tokensUsed) * 100).toFixed(1)}%`);
```

## 常见迁移问题

### Q: 环境变量如何处理？

**传统方式**:
```json
{
  "mcpServers": {
    "github": {
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    }
  }
}
```

**Code Mode**:
环境变量在启动 MCP server 时传递，保持不变：

```typescript
await agent.connectMCPServer('github', 'npx', [
  '-y', '@modelcontextprotocol/server-github'
], {
  env: {
    ...process.env,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN
  }
});
```

### Q: 如何处理需要交互式授权的 MCP server？

Code Mode 中，MCP servers 仍在主进程运行，授权流程不变：

```typescript
// OAuth 流程示例
const server = await startMCPServer('oauth-service', {
  onAuthRequired: async () => {
    // 弹出浏览器授权
    const token = await doOAuthFlow();
    return token;
  }
});

await agent.connectMCPServer('oauth-service', server);
```

### Q: 自定义工具如何迁移？

如果你有自定义的 MCP server：

1. 保持 MCP server 实现不变
2. 用生成器生成 TypeScript API
3. LLM 通过代码调用你的自定义工具

```typescript
// 你的自定义 MCP server
await generator.connectServer(
  'my-custom-tools',
  'node',
  ['./my-mcp-server/index.js']
);

await generator.generateTypeScriptAPI('./generated-api');
```

生成后：
```typescript
// generated-api/servers/my-custom-tools/myTool.ts
export async function myTool(input: MyToolInput): Promise<MyToolOutput> {
  return callMCPTool('my-custom-tools', 'my_tool', input);
}
```

### Q: 如何逐步迁移而不是一次性切换？

可以混合使用：

```typescript
class HybridAgent {
  private codeModeAgent: CodeModeAgent;
  private traditionalClient: Anthropic;

  async chat(message: string) {
    // 简单任务用传统模式
    if (this.isSimpleTask(message)) {
      return this.traditionalClient.messages.create({...});
    }

    // 复杂任务用 Code Mode
    return this.codeModeAgent.chat(message);
  }

  private isSimpleTask(message: string): boolean {
    // 根据任务复杂度判断
    return message.split(' ').length < 10;
  }
}
```

## 迁移后优化建议

### 1. 工具组织

将常用工具组合成 Skills：

```typescript
// skills/data-analysis/analyze-csv.ts
import * as fs from '../../generated-api/servers/filesystem/index.js';

export async function analyzeCSV(filePath: string) {
  const content = await fs.readFile({ path: filePath });
  const lines = content.split('\n');
  const data = lines.map(line => line.split(','));

  // 分析逻辑...

  return summary;
}
```

### 2. 错误处理

在沙箱配置中监控违规：

```typescript
import { SandboxViolationStore } from '@anthropic-ai/sandbox-runtime';

SandboxViolationStore.onViolation((violation) => {
  console.error('沙箱违规:', violation);
  // 记录日志、发送告警等
});
```

### 3. 性能监控

```typescript
const startTime = Date.now();
const result = await sandbox.executeCode(code);
const duration = Date.now() - startTime;

metrics.record({
  operation: 'code_execution',
  duration,
  tokensUsed: result.usage?.total_tokens,
  success: result.success,
});
```

## 回滚计划

如果迁移遇到问题，如何快速回滚：

1. 保留原有传统 MCP 配置
2. 使用环境变量控制模式：

```typescript
const USE_CODE_MODE = process.env.USE_CODE_MODE === 'true';

if (USE_CODE_MODE) {
  agent = new CodeModeAgent(...);
} else {
  agent = new TraditionalAgent(...);
}
```

3. 灰度发布：先对部分用户启用

```typescript
const enableCodeMode = userId % 10 === 0; // 10% 用户
```

## 总结

迁移到 Code Mode 的关键点：

1. ✅ 保持 MCP servers 不变
2. ✅ 生成 TypeScript API
3. ✅ 配置沙箱权限
4. ✅ 改造 Agent 代码
5. ✅ 充分测试
6. ✅ 监控性能

预期收益：
- Token 消耗减少 80-98%
- 响应速度提升 50-75%
- 支持更复杂的工作流
- 更好的安全隔离
