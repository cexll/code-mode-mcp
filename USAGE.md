# 在 Claude Code 中使用 MCP Code Mode

本指南详细说明如何配置和使用 Code Mode。

## 📋 前置要求

- Node.js 18+
- npm 或 pnpm
- Anthropic API Key
- Claude Code CLI（可选）

## 🔧 方式一：作为独立 Agent 使用

### 步骤 1: 克隆并安装

```bash
git clone git@github.com:cexll/code-mode-mcp.git
cd code-mode-mcp
./setup.sh
```

或手动安装：

```bash
npm install
npm install -g @anthropic-ai/sandbox-runtime
```

### 步骤 2: 配置 MCP Servers

编辑 `examples/generate-api.ts`，连接你需要的 MCP servers：

```typescript
import { MCPToTypeScriptGenerator } from '../src/generator.js';

async function main() {
  const generator = new MCPToTypeScriptGenerator();

  // 1. Filesystem - 文件操作
  await generator.connectServer(
    'filesystem',
    'npx',
    ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]
  );

  // 2. Fetch - HTTP 请求
  await generator.connectServer(
    'fetch',
    'npx',
    ['-y', '@modelcontextprotocol/server-fetch']
  );

  // 3. GitHub（需要设置 GITHUB_TOKEN）
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

### 步骤 3: 生成 TypeScript API

```bash
npm run generate-api
```

输出示例：
```
✅ 已连接 MCP server: filesystem
✅ 已连接 MCP server: fetch
📝 生成 filesystem 的 TypeScript API (10 个工具)
📝 生成 fetch 的 TypeScript API (2 个工具)
✅ TypeScript API 已生成到: ./generated-api
```

### 步骤 4: 配置沙箱权限

```bash
cp .srt-settings.example.json ~/.srt-settings.json
```

编辑 `~/.srt-settings.json`：

```json
{
  "network": {
    "allowedDomains": ["github.com", "*.github.com", "api.github.com"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", ".git"]
  }
}
```

### 步骤 5: 设置 API Key

```bash
export ANTHROPIC_API_KEY='sk-ant-api03-your-key'
```

### 步骤 6: 运行 Agent

```bash
tsx examples/chat.ts
```

---

## 🎯 方式二：在 Claude Code 中集成

### 选项 A: 通过 API 集成

创建 `my-project/code-mode-agent.ts`：

```typescript
import { CodeModeAgent } from 'code-mode-mcp/src/agent.js';

const agent = new CodeModeAgent(
  process.env.ANTHROPIC_API_KEY!,
  './node_modules/code-mode-mcp/generated-api'
);

// 连接 MCP servers
await agent.connectMCPServer('filesystem', 'npx', [
  '-y', '@modelcontextprotocol/server-filesystem', '.'
]);

await agent.connectMCPServer('fetch', 'npx', [
  '-y', '@modelcontextprotocol/server-fetch'
]);

// 使用
const response = await agent.chat('列出所有 TypeScript 文件');
console.log(response);
```

### 选项 B: 通过 Claude Desktop 集成

**1. 安装为全局工具**

```bash
cd code-mode-mcp
npm run generate-api
npm link
```

**2. 创建 Claude Desktop 配置**

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）：

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "node",
      "args": [
        "/path/to/code-mode-mcp/examples/mcp-server.js"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-api03-your-key"
      }
    }
  }
}
```

**3. 创建 MCP Server 包装器**

`examples/mcp-server.js`:

```javascript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CodeModeAgent } from '../src/agent.js';

const server = new Server({
  name: 'code-mode-mcp',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

// 初始化 Code Mode Agent
const agent = new CodeModeAgent(
  process.env.ANTHROPIC_API_KEY,
  './generated-api'
);

// ... 连接 MCP servers ...

// 注册工具
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [{
      name: 'execute_code_mode',
      description: 'Execute task using Code Mode (write code to call MCP tools)',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description' }
        },
        required: ['task']
      }
    }]
  };
});

server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'execute_code_mode') {
    const result = await agent.chat(request.params.arguments.task);
    return {
      content: [{ type: 'text', text: result }]
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 📝 实际使用示例

### 示例 1: 数据分析

```
You: 读取 sales.csv，计算总销售额，找出销售额最高的 5 个产品

Agent 执行的代码:
  import * as fs from './servers/filesystem/index.js';

  const csv = await fs.readFile({ path: 'sales.csv' });
  const lines = csv.split('\n').slice(1); // 跳过标题

  const sales = lines.map(line => {
    const [product, amount] = line.split(',');
    return { product, amount: parseFloat(amount) };
  });

  const total = sales.reduce((sum, s) => sum + s.amount, 0);
  const top5 = sales.sort((a, b) => b.amount - a.amount).slice(0, 5);

  console.log(`总销售额: $${total.toFixed(2)}`);
  console.log('Top 5 产品:', top5);

结果:
  总销售额: $458,923.50
  Top 5 产品: [
    { product: 'iPhone 15', amount: 45823.50 },
    { product: 'MacBook Pro', amount: 39281.20 },
    ...
  ]
```

### 示例 2: GitHub 操作

```
You: 获取 anthropics/claude-code 仓库的最新 10 个 issues，保存到 issues.json

Agent 执行的代码:
  import * as github from './servers/github/index.js';
  import * as fs from './servers/filesystem/index.js';

  const issues = await github.listIssues({
    owner: 'anthropics',
    repo: 'claude-code',
    state: 'all',
    per_page: 10
  });

  await fs.writeFile({
    path: 'issues.json',
    content: JSON.stringify(issues, null, 2)
  });

  console.log(`已保存 ${issues.length} 个 issues 到 issues.json`);

结果:
  已保存 10 个 issues 到 issues.json
```

### 示例 3: 批量 API 调用

```
You: 读取 users.json，为每个用户查询 GitHub 资料并汇总

Agent 执行的代码:
  import * as fs from './servers/filesystem/index.js';
  import * as fetch from './servers/fetch/index.js';

  const usersJson = await fs.readFile({ path: 'users.json' });
  const users = JSON.parse(usersJson);

  const profiles = [];

  for (const username of users) {
    const response = await fetch.fetch({
      url: `https://api.github.com/users/${username}`
    });
    const data = JSON.parse(response);
    profiles.push({
      username: data.login,
      followers: data.followers,
      repos: data.public_repos
    });
  }

  console.log('用户资料汇总:', profiles);

结果:
  用户资料汇总: [
    { username: 'torvalds', followers: 182000, repos: 6 },
    { username: 'gaearon', followers: 89500, repos: 156 },
    ...
  ]
```

---

## 🛠️ 高级配置

### 自定义 MCP Server

如果你有自己的 MCP server：

```typescript
// 1. 生成 API 时连接
await generator.connectServer(
  'my-custom-server',
  'node',
  ['./path/to/my-mcp-server.js']
);

// 2. Agent 使用时连接
await agent.connectMCPServer(
  'my-custom-server',
  'node',
  ['./path/to/my-mcp-server.js']
);

// 3. 在代码中调用
import * as custom from './servers/my-custom-server/index.js';

const result = await custom.myTool({ param: 'value' });
```

### 配置多个工作目录

```typescript
// 为不同项目生成不同的 API
await generator.connectServer('project-a-fs', 'npx', [
  '-y', '@modelcontextprotocol/server-filesystem', '/path/to/project-a'
]);

await generator.connectServer('project-b-fs', 'npx', [
  '-y', '@modelcontextprotocol/server-filesystem', '/path/to/project-b'
]);
```

### 环境变量配置

为 MCP servers 传递环境变量：

```typescript
import { spawn } from 'child_process';

// 启动时设置环境变量
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    ...process.env,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_API_URL: 'https://api.github.com'
  }
});
```

---

## 🔍 调试技巧

### 查看生成的代码

在 `src/agent.ts` 中启用调试：

```typescript
if (toolUse.name === 'execute_code') {
  const { code } = toolUse.input as { code: string };

  // 保存生成的代码
  await fs.writeFile('/tmp/generated-code.ts', code, 'utf-8');
  console.log('\n🔧 生成的代码已保存到: /tmp/generated-code.ts');

  const execResult = await this.sandbox!.executeCode(code);
  // ...
}
```

### 查看沙箱违规

```bash
# macOS 查看沙箱日志
log show --predicate 'process == "sandbox-exec"' --last 1h

