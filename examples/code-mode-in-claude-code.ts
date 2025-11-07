#!/usr/bin/env tsx
/**
 * Code Mode 示例：在 Claude Code 中直接实现
 *
 * 架构对比：
 *
 * ❌ 原方案：
 *    用户请求 → 独立 CodeModeAgent（需要 API key）→ 生成代码 → 沙箱执行
 *
 * ✅ 新方案：
 *    用户请求 → Claude Code（已登录）→ 直接写代码 → 本地执行
 *
 * 优势：
 * - 无需 ANTHROPIC_API_KEY
 * - 复用 Claude Code 的凭证和能力
 * - 更简单、更直接
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function demonstrateCodeMode() {
  console.log('🎯 Code Mode 核心思想演示\n');

  console.log('场景：读取项目的 package.json 并解析');
  console.log('传统方式：需要 LLM 多轮调用工具');
  console.log('Code Mode：直接写代码一次性完成\n');

  // 连接 filesystem MCP server
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  });

  const client = new Client(
    { name: 'code-mode-demo', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ 已连接 filesystem MCP\n');

  // Code Mode 方式：用代码组合工具调用
  console.log('📝 执行代码:\n');
  const code = `
// 1. 读取 package.json
const pkgResult = await client.callTool({
  name: 'read_file',
  arguments: { path: 'package.json' }
});

// 2. 解析并提取信息
const pkg = JSON.parse(pkgResult.content[0].text);

// 3. 汇总输出
console.log('项目名称:', pkg.name);
console.log('版本:', pkg.version);
console.log('依赖数量:', Object.keys(pkg.dependencies || {}).length);
`;

  console.log(code);
  console.log('\n🔧 执行结果:\n');

  // 实际执行
  const pkgResult = await client.callTool({
    name: 'read_file',
    arguments: { path: 'package.json' },
  });

  const pkg = JSON.parse(
    Array.isArray(pkgResult.content)
      ? pkgResult.content[0].text
      : pkgResult.content
  );

  console.log('项目名称:', pkg.name);
  console.log('版本:', pkg.version);
  console.log('依赖数量:', Object.keys(pkg.dependencies || {}).length);

  await client.close();

  console.log('\n💡 关键点:');
  console.log('- 这段代码在 Claude Code 中运行');
  console.log('- 无需额外的 ANTHROPIC_API_KEY');
  console.log('- 直接调用 MCP 工具，无需 Agent 中转');
  console.log('- 复杂逻辑用代码表达更清晰');
}

demonstrateCodeMode().catch(console.error);
