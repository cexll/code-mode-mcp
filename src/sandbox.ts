import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { fork } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEBUG = process.env.SANDBOX_DEBUG === "true";

/**
 * 简化版代码执行器
 * 直接使用 Node.js 执行，避免复杂的沙箱配置
 */
export class Sandbox {
  private mcpClients: Map<string, Client>;
  private tempDir: string;

  constructor(mcpClients: Map<string, Client>) {
    this.mcpClients = mcpClients;
    // 使用每实例唯一的临时目录，避免并发测试/执行间相互干扰
    const uniq = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.tempDir = path.join(process.cwd(), ".sandbox-temp", uniq);
  }

  async initialize() {
    // 创建临时目录
    await fs.mkdir(this.tempDir, { recursive: true });
    // 在临时目录下创建指向 generated-api/servers 的符号链接，
    // 这样用户代码中的 `import "./servers/..."` 能够正确解析
    const serversLinkPath = path.join(this.tempDir, "servers");
    const serversTargetPath = path.resolve(
      __dirname,
      "../generated-api/servers",
    );

    try {
      // 仅当目标存在时才尝试创建链接
      await fs.stat(serversTargetPath);

      let needLink = true;
      try {
        const st = await fs.lstat(serversLinkPath);
        // 已存在则跳过（无论是目录还是符号链接）
        if (st.isSymbolicLink() || st.isDirectory()) {
          needLink = false;
        }
      } catch {
        // 不存在则继续创建
        needLink = true;
      }

      if (needLink) {
        const linkType = process.platform === "win32" ? "junction" : "dir";
        try {
          // 优先创建符号链接（Windows 使用 junction 提高兼容性）
          // @ts-expect-error Node 的类型定义允许此第三参数取 'dir' | 'junction'
          await fs.symlink(serversTargetPath, serversLinkPath, linkType);
        } catch (err: unknown) {
          const error = err as { code?: string };
          // 某些平台（或低权限环境）可能无法创建符号链接，降级为目录复制
          if (error?.code === "EEXIST") {
            // 并发情况下可能已被创建，忽略
          } else if (
            error?.code === "EPERM" ||
            error?.code === "EACCES" ||
            error?.code === "ENOSYS"
          ) {
            await fs.cp(serversTargetPath, serversLinkPath, {
              recursive: true,
            });
          } else {
            // 其他错误保留但不阻断初始化
            console.error(`⚠️ 创建 servers 链接失败: ${err?.message ?? err}`);
          }
        }
      }
    } catch {
      // generated-api/servers 不存在时跳过（可能在早期阶段尚未生成）
    }

    // 写入常驻运行器：接收相对 specifier（如 ./exec-xxxx.ts），相对于本文件解析
    const runnerPath = path.join(this.tempDir, "runner.mjs");
    const runnerCode =
      `// ESM runner: dynamically import target relative to this file\n` +
      `const spec = process.argv[2];\n` +
      `try {\n` +
      `  const u = new URL(spec, import.meta.url);\n` +
      `  await import(u.href);\n` +
      `  setImmediate(() => process.exit(0));\n` +
      `} catch (err) {\n` +
      `  console.error(err);\n` +
      `  setImmediate(() => process.exit(1));\n` +
      `}\n`;
    await fs.writeFile(runnerPath, runnerCode);

    if (DEBUG) console.error("✅ 沙箱环境已初始化");
  }

  /**
   * 执行 TypeScript 代码
   */
  async executeCode(code: string): Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }> {
    // 采用 时间戳 + 随机数，确保并发时文件名唯一
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const execFile = path.join(this.tempDir, `exec-${ts}-${rand}.ts`);

    // 在 finally 中统一清理，避免过早删除导致子进程导入失败
    try {
      // 写入用户代码
      await fs.writeFile(execFile, code);

      // 双重确认文件已落盘，降低竞态
      await fs.stat(execFile);
      const specifier = `./${path.basename(execFile)}`;
      // 执行并等待结束，不在此期间删除临时文件
      const result = await this.runWithTimeout(specifier, 10000);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error?.message ?? String(error),
      };
    } finally {
      // 在子进程完全退出且 Promise 解析后再清理
      await fs.unlink(execFile).catch(() => {});
    }
  }

  private runWithTimeout(
    specifier: string,
    timeout: number,
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    return new Promise((resolve) => {
      // 使用 fork 以确保 IPC 信道可用（child process 拥有 process.send）
      const runner = path.join(this.tempDir, "runner.mjs");
      const proc = fork(runner, [specifier], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
        },
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        // 通过 tsx 在 Node 20+ 使用 --import 方式加载 ESM/TS 支持
        execArgv: ["--import", "tsx/esm"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout!.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr!.on("data", (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          error: "Execution timeout (10s)",
        });
      }, timeout);

      // 处理来自子进程的 MCP 调用请求
      type IPCRequest = {
        type: "callMCPTool";
        id: string;
        serverName: string;
        toolName: string;
        arguments: any;
      };
      type IPCResponse =
        | { type: "result"; id: string; data: any }
        | { type: "error"; id: string; error: string };

      // 仅当存在 IPC 信道时监听消息
      (proc as any).on?.("message", async (msg: IPCRequest) => {
        if (!msg || msg.type !== "callMCPTool") return;
        const { id, serverName, toolName, arguments: args } = msg;
        try {
          // 调试日志：收到子进程的工具调用请求
          if (DEBUG)
            console.error(`🔗 [sandbox] recv call → ${serverName}.${toolName}`);
          const client = this.mcpClients.get(serverName);
          if (!client) {
            const resp: IPCResponse = {
              type: "error",
              id,
              error: `MCP server not connected: ${serverName}`,
            };
            (proc as any).send?.(resp);
            return;
          }

          const toolResult = await client.callTool({
            name: toolName,
            arguments: args,
          });
          if (DEBUG)
            console.error(`✅ [sandbox] tool ok → ${serverName}.${toolName}`);
          const resp: IPCResponse = { type: "result", id, data: toolResult };
          (proc as any).send?.(resp);
        } catch (e: any) {
          if (DEBUG)
            console.error(
              `❌ [sandbox] tool error → ${serverName}.${toolName}: ${e?.message ?? e}`,
            );
          const resp: IPCResponse = {
            type: "error",
            id,
            error: e?.message ?? String(e),
          };
          (proc as any).send?.(resp);
        }
      });

      // 使用 'exit' 事件以避免因 IPC 通道未及时关闭而悬挂
      proc.on("exit", (code) => {
        clearTimeout(timer);

        if (code === 0) {
          resolve({
            success: true,
            output: stdout || "Code executed successfully (no output)",
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exit code: ${code}`,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          error: err.message,
        });
      });
    });
  }

  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}
