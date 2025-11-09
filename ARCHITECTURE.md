# MCP Code Mode 架构说明

## 🎯 设计理念

基于 Cloudflare 和 Anthropic 的 code-mode 最佳实践，本项目采用"代码即工具"架构：
- 将 MCP 工具转换为 TypeScript API
- 在沙箱中执行用户代码
- 通过内置工具实现完整功能（无外部依赖）

---

## 🏗️ 架构决策

### **完全独立的 code-mode 服务器**

| 功能 | 实现位置 | 技术方案 |
|------|----------|---------|
| **Filesystem 工具** | code-mode 内置 | ✅ 直接文件系统访问 |
| **Fetch 工具** | code-mode 内置 | ✅ srt 代理 + https-proxy-agent |
| **代码执行** | Node.js fork + IPC | ✅ 进程隔离 |
| **网络隔离** | Anthropic srt | ✅ 域名白名单 + 代理控制 |

### **核心问题与解决方案**

#### **问题 1: stdio 冲突**

code-mode 作为 MCP server 使用 stdio 与 Claude Code 通信，无法再 fork 子 MCP server（它们也需要 stdio）。

**解决方案**：内置工具（Builtin Tools）
- 在 `src/builtin-tools.ts` 中直接实现 MCP 工具
- 实现标准 MCP Client 接口（`callTool`, `listTools`）
- 无需 stdio，直接在进程内调用

#### **问题 2: Node.js 不遵守代理环境变量**

srt 通过环境变量（`HTTPS_PROXY`）提供代理，但 Node.js 的 `https.get()` 默认不使用这些变量。

**解决方案**：https-proxy-agent
```typescript
// 检查 srt 设置的代理环境变量
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

if (proxyUrl && isHttps) {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  agent = new HttpsProxyAgent(proxyUrl);
}

// 使用 agent 发起请求
client.get(url, { agent }, callback);
```

