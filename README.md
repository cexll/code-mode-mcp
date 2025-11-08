# MCP Code Mode Server

基于 MCP 的"代码即工具"实现：在安全沙箱中执行 TypeScript 代码，通过 IPC 桥接调用 MCP servers。

**测试覆盖率**: 99.41% 语句 · 100% 行 · 100% 函数

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 生成 TypeScript API
npm run generate-api

# 3. 构建项目
npm run build

# 4. 运行测试套件
npm test
```

---

## 配置 Claude Desktop

### 配置文件位置

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### 配置内容

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "node",
      "args": [
        "/绝对路径/mcp-code-mode-demo/dist/server.js"
      ],
      "description": "Execute TypeScript in sandbox with MCP tools"
    }
  }
}
```

**注意**: 替换为实际项目的绝对路径。

配置完成后，重启 Claude Desktop 即可使用。

---

## 使用示例

### 读取文件

```typescript
import * as fs from "./servers/filesystem/index.js";

const content = await fs.readFile({ path: "package.json" });
const pkg = JSON.parse(content);
console.log("项目:", pkg.name);
```

### 写入文件

```typescript
import * as fs from "./servers/filesystem/index.js";

await fs.writeFile({
  path: "output.txt",
  content: "Hello from Code Mode!"
});
```

### 列出目录

```typescript
import * as fs from "./servers/filesystem/index.js";

const files = await fs.listDirectory({ path: "." });
console.log("当前目录文件:", files);
```

### 网络请求

```typescript
import * as fetch from "./servers/fetch/index.js";

const response = await fetch.fetch({
  url: "https://api.github.com/repos/anthropics/claude-code"
});
const data = JSON.parse(response);
console.log("Stars:", data.stargazers_count);
```

---

## 工作原理

```
Claude Desktop ↔ MCP Server (本项目)
          │  execute_code 工具
          ▼
   主进程 ─── fork ───▶ 子进程（执行用户 TS）
     ▲                      │
     │      process.send    │  import './servers/...'
     └────── IPC ───────────┘
     │
MCP Servers (filesystem、fetch 等)
```

- 子进程通过 IPC 向主进程发送 MCP 工具调用请求
- 主进程代理执行并返回结果
- 支持跨平台：macOS / Linux / Windows

---

## 项目结构

```
src/
├── generator.ts        # MCP → TypeScript API 生成器
├── sandbox.ts          # 沙箱执行器（Node.js fork + IPC）
└── server.ts           # MCP Server 入口

generated-api/
├── client.ts           # IPC 客户端
└── servers/            # MCP server API 封装
```

---

## 测试

```bash
# 运行测试
npm test

# 查看覆盖率
npm run test:coverage
```

---

## 核心特性

- **IPC 桥接**: 子进程安全调用主进程 MCP 工具
- **模块解析**: 符号链接或目录拷贝（自动降级）
- **跨平台**: macOS / Linux / Windows 完整支持
- **高测试覆盖率**: 36 个测试用例，覆盖核心路径
- **生产就绪**: 隔离执行、资源清理、超时控制

---

## 故障排查

### Server 无法启动

1. 检查是否已构建：`npm run build`
2. 检查 `dist/server.js` 是否存在
3. 确认 Node.js 版本 >= 18

### 代码执行失败

1. 确保已生成 API：`npm run generate-api`
2. 检查 `generated-api/servers/` 目录是否存在
3. 验证导入路径：`./servers/...`

### Claude Desktop 看不到工具

1. 检查配置文件路径是否正确
2. 确保使用绝对路径
3. 重启 Claude Desktop
4. 查看开发者工具控制台日志

---

## 安全沙箱

本项目集成了 [Anthropic Sandbox Runtime](https://github.com/anthropic-experimental/sandbox-runtime)，在 OS 级别限制进程的文件系统和网络访问权限。

### 启用沙箱（默认）

```bash
# 使用沙箱保护运行 server
npm run server

# 使用沙箱保护运行 example
npm run example
```

沙箱会自动限制：
- **网络访问**：仅允许 npm/GitHub 域名
- **文件读取**：拒绝 `~/.ssh`、`~/.aws` 等敏感目录
- **文件写入**：仅允许当前目录、`.sandbox-temp`、`/tmp`
- **敏感文件保护**：拒绝写入 `.env`、`*.key` 等文件

### 配置沙箱权限

编辑 `.srt-settings.json` 自定义权限：

```json
{
  "network": {
    "allowedDomains": ["example.com"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["~/.ssh"],
    "allowWrite": ["."],
    "denyWrite": [".env", "*.key"]
  }
}
```

**配置项说明：**

- `network.allowedDomains`: 允许访问的域名（支持通配符 `*.example.com`）
- `network.deniedDomains`: 拒绝访问的域名（优先级高于 allowedDomains）
- `filesystem.denyRead`: 拒绝读取的路径
- `filesystem.allowWrite`: 允许写入的路径（默认仅当前目录）
- `filesystem.denyWrite`: 拒绝写入的路径（优先级高于 allowWrite）

路径支持：
- 绝对路径：`/etc/passwd`
- 相对路径：`./src`
- 用户目录：`~/.ssh`
- Glob 模式（macOS）：`src/**/*.ts`

### 禁用沙箱

测试或开发时可禁用沙箱：

```bash
# 不使用沙箱运行（风险自负）
npm run server:unsafe
npm run example:unsafe
```

**注意**：测试套件默认不使用沙箱（`npm test` 直接运行），因为测试框架需要更宽松的权限。

### 平台依赖

- **macOS**: 无需额外依赖（使用系统自带 `sandbox-exec`）
- **Linux**: 需要安装 `bubblewrap`、`socat`、`ripgrep`
  ```bash
  # Ubuntu/Debian
  sudo apt-get install bubblewrap socat ripgrep

  # Fedora
  sudo dnf install bubblewrap socat ripgrep

  # Arch
  sudo pacman -S bubblewrap socat ripgrep
  ```

---

## 安全建议

- ✅ **已集成 OS 级沙箱**（Anthropic Sandbox Runtime）
- ✅ **子进程隔离执行** + IPC 通信
- ✅ **文件系统/网络白名单控制**
- 建议生产环境额外配置资源限制（CPU/内存）
- 可选：容器级/系统级额外隔离

---

## License

MIT
