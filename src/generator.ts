import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * MCP 工具转 TypeScript API 生成器
 */
export class MCPToTypeScriptGenerator {
  private clients: Map<string, Client> = new Map();

  /**
   * 连接 MCP Server
   */
  async connectServer(serverName: string, command: string, args: string[]) {
    const transport = new StdioClientTransport({
      command,
      args,
    });

    const client = new Client(
      {
        name: `code-mode-${serverName}`,
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
    this.clients.set(serverName, client);

    console.log(`✅ 已连接 MCP server: ${serverName}`);
  }

  /**
   * 生成 TypeScript 接口和 API
   */
  async generateTypeScriptAPI(outputDir: string) {
    await fs.mkdir(outputDir, { recursive: true });

    for (const [serverName, client] of this.clients.entries()) {
      // 获取工具列表
      const toolsResponse = await client.listTools();
      const tools = toolsResponse.tools;

      console.log(`📝 生成 ${serverName} 的 TypeScript API (${tools.length} 个工具)`);

      // 为每个服务器创建目录
      const serverDir = path.join(outputDir, 'servers', serverName);
      await fs.mkdir(serverDir, { recursive: true });

      // 生成每个工具的类型定义和函数
      const toolFiles: string[] = [];

      for (const tool of tools) {
        const toolName = tool.name;
        const fileName = `${toolName}.ts`;
        toolFiles.push(fileName);

        // 生成输入输出类型
        const inputType = this.generateInputType(tool);

        // 生成工具函数
        const toolCode = this.generateToolFunction(
          serverName,
          toolName,
          tool.description || '',
          inputType
        );

        await fs.writeFile(
          path.join(serverDir, fileName),
          toolCode,
          'utf-8'
        );
      }

      // 生成 index.ts
      const indexCode = this.generateIndexFile(toolFiles);
      await fs.writeFile(
        path.join(serverDir, 'index.ts'),
        indexCode,
        'utf-8'
      );
    }

    // 生成 client.ts (MCP 调用桥接)
    await this.generateClientBridge(outputDir);

    console.log(`✅ TypeScript API 已生成到: ${outputDir}`);
  }

  private generateInputType(tool: any): string {
    if (!tool.inputSchema || !tool.inputSchema.properties) {
      return '{}';
    }

    const props = tool.inputSchema.properties;
    const required = tool.inputSchema.required || [];

    const fields = Object.entries(props).map(([key, schema]: [string, any]) => {
      const isRequired = required.includes(key);
      const type = this.jsonSchemaTypeToTS(schema);
      const comment = schema.description ? `  /** ${schema.description} */\n` : '';
      return `${comment}  ${key}${isRequired ? '' : '?'}: ${type};`;
    });

    return `{\n${fields.join('\n')}\n}`;
  }

  private jsonSchemaTypeToTS(schema: any): string {
    switch (schema.type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return schema.items ? `Array<${this.jsonSchemaTypeToTS(schema.items)}>` : 'any[]';
      case 'object':
        return 'Record<string, any>';
      default:
        return 'any';
    }
  }

  private generateToolFunction(
    serverName: string,
    toolName: string,
    description: string,
    inputType: string
  ): string {
    return `import { callMCPTool } from '../../client.js';

export type ${this.toPascalCase(toolName)}Input = ${inputType};

export type ${this.toPascalCase(toolName)}Output = any;

/**
 * ${description}
 */
export async function ${this.toCamelCase(toolName)}(
  input: ${this.toPascalCase(toolName)}Input
): Promise<${this.toPascalCase(toolName)}Output> {
  return callMCPTool('${serverName}', '${toolName}', input);
}
`;
  }

  private generateIndexFile(toolFiles: string[]): string {
    const exports = toolFiles.map(file => {
      const name = file.replace('.ts', '');
      return `export * from './${name}.js';`;
    });

    return exports.join('\n') + '\n';
  }

  private async generateClientBridge(outputDir: string): Promise<void> {
    const clientCode = `/**
 * MCP 工具调用桥接
 * 在沙箱中，这个函数会通过 RPC 调用实际的 MCP server
 */

// 这个 Map 在运行时由外部注入
declare const __MCP_CLIENTS__: Map<string, any>;

export async function callMCPTool(
  serverName: string,
  toolName: string,
  input: any
): Promise<any> {
  const client = __MCP_CLIENTS__.get(serverName);
  if (!client) {
    throw new Error(\`MCP server not found: \${serverName}\`);
  }

  const response = await client.callTool({
    name: toolName,
    arguments: input,
  });

  if (response.isError) {
    throw new Error(\`Tool call failed: \${JSON.stringify(response.content)}\`);
  }

  // 提取文本内容
  const textContent = response.content
    .filter((item: any) => item.type === 'text')
    .map((item: any) => item.text)
    .join('\\n');

  // 尝试解析为 JSON
  try {
    return JSON.parse(textContent);
  } catch {
    return textContent;
  }
}
`;

    await fs.writeFile(
      path.join(outputDir, 'client.ts'),
      clientCode,
      'utf-8'
    );
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  private toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  async close() {
    for (const client of this.clients.values()) {
      await client.close();
    }
  }
}
