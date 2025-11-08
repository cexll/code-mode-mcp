#!/usr/bin/env node
/**
 * Code Mode MCP Server
 *
 * 反转架构：不再是独立 Agent 调用模型，而是作为 MCP Server
 * 让 Claude Code 调用本 server 的工具来执行代码
 *
 * 架构对比：
 *
 * ❌ 旧架构（需要 API key）：
 *    用户 → CodeModeAgent → 调用 Anthropic API 生成代码 → 沙箱执行
 *
 * ✅ 新架构（无需 API key）：
 *    Claude Code（自己生成代码）→ 调用本 MCP Server → 沙箱执行代码
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Sandbox } from "./sandbox.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEBUG = process.env.SANDBOX_DEBUG === "true";

const server = new Server(
  {
    name: "code-mode-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// 全局沙箱实例和 MCP clients
let sandbox: Sandbox | null = null;
const mcpClients = new Map<string, Client>();

/**
 * 连接到指定的 MCP server
 */
async function connectMCPServer(
  serverName: string,
  command: string,
  args: string[],
) {
  const transport = new StdioClientTransport({ command, args });
  const client = new Client(
    { name: `code-mode-${serverName}`, version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  mcpClients.set(serverName, client);
  if (DEBUG) console.error(`✅ 已连接 MCP server: ${serverName}`);
  return client;
}

/**
 * 动态生成工具树
 */
async function generateToolsTree(): Promise<string> {
  const lines: string[] = ["可用工具:", "servers/"];
  const serverNames = Array.from(mcpClients.keys());

  for (let i = 0; i < serverNames.length; i++) {
    const serverName = serverNames[i];
    const client = mcpClients.get(serverName)!;
    const isLast = i === serverNames.length - 1;
    const prefix = isLast ? "└──" : "├──";

    try {
      const toolsResponse = await client.listTools();
      const tools = toolsResponse.tools;

      lines.push(`${prefix} ${serverName}/`);

      for (let j = 0; j < tools.length; j++) {
        const tool = tools[j];
        const isLastTool = j === tools.length - 1;
        const toolPrefix = isLast ? "    " : "│   ";
        const toolBranch = isLastTool ? "└──" : "├──";
        lines.push(`${toolPrefix}${toolBranch} ${tool.name}`);
      }
    } catch (error) {
      // 如果获取工具列表失败，显示错误信息
      lines.push(
        `${prefix} ${serverName}/ (获取失败: ${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * 初始化沙箱
 */
async function initializeSandbox() {
  if (!sandbox) {
    // 连接 MCP servers（使用 claude mcp list 显示的配置）
    await connectMCPServer("filesystem", "npx", [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      process.cwd(),
    ]);

    // 使用正确的 fetch server（从 git 安装）
    await connectMCPServer("fetch", "uvx", [
      "--from",
      "git+https://github.com/cexll/mcp-server-fetch.git",
      "mcp-server-fetch",
    ]);
    // 3: sequential-thinking
    await connectMCPServer("sequential-thinking", "npx", [
      "-y",
      "mcp-sequentialthinking-tools",
    ]);

    // 3: codex-cli
    await connectMCPServer("codex-cli", "npx", [
      "-y",
      "@cexll/codex-mcp-server",
    ]);

    sandbox = new Sandbox(mcpClients);

    await sandbox.initialize();
    if (DEBUG) console.error("✅ 沙箱已初始化");
  }
}

// 列出工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_code",
        description:
          "在安全沙箱中执行 TypeScript 代码。代码可以调用已连接的 MCP servers（filesystem、fetch 等）。" +
          "\n\n使用方式：" +
          "\n1. 编写调用 MCP 工具的代码" +
          "\n2. 代码在沙箱中执行" +
          "\n3. 返回 console.log 的输出" +
          "\n\n示例：" +
          '\nimport * as fs from "./servers/filesystem/index.js";' +
          '\nconst content = await fs.readFile({ path: "package.json" });' +
          "\nconsole.log(JSON.parse(content));",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description:
                "TypeScript 代码（可以导入 ./servers/* 下的 MCP 工具）",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "list_available_tools",
        description: "列出沙箱中可用的 MCP 工具（文件树结构）",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!sandbox) {
    await initializeSandbox();
  }

  if (request.params.name === "execute_code") {
    const { code } = request.params.arguments as { code: string };

    if (DEBUG) console.error("🔧 执行代码:\n", code);

    const result = await sandbox!.executeCode(code);

    if (DEBUG) console.error("📤 执行结果:", result.success ? "成功" : "失败");

    if (result.success) {
      return {
        content: [
          {
            type: "text",
            text: result.output,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `执行错误:\n${result.error}`,
          },
        ],
        isError: true,
      };
    }
  } else if (request.params.name === "list_available_tools") {
    const toolsTree = await generateToolsTree();
    return {
      content: [
        {
          type: "text",
          text: toolsTree,
        },
      ],
    };
  }

  throw new Error(`未知工具: ${request.params.name}`);
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (DEBUG) {
    console.error("🚀 Code Mode MCP Server 已启动");
    console.error("💡 此 server 无需 ANTHROPIC_API_KEY");
    console.error("💡 由调用方（如 Claude Code）生成代码,本 server 负责执行");
  }
}

main().catch(console.error);
