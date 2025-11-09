/**
 * 内置 MCP 工具实现
 *
 * 解决 stdio 冲突问题：
 * 当 code-mode 作为 MCP server 运行时，其 stdio 已被父进程占用，
 * 无法再通过 stdio 连接其他 MCP servers。
 *
 * 此模块提供内置实现，直接在进程内执行，避免 stdio 冲突。
 */

import * as fs from "fs/promises";
import * as path from "path";
import { stat } from "fs/promises";

const DEBUG = process.env.SANDBOX_DEBUG === "true";

/**
 * 模拟 MCP Client 接口
 */
export interface BuiltinMCPClient {
  callTool(params: { name: string; arguments: any }): Promise<any>;
  listTools(): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: any }>;
  }>;
}

/**
 * Filesystem 工具实现
 */
export class FilesystemTools implements BuiltinMCPClient {
  private allowedPaths: string[];

  constructor(allowedPaths: string[] = [process.cwd()]) {
    this.allowedPaths = allowedPaths;
  }

  async listTools() {
    return {
      tools: [
        {
          name: "read_file",
          description: "Read complete contents of a file",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to file" },
            },
            required: ["path"],
          },
        },
        {
          name: "read_multiple_files",
          description: "Read multiple files simultaneously",
          inputSchema: {
            type: "object",
            properties: {
              paths: { type: "array", items: { type: "string" } },
            },
            required: ["paths"],
          },
        },
        {
          name: "write_file",
          description: "Create new file or overwrite existing",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
        {
          name: "edit_file",
          description: "Edit file with diff-based changes",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              edits: { type: "array" },
              dryRun: { type: "boolean" },
            },
            required: ["path", "edits"],
          },
        },
        {
          name: "create_directory",
          description: "Create new directory or ensure it exists",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
        {
          name: "list_directory",
          description: "List directory contents",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
        {
          name: "move_file",
          description: "Move or rename files and directories",
          inputSchema: {
            type: "object",
            properties: {
              source: { type: "string" },
              destination: { type: "string" },
            },
            required: ["source", "destination"],
          },
        },
        {
          name: "search_files",
          description: "Search for files matching pattern",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              pattern: { type: "string" },
            },
            required: ["path", "pattern"],
          },
        },
        {
          name: "get_file_info",
          description: "Get metadata about file or directory",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
        {
          name: "list_allowed_directories",
          description: "List directories available to access",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
  }

  async callTool(params: { name: string; arguments: any }): Promise<any> {
    const { name, arguments: args } = params;

    try {
      switch (name) {
        case "read_file":
          return await this.readFile(args.path);

        case "read_multiple_files":
          return await this.readMultipleFiles(args.paths);

        case "write_file":
          return await this.writeFile(args.path, args.content);

        case "create_directory":
          return await this.createDirectory(args.path);

        case "list_directory":
          return await this.listDirectory(args.path);

        case "move_file":
          return await this.moveFile(args.source, args.destination);

        case "search_files":
          return await this.searchFiles(args.path, args.pattern);

        case "get_file_info":
          return await this.getFileInfo(args.path);

        case "list_allowed_directories":
          return await this.listAllowedDirectories();

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      if (DEBUG)
        console.error(`[builtin-filesystem] ${name} error:`, error.message);
      throw error;
    }
  }

  private async readFile(filePath: string) {
    const content = await fs.readFile(filePath, "utf-8");
    return {
      content: [{ type: "text", text: content }],
    };
  }

  private async readMultipleFiles(paths: string[]) {
    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          const content = await fs.readFile(path, "utf-8");
          return { path, content };
        } catch (error: any) {
          return { path, error: error.message };
        }
      }),
    );

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  private async writeFile(filePath: string, content: string) {
    // 确保父目录存在
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });

    await fs.writeFile(filePath, content, "utf-8");
    return {
      content: [{ type: "text", text: `Successfully wrote to ${filePath}` }],
    };
  }

  private async createDirectory(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
    return {
      content: [
        { type: "text", text: `Successfully created directory ${dirPath}` },
      ],
    };
  }

  private async listDirectory(dirPath: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
    };
  }

  private async moveFile(source: string, destination: string) {
    await fs.rename(source, destination);
    return {
      content: [
        {
          type: "text",
          text: `Successfully moved ${source} to ${destination}`,
        },
      ],
    };
  }

  private async searchFiles(basePath: string, pattern: string) {
    const results: string[] = [];
    const regex = new RegExp(pattern);

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (regex.test(entry.name)) {
          results.push(fullPath);
        }
      }
    }

    await walk(basePath);

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  private async getFileInfo(filePath: string) {
    const stats = await stat(filePath);
    const info = {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  }

  private async listAllowedDirectories() {
    return {
      content: [
        { type: "text", text: JSON.stringify(this.allowedPaths, null, 2) },
      ],
    };
  }
}

