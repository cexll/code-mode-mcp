import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * Code Mode 沙箱执行器
 */
export class CodeModeSandbox {
  private mcpClients: Map<string, Client>;
  private sandboxConfig: SandboxRuntimeConfig;
  private isInitialized = false;

  constructor(
    mcpClients: Map<string, Client>,
    config?: Partial<SandboxRuntimeConfig>
  ) {
    this.mcpClients = mcpClients;

    // 默认沙箱配置
    this.sandboxConfig = {
      network: {
        allowedDomains: config?.network?.allowedDomains || [],
        deniedDomains: config?.network?.deniedDomains || [],
      },
      filesystem: {
        denyRead: config?.filesystem?.denyRead || ['~/.ssh', '~/.aws'],
        allowWrite: config?.filesystem?.allowWrite || ['.', '/tmp'],
        denyWrite: config?.filesystem?.denyWrite || ['.env', '.git'],
      },
    };
  }

  /**
   * 初始化沙箱环境
   */
  async initialize() {
    if (this.isInitialized) return;

    await SandboxManager.initialize(this.sandboxConfig);
    this.isInitialized = true;
    console.log('✅ 沙箱环境已初始化');
  }

  /**
   * 执行 TypeScript 代码
   */
  async executeCode(code: string): Promise<{
    success: boolean;
    output: string;
    error?: string;
  }> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // 创建临时文件
    const tempDir = await fs.mkdtemp('/tmp/code-mode-');
    const codeFile = path.join(tempDir, 'code.ts');

    try {
      // 注入 MCP clients 的访问代码
      const fullCode = this.injectMCPClients(code);
      await fs.writeFile(codeFile, fullCode, 'utf-8');

      // 包装命令使其在沙箱中执行
      const command = `tsx ${codeFile}`;
      const sandboxedCommand = await SandboxManager.wrapWithSandbox(command);

      // 执行
      const result = await this.runCommand(sandboxedCommand, tempDir);

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } finally {
      // 清理临时文件
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * 注入 MCP clients 访问机制
   */
  private injectMCPClients(userCode: string): string {
    // 创建一个 RPC 桥接
    // 实际实现中，这里需要建立进程间通信
    // 简化版本：通过环境变量传递 socket 路径

    return `
// MCP Clients 桥接
const __MCP_CLIENTS__ = new Map();

// 这里简化处理，实际需要通过 IPC/RPC 与主进程通信
// 在真实实现中，应该使用 Unix socket 或其他 IPC 机制
async function callMCPTool(serverName: string, toolName: string, input: any) {
  // 通过进程间通信调用主进程的 MCP client
  // 这里仅作示意
  console.log(\`[MCP Call] \${serverName}.\${toolName}(\${JSON.stringify(input)})\`);
  throw new Error('实际实现需要 IPC 支持');
}

// 导入生成的 API（需要在实际路径中）
${userCode}
`;
  }

  /**
   * 执行命令并捕获输出
   */
  private runCommand(command: string, cwd: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(command, {
        shell: true,
        cwd,
        stdio: 'pipe',
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
        });
      });
    });
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.isInitialized) {
      await SandboxManager.reset();
      this.isInitialized = false;
    }
  }
}
