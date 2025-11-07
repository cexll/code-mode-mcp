# 🚀 快速开始

## 1️⃣ 安装（2 分钟）

```bash
git clone git@github.com:cexll/code-mode-mcp.git
cd code-mode-mcp
./setup.sh
```

## 2️⃣ 配置 MCP Servers（3 分钟）

编辑 `examples/generate-api.ts`：

```typescript
const generator = new MCPToTypeScriptGenerator();

// 添加你需要的 MCP servers
await generator.connectServer('filesystem', 'npx', [
  '-y', '@modelcontextprotocol/server-filesystem', '.'
]);

await generator.connectServer('fetch', 'npx', [
  '-y', '@modelcontextprotocol/server-fetch'
]);

await generator.generateTypeScriptAPI('./generated-api');
```

## 3️⃣ 生成 API（1 分钟）

```bash
npm run generate-api
```

## 4️⃣ 设置 API Key

```bash
export ANTHROPIC_API_KEY='sk-ant-api03-your-key'
```

## 5️⃣ 运行！

```bash
tsx examples/chat.ts
```

---

## 📝 使用示例

### 示例 1: 文件操作

```
You: 列出所有 .ts 文件

Agent 生成代码:
  import * as fs from './servers/filesystem/index.js';

  const files = await fs.listDirectory({ path: '.' });
  const tsFiles = files.filter(f => f.endsWith('.ts'));
  console.log('TS files:', tsFiles);

结果: ['src/generator.ts', 'src/sandbox.ts', 'src/agent.ts', ...]
```

### 示例 2: HTTP 请求

```
You: 获取 GitHub API 并解析

Agent 生成代码:
  import * as fetch from './servers/fetch/index.js';

  const response = await fetch.fetch({
    url: 'https://api.github.com/users/github'
  });

  const data = JSON.parse(response);
  console.log(`用户: ${data.login}, 关注者: ${data.followers}`);

结果: 用户: github, 关注者: 182,000
```

### 示例 3: 数据处理

```
You: 读取 sales.csv，计算总额，找出前 5 名

Agent 生成代码:
  import * as fs from './servers/filesystem/index.js';

  const csv = await fs.readFile({ path: 'sales.csv' });
  const lines = csv.split('\n').slice(1);

  const sales = lines.map(line => {
    const [product, amount] = line.split(',');
    return { product, amount: parseFloat(amount) };
  });

  const total = sales.reduce((sum, s) => sum + s.amount, 0);
  const top5 = sales.sort((a, b) => b.amount - a.amount).slice(0, 5);

  console.log(`总额: $${total}`);
  console.log('Top 5:', top5);

结果:
  总额: $458,923.50
  Top 5: [{ product: 'iPhone', amount: 45823 }, ...]
```

---

## 🔧 常用命令

```bash
# 查看核心概念
node quick-demo.js

# 生成 MCP TypeScript API
npm run generate-api

# 运行交互式 Agent
tsx examples/chat.ts

# 运行概念演示
npm run example

# 查看生成的文件
tree generated-api/
```

---

## ⚙️ 沙箱配置

编辑 `~/.srt-settings.json`:

```json
{
  "network": {
    "allowedDomains": ["github.com", "*.github.com"]
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", ".git"]
  }
}
```

---

## 🎯 核心概念

| 传统 MCP | Code Mode | 提升 |
|----------|-----------|------|
| ~150K tokens | ~2K tokens | **98.7% ↓** |
| 多轮往返 | 1 轮执行 | **5-10x** |
| 大文件超限 | 沙箱处理 | **无限制** |
| 复杂逻辑困难 | 直接写代码 | **✅** |

**核心思路**: LLM 写代码调用 MCP，而不是直接调工具

**工作流程**:
```
用户请求 → LLM 生成代码 → 沙箱执行 → 最终结果 → LLM
```

**优势**:
- ✅ Token 消耗极低
- ✅ 支持复杂控制流（for/if/try-catch）
- ✅ 大文件无压力
- ✅ 安全隔离
- ✅ 可保存 Skills 复用

---

## 🆘 快速故障排除

### Q: 连接 MCP server 失败
```
Error: spawn npx ENOENT
```
**A**: 使用完整路径：`/usr/local/bin/npx`

### Q: 权限错误
```
Error: EPERM: operation not permitted
```
**A**: 检查 `~/.srt-settings.json`，添加路径到 `allowWrite`

### Q: 网络被阻止
```
Connection blocked by network allowlist
```
**A**: 添加域名到 `allowedDomains`

### Q: API Key 无效
```bash
# 检查
echo $ANTHROPIC_API_KEY

# 设置
export ANTHROPIC_API_KEY='sk-ant-api03-...'
```

---

## 📚 完整文档

- [README.md](README.md) - 项目概览
- [USAGE.md](USAGE.md) - 详细使用指南
- [MIGRATION.md](MIGRATION.md) - 迁移指南
- [SUMMARY.md](SUMMARY.md) - 项目总结

---

## 🌟 下一步

1. **尝试演示**: `node quick-demo.js`
2. **生成 API**: `npm run generate-api`
3. **运行 Agent**: `tsx examples/chat.ts`
4. **阅读文档**: `cat USAGE.md`
5. **Star 项目**: https://github.com/cexll/code-mode-mcp

---

**问题？** 查看 [USAGE.md](USAGE.md) 获取详细帮助！
