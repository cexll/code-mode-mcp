/**
 * 从内置工具生成 TypeScript API
 */
import { createBuiltinTools } from "../src/builtin-tools.js";
import * as fs from "fs/promises";
import * as path from "path";

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

async function generateAPI() {
  console.log("🚀 从内置工具生成 TypeScript API...\n");

  const builtinTools = createBuiltinTools();
  const outputDir = "./generated-api";

  // 确保输出目录存在
  await fs.mkdir(path.join(outputDir, "servers"), { recursive: true });

  // 生成 client.ts（IPC 桥接代码）
  const clientCode = `/**
 * MCP 工具调用桥接
 * 在沙箱子进程中，通过 IPC 向父进程请求调用 MCP server
 */

export async function callMCPTool(
  serverName: string,
  toolName: string,
  input: any
): Promise<any> {
  // 检查是否在子进程环境（有 IPC 通道）
  if (!process.send) {
    throw new Error('IPC channel not available: process.send is undefined');
  }

  // 生成唯一请求 ID
  const id = \`\${Date.now()}-\${Math.random().toString(36).slice(2, 11)}\`;

  return new Promise((resolve, reject) => {
    // 定义消息处理器
    const messageHandler = (msg: any) => {
      if (!msg || msg.id !== id) return;

      // 收到响应后移除监听器
      process.off('message', messageHandler);

      if (msg.type === 'result') {
        // 父进程返回的 data 是 MCP 工具调用的原始响应
        const response = msg.data;

        // 处理标准 MCP 响应格式
        if (response && typeof response === 'object' && 'content' in response) {
          if (response.isError) {
            reject(new Error(\`Tool call failed: \${JSON.stringify(response.content)}\`));
            return;
          }

          // 提取文本内容
          const textContent = response.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\\n');

          // 直接返回文本内容，不自动解析 JSON
          resolve(textContent);
        } else {
          // 非标准响应格式：序列化后返回（回退策略）
          resolve(JSON.stringify(response));
        }
      } else if (msg.type === 'error') {
        reject(new Error(msg.error));
      }
    };

    // 监听父进程的响应
    process.on('message', messageHandler);

    // 发送 IPC 请求到父进程
    process.send!({
      type: 'callMCPTool',
      id,
      serverName,
      toolName,
      arguments: input,
    });
  });
}
`;

  await fs.writeFile(path.join(outputDir, "client.ts"), clientCode, "utf-8");
  console.log("✅ 生成 client.ts");

  // 为每个服务器生成 API
  for (const [serverName, client] of builtinTools.entries()) {
    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools;

    console.log(`\n📝 生成 ${serverName} API (${tools.length} 个工具)`);

    const serverDir = path.join(outputDir, "servers", serverName);
    await fs.mkdir(serverDir, { recursive: true });

    const toolFiles: string[] = [];

    for (const tool of tools) {
      const toolName = tool.name;
      const fileName = `${toolName}.ts`;
      toolFiles.push(fileName);

      // 生成类型定义
      const inputTypeName = `${toPascalCase(toolName)}Input`;
      const outputTypeName = `${toPascalCase(toolName)}Output`;

      let inputType = "any";
      if (tool.inputSchema && tool.inputSchema.properties) {
        const props = Object.entries(tool.inputSchema.properties)
          .map(([key, value]: [string, any]) => {
            const optional = !tool.inputSchema.required?.includes(key);
            return `  /** ${value.description || ""} */\n  ${key}${optional ? "?" : ""}: ${value.type === "array" ? "any[]" : value.type || "any"};`;
          })
          .join("\n");

        inputType = `{\n${props}\n}`;
      }

      const toolCode = `import { callMCPTool } from '../../client.js';

export type ${inputTypeName} = ${inputType};

export type ${outputTypeName} = any;

/**
 * ${tool.description || toolName}
 */
export async function ${toCamelCase(toolName)}(
  input: ${inputTypeName}
): Promise<${outputTypeName}> {
  return callMCPTool('${serverName}', '${toolName}', input);
}
`;

      await fs.writeFile(path.join(serverDir, fileName), toolCode, "utf-8");
    }

    // 生成 index.ts
    const indexCode =
      toolFiles
        .map((file) => {
          const name = file.replace(".ts", "");
          return `export * from './${name}.js';`;
        })
        .join("\n") + "\n";

    await fs.writeFile(path.join(serverDir, "index.ts"), indexCode, "utf-8");
    console.log(`✅ 生成 ${serverName}/index.ts`);
  }

  console.log("\n✅ API 生成完成！");
  console.log("📁 输出目录: ./generated-api/servers/");
}

generateAPI().catch((error) => {
  console.error("❌ 生成失败:", error);
  process.exit(1);
});