**官方文档确认**：
> "may be ignored by programs that don't respect these variables, leading to them being unable to connect to the internet"
>
> — [sandbox-runtime README](https://github.com/anthropic-experimental/sandbox-runtime)

### **最终架构优势**

✅ **完全独立** - code-mode 自包含所有功能，无需依赖 Claude Code 的 MCP 工具
✅ **功能完整** - Filesystem (10 工具) + Fetch (1 工具)
✅ **安全隔离** - srt 提供 OS 级沙箱 + 域名白名单
✅ **性能优秀** - 内置工具无 IPC 开销

---

## 📊 工具可用性

### **code-mode 内置工具（11/11）**

#### **Filesystem 工具（10）**
```typescript
import * as fs from "./servers/filesystem/index.js";

// ✅ 所有这些工具都在沙箱中直接可用
await fs.readFile({ path: "./file.txt" });
await fs.writeFile({ path: "./output.txt", content: "data" });
await fs.listDirectory({ path: "./src" });
await fs.createDirectory({ path: "./workspace" });
await fs.moveFile({ source: "./a.txt", destination: "./b.txt" });
await fs.searchFiles({ path: "./src", pattern: ".*\\.ts$" });
await fs.getFileInfo({ path: "./README.md" });
await fs.readMultipleFiles({ paths: ["a.txt", "b.txt"] });
await fs.listAllowedDirectories();
await fs.editFile({ path: "./config.json", edits: [...] });
```

#### **Fetch 工具（1）**
```typescript
import * as fetch from "./servers/fetch/index.js";

// ✅ 通过 srt 代理自动访问白名单域名
const result = await fetch.fetch({
  url: "https://httpbin.org/ip",
  max_length: 50000  // 可选
});

// result = { content: [{ type: 'text', text: '...' }] }
```

**网络访问规则**：
- 仅允许访问 `.srt-settings.json` 中的 `allowedDomains`
- srt 自动启动代理（监听 localhost 随机端口）
- https-proxy-agent 自动使用 `HTTPS_PROXY` 环境变量

---

## 🔧 实际工作流示例

### **示例 1：获取 GitHub API 数据并保存**

```typescript
import * as fs from "./servers/filesystem/index.js";
import * as fetch from "./servers/fetch/index.js";

// 步骤 1：获取数据（通过 srt 代理）
const response = await fetch.fetch({
  url: "https://api.github.com/repos/anthropics/claude-code"
});

const repoData = JSON.parse(response.content[0].text);

// 步骤 2：在沙箱中处理和保存
const report = `
# GitHub 仓库报告

- 名称: ${repoData.name}
- Stars: ${repoData.stargazers_count}
- Forks: ${repoData.forks_count}
- 生成时间: ${new Date().toISOString()}
`;

await fs.writeFile({
  path: "./github-report.md",
  content: report
});

console.log("✅ 报告已保存");
```

### **示例 2：批量文件处理**

```typescript
import * as fs from "./servers/filesystem/index.js";

// 读取所有 TypeScript 文件
const srcFiles = JSON.parse(
  await fs.listDirectory({ path: "./src" })
);

const tsFiles = srcFiles
  .filter(f => f.name.endsWith('.ts') && f.type === 'file')
  .map(f => `./src/${f.name}`);

// 批量读取
const contents = await fs.readMultipleFiles({ paths: tsFiles });
const files = JSON.parse(contents);

// 统计代码行数
const stats = files.map(file => ({
  name: file.path.split('/').pop(),
  lines: file.content ? file.content.split('\n').length : 0
}));

// 保存统计结果
await fs.writeFile({
  path: "./code-stats.json",
  content: JSON.stringify(stats, null, 2)
});

console.log(`✅ 已统计 ${stats.length} 个文件`);
```

### **示例 3：混合使用 Filesystem + Fetch**

```typescript
import * as fs from "./servers/filesystem/index.js";
import * as fetch from "./servers/fetch/index.js";

// 从远程获取配置
const configResponse = await fetch.fetch({
  url: "https://raw.githubusercontent.com/user/repo/main/config.json"
});

const remoteConfig = JSON.parse(configResponse.content[0].text);

// 读取本地配置
const localConfigContent = await fs.readFile({ path: "./config.json" });
const localConfig = JSON.parse(localConfigContent);

// 合并配置
const mergedConfig = { ...localConfig, ...remoteConfig };

// 保存合并后的配置
await fs.writeFile({
  path: "./config.merged.json",
  content: JSON.stringify(mergedConfig, null, 2)
});

console.log("✅ 配置已合并");
```

---

## 📚 对比：Cloudflare 的实现

Cloudflare 的 code-mode 使用 **Workers isolates** 实现沙箱：

```
Cloudflare Workers 平台
    ↓
V8 Isolate (毫秒级启动)
    ↓
用户代码 + MCP API Bindings
```

**我们的实现：**

```
Claude Code (MCP Host)
    ↓ stdio
code-mode server (srt 沙箱)
    ↓ fork + IPC
用户代码 (沙箱子进程)
    ↓ 内置工具
Filesystem API + Fetch API (via srt 代理)
```

**区别**：
- Cloudflare 用 V8 isolates（更快，但需要 Workers 平台）
- 我们用 Node.js fork（通用性更好，跨平台）
- 网络访问：Cloudflare 用 binding，我们用 srt 代理 + https-proxy-agent

---

## 🚀 快速开始

### **1. 安装依赖**
```bash
npm install
```

### **2. 生成 API**
```bash
npx tsx examples/generate-api-builtin.ts
```

### **3. 构建项目**
```bash
npm run build
```

### **4. 配置 Claude Desktop**

编辑配置文件：
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\\Claude\\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

添加 code-mode（使用 srt wrapper）：
```json
{
  "mcpServers": {
    "code-mode": {
      "command": "npx",
      "args": [
        "@anthropic-ai/srt",
        "run",
        "node",
        "/绝对路径/mcp-code-mode-demo/dist/server.js"
      ],
      "description": "Code Mode - TypeScript 沙箱执行，内置 filesystem 和 fetch 工具（通过 srt 代理实现网络访问）。",
      "env": {
        "NODE_OPTIONS": "--no-warnings"
      }
    }
  }
}
```

**注意：** 替换为你的实际项目绝对路径！

### **5. 配置网络白名单**

编辑 `.srt-settings.json`，添加需要访问的域名：
```json
{
  "network": {
    "allowedDomains": [
      "httpbin.org",
      "*.github.com",
      "api.github.com",
      "你的域名.com"
    ]
  }
}
```

### **6. 重启 Claude Desktop**

完全退出并重新启动即可使用。

---

## 🔍 验证安装

重启后，测试 filesystem + fetch 工具：

```typescript
import * as fs from "./servers/filesystem/index.js";
import * as fetch from "./servers/fetch/index.js";

// 测试 Filesystem
const content = await fs.readFile({ path: "./package.json" });
const pkg = JSON.parse(content);
console.log(`项目: ${pkg.name} v${pkg.version}`);

// 测试 Fetch（需要在 .srt-settings.json 中添加 httpbin.org）
const response = await fetch.fetch({ url: "https://httpbin.org/ip" });
console.log(`IP 信息: ${response.content[0].text}`);
```

---

## 📝 技术细节

### **内置工具实现（src/builtin-tools.ts）**

```typescript
export interface BuiltinMCPClient {
  callTool(params: { name: string; arguments: any }): Promise<any>;
  listTools(): Promise<{ tools: Array<{...}> }>;
}

// FilesystemTools: 实现 10 个文件系统工具
// FetchTools: 实现 1 个 fetch 工具（带 https-proxy-agent）
export function createBuiltinTools(): Map<string, BuiltinMCPClient> {
  return new Map([
    ['filesystem', new FilesystemTools()],
    ['fetch', new FetchTools()]
  ]);
}
```

### **代理支持（FetchTools.fetch 方法）**

```typescript
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
let agent = undefined;

if (proxyUrl && isHttps) {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  agent = new HttpsProxyAgent(proxyUrl);
}

const req = client.get(url, { agent }, callback);
```

### **srt 沙箱配置（.srt-settings.json）**

- **network.allowedDomains**: 白名单域名列表
- **filesystem.denyRead**: 禁止读取的敏感目录（如 `~/.ssh`）
- **filesystem.allowWrite**: 允许写入的目录
- **enableWeakerNestedSandbox**: 启用嵌套沙箱支持（fork 子进程）

---

## ⚠️ 注意事项

1. **Filesystem 工具** - 完全可用，受 `.srt-settings.json` 文件系统规则限制
2. **Fetch 工具** - 仅能访问白名单域名（需在 `.srt-settings.json` 中配置）
3. **安全性** - srt 提供 OS 级沙箱隔离，强制执行网络和文件系统策略
4. **性能** - 内置工具性能优秀，fetch 通过 localhost 代理无明显延迟
5. **跨平台** - srt 支持 macOS（sandbox-exec）和 Linux（bubblewrap），Windows 需 WSL

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License - 详见 LICENSE 文件