# 或在代码中监听
import { SandboxViolationStore } from '@anthropic-ai/sandbox-runtime';

SandboxViolationStore.onViolation((violation) => {
  console.error('🚨 沙箱违规:', violation);
});
```

### 测试生成的 API

```bash
# 直接测试生成的 TypeScript API
tsx << 'EOF'
import * as fs from './generated-api/servers/filesystem/index.js';

const result = await fs.readFile({ path: 'package.json' });
console.log(result);
EOF
```

---

## ⚠️ 常见问题

### Q1: 生成 API 时连接 MCP server 失败

```
Error: spawn npx ENOENT
```

**解决**: 确保 `npx` 在 PATH 中，或使用完整路径：

```typescript
await generator.connectServer('filesystem', '/usr/local/bin/npx', [...]);
```

### Q2: 沙箱执行代码报权限错误

```
Error: EPERM: operation not permitted
```

**解决**: 检查 `~/.srt-settings.json`，确保路径在 `allowWrite` 中：

```json
{
  "filesystem": {
    "allowWrite": [".", "/tmp", "/path/to/your/project"]
  }
}
```

### Q3: 网络请求被阻止

```
Connection blocked by network allowlist
```

**解决**: 添加域名到 `allowedDomains`：

```json
{
  "network": {
    "allowedDomains": ["api.example.com", "*.github.com"]
  }
}
```

### Q4: API Key 无效

```
Error: Invalid API key
```

**解决**: 检查环境变量：

```bash
echo $ANTHROPIC_API_KEY  # 应该输出 sk-ant-api03-...
```

或在代码中验证：

```typescript
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY not set');
}
```

---

## 📊 性能优化建议

### 1. 缓存生成的 API

```bash
# 生成一次，多次使用
npm run generate-api