/**
 * Fetch 工具实现
 */
export class FetchTools implements BuiltinMCPClient {
  async listTools() {
    return {
      tools: [
        {
          name: "fetch",
          description: "Fetch URL and extract contents as markdown",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to fetch" },
              max_length: {
                type: "number",
                description: "Maximum characters to return",
              },
              start_index: {
                type: "number",
                description: "Starting character index",
              },
              raw: {
                type: "boolean",
                description: "Return raw HTML without simplification",
              },
            },
            required: ["url"],
          },
        },
      ],
    };
  }

  async callTool(params: { name: string; arguments: any }): Promise<any> {
    if (params.name === "fetch") {
      return await this.fetch(params.arguments);
    }
    throw new Error(`Unknown tool: ${params.name}`);
  }

  private async fetch(args: {
    url: string;
    max_length?: number;
    start_index?: number;
    raw?: boolean;
  }) {
    try {
      // 使用 Node.js 内置 https/http 模块
      const https = await import("https");
      const http = await import("http");
      const { URL } = await import("url");

      const parsedUrl = new URL(args.url);
      const isHttps = parsedUrl.protocol === "https:";
      const client = isHttps ? https.default : http.default;

      // 检查是否有代理环境变量（由 srt 设置）
      const proxyUrl =
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY ||
        process.env.ALL_PROXY;
      let agent = undefined;

      if (proxyUrl && isHttps) {
        // 动态导入 https-proxy-agent 以支持 srt 沙箱网络访问
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(proxyUrl);
        if (DEBUG) console.error(`[builtin-fetch] using proxy: ${proxyUrl}`);
      }

      return new Promise((resolve, reject) => {
        const options: any = agent ? { agent } : {};
        const req = client.get(args.url, options, (res) => {
          const chunks: Buffer[] = [];

          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          res.on("end", () => {
            try {
              let text = Buffer.concat(chunks).toString("utf-8");

              // 应用偏移和长度限制
              const startIndex = args.start_index || 0;
              const maxLength = args.max_length || 50000;

              if (startIndex > 0) {
                text = text.substring(startIndex);
              }

              if (text.length > maxLength) {
                text = text.substring(0, maxLength);
              }

              // 如果不是 raw 模式，简单清理 HTML
              const contentType = res.headers["content-type"];
              if (!args.raw && contentType?.includes("text/html")) {
                // 基础 HTML → Markdown 转换
                text = text
                  .replace(
                    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
                    "",
                  )
                  .replace(
                    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
                    "",
                  )
                  .replace(/<[^>]+>/g, "")
                  .replace(/\n\s*\n\s*\n/g, "\n\n")
                  .trim();
              }

              resolve({
                content: [{ type: "text", text }],
              });
            } catch (error: any) {
              reject(error);
            }
          });
        });

        req.on("error", (error: Error) => {
          reject(error);
        });

        req.setTimeout(8000, () => {
          req.destroy();
          reject(new Error("Request timeout (8s)"));
        });
      });
    } catch (error: any) {
      if (DEBUG) console.error("[builtin-fetch] error:", error.message);
      throw new Error(`Fetch failed: ${error.message}`);
    }
  }
}

/**
 * 创建内置工具集合
 */
export function createBuiltinTools(): Map<string, BuiltinMCPClient> {
  const tools = new Map<string, BuiltinMCPClient>();

  tools.set("filesystem", new FilesystemTools([process.cwd()]));
  tools.set("fetch", new FetchTools());

  if (DEBUG) {
    console.error("✅ 内置工具已初始化: filesystem, fetch");
  }

  return tools;
}
