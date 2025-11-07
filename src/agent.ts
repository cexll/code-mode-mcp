import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CodeModeSandbox } from './sandbox.js';
import * as fs from 'fs/promises';

/**
 * Code Mode Agent
 * 使用代码执行方式与 MCP 交互的 AI Agent
 */
export class CodeModeAgent {
  private anthropic: Anthropic;
  private mcpClients: Map<string, Client> = new Map();
  private sandbox?: CodeModeSandbox;
  private generatedApiPath: string;

  constructor(apiKey: string, generatedApiPath: string) {
    this.anthropic = new Anthropic({ apiKey });
    this.generatedApiPath = generatedApiPath;
  }

  /**
   * 连接 MCP Server
   */
  async connectMCPServer(serverName: string, command: string, args: string[]) {
    const transport = new StdioClientTransport({ command, args });
    const client = new Client(
      { name: `code-mode-agent-${serverName}`, version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.mcpClients.set(serverName, client);
    console.log(`✅ 已连接 MCP server: ${serverName}`);
  }

  /**
   * 初始化沙箱
   */
  async initializeSandbox() {
    this.sandbox = new CodeModeSandbox(this.mcpClients, {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        denyRead: ['~/.ssh'],
        allowWrite: ['.', '/tmp'],
        denyWrite: ['.env'],
      },
    });
    await this.sandbox.initialize();
  }

  /**
   * 获取可用工具的文件树信息
   */
  async getToolsFileTree(): Promise<string> {
    const serversDir = `${this.generatedApiPath}/servers`;

    try {
      const servers = await fs.readdir(serversDir);
      let tree = 'Available MCP tools (filesystem structure):\n\n';
      tree += 'servers/\n';

      for (const server of servers) {
        const serverPath = `${serversDir}/${server}`;
        const stat = await fs.stat(serverPath);

        if (stat.isDirectory()) {
          tree += `├── ${server}/\n`;
          const files = await fs.readdir(serverPath);

          for (const file of files) {
            if (file.endsWith('.ts') && file !== 'index.ts') {
              const toolName = file.replace('.ts', '');
              tree += `│   ├── ${file}\n`;
            }
          }
        }
      }

      return tree;
    } catch (error) {
      return 'No generated API found. Please run generator first.';
    }
  }

  /**
   * 读取特定工具的定义
   */
  async getToolDefinition(serverName: string, toolName: string): Promise<string> {
    const toolPath = `${this.generatedApiPath}/servers/${serverName}/${toolName}.ts`;

    try {
      return await fs.readFile(toolPath, 'utf-8');
    } catch {
      return `Tool not found: ${serverName}/${toolName}`;
    }
  }

  /**
   * 运行对话（Code Mode）
   */
  async chat(userMessage: string): Promise<string> {
    if (!this.sandbox) {
      await this.initializeSandbox();
    }

    // 构建系统提示
    const fileTree = await this.getToolsFileTree();
    const systemPrompt = `You are an AI assistant with access to MCP tools via code execution.

${fileTree}

To use tools:
1. First, read the tool definition files to understand the API
2. Import the tools: import * as serverName from './servers/serverName/index.js'
3. Write TypeScript code to accomplish the task
4. Use console.log() to output results

Your code will run in a secure sandbox with access to the MCP servers.

Example:
\`\`\`typescript
import * as fetch from './servers/fetch/index.js';

const result = await fetch.fetchUrl({ url: 'https://example.com' });
console.log('Result:', result);
\`\`\``;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    // 对话循环
    let response = '';
    const maxIterations = 5;

    for (let i = 0; i < maxIterations; i++) {
      const result = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: [
          {
            name: 'execute_code',
            description: 'Execute TypeScript code in a sandboxed environment with access to MCP tools',
            input_schema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'TypeScript code to execute',
                },
              },
              required: ['code'],
            },
          },
          {
            name: 'read_tool_definition',
            description: 'Read the TypeScript definition of a specific MCP tool',
            input_schema: {
              type: 'object',
              properties: {
                server_name: { type: 'string' },
                tool_name: { type: 'string' },
              },
              required: ['server_name', 'tool_name'],
            },
          },
        ],
      });

      // 检查是否有文本响应
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        response += textContent.text + '\n';
      }

      // 处理工具调用
      if (result.stop_reason === 'tool_use') {
        const toolUse = result.content.find(c => c.type === 'tool_use');

        if (toolUse && toolUse.type === 'tool_use') {
          let toolResult: string;

          if (toolUse.name === 'execute_code') {
            const { code } = toolUse.input as { code: string };
            console.log('\n🔧 执行代码:\n', code, '\n');

            const execResult = await this.sandbox!.executeCode(code);
            toolResult = execResult.success
              ? execResult.output
              : `Error: ${execResult.error}`;

            console.log('📤 执行结果:\n', toolResult, '\n');
          } else if (toolUse.name === 'read_tool_definition') {
            const { server_name, tool_name } = toolUse.input as {
              server_name: string;
              tool_name: string;
            };
            toolResult = await this.getToolDefinition(server_name, tool_name);
          } else {
            toolResult = 'Unknown tool';
          }

          // 添加工具结果到消息历史
          messages.push({
            role: 'assistant',
            content: result.content,
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: toolResult,
              },
            ],
          });

          continue;
        }
      }

      // 完成
      break;
    }

    return response;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    for (const client of this.mcpClients.values()) {
      await client.close();
    }
    if (this.sandbox) {
      await this.sandbox.cleanup();
    }
  }
}