# 将 generated-api/ 提交到 git（如果 MCP servers 稳定）
git add generated-api/
git commit -m "Add generated MCP API"
```

### 2. 按需加载工具

不要一次连接所有 MCP servers，只连接需要的：

```typescript
// ❌ 不好：连接所有
await connectAll();

// ✅ 好：只连接需要的
if (needFilesystem) {
  await agent.connectMCPServer('filesystem', ...);
}
```

### 3. 复用 Agent 实例

```typescript
// 创建一次，多次使用
const agent = new CodeModeAgent(...);
await agent.initializeSandbox();

// 多个任务
await agent.chat('task 1');
await agent.chat('task 2');
await agent.chat('task 3');

// 最后清理
await agent.cleanup();
```

---

## 🎓 最佳实践

### 1. 明确任务描述

```
❌ "处理数据"
✅ "读取 sales.csv，计算每个产品的总销售额，按降序排序，保存前 10 名到 top-products.json"
```

### 2. 分步执行复杂任务

```
Step 1: "读取 users.json 并显示前 3 个用户"
Step 2: "为这 3 个用户查询 GitHub API"
Step 3: "现在为所有用户执行"
```

### 3. 验证结果

```
You: "读取 config.json 并显示其中的 API endpoint"

Agent: 显示结果

You: "好的，现在调用这个 endpoint"
```

### 4. 使用 Skills 保存常用操作

将生成的代码保存为 Skills：

```typescript
// skills/analyze-csv.ts
export async function analyzeCSV(filePath: string) {
  // ... 复用的代码 ...
}

// 下次直接使用
import { analyzeCSV } from './skills/analyze-csv.js';
const result = await analyzeCSV('sales.csv');
```

---

## 🚀 生产环境部署

### Docker 容器化

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run generate-api

# 安装 sandbox-runtime
RUN npm install -g @anthropic-ai/sandbox-runtime

ENV ANTHROPIC_API_KEY=""

CMD ["tsx", "examples/chat.ts"]
```

### 监控和日志

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'code-mode.log' })
  ]
});

// 在 agent 中使用
const result = await sandbox.executeCode(code);
logger.info('Code execution', {
  success: result.success,
  duration: executionTime,
  tokensUsed: usage.total_tokens
});
```

---

## 📚 参考资源

- [项目主页](https://github.com/cexll/code-mode-mcp)
- [Anthropic Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Sandbox Runtime 文档](https://github.com/anthropic-experimental/sandbox-runtime)
- [MCP 协议文档](https://modelcontextprotocol.io/)

---

**开始使用**: `cd code-mode-mcp && ./setup.sh` 🚀
