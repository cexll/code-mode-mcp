/**
 * 简化版 Code Mode 示例
 * 展示核心概念，不需要完整的沙箱实现
 */

import { MCPToTypeScriptGenerator } from '../src/generator.js';
import Anthropic from '@anthropic-ai/sdk';

async function main() {
  console.log('📚 Code Mode 核心概念演示\n');
  console.log('传统 MCP 模式 vs Code Mode 对比:\n');

  console.log('❌ 传统模式:');
  console.log('   LLM 直接调用工具 → 每次调用都过一遍模型\n');

  console.log('✅ Code Mode:');
  console.log('   LLM 写代码 → 沙箱执行 → 只返回最终结果\n');

  // 示例 1: 生成 API
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('步骤 1: 将 MCP 工具转换为 TypeScript API\n');

  const generator = new MCPToTypeScriptGenerator();

  await generator.connectServer(
    'fetch',
    'npx',
    ['-y', '@modelcontextprotocol/server-fetch']
  );

  await generator.generateTypeScriptAPI('./generated-api');
  await generator.close();

  console.log('\n生成的 API 示例:');
  console.log(`
// generated-api/servers/fetch/fetch.ts
import { callMCPTool } from '../../client.js';

export type FetchInput = {
  url: string;
  method?: string;
};

export async function fetch(input: FetchInput): Promise<any> {
  return callMCPTool('fetch', 'fetch', input);
}
  `);

  // 示例 2: LLM 使用代码
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('步骤 2: LLM 写代码调用这些 API\n');

  console.log('用户请求: "获取 GitHub API 并解析用户信息"\n');
  console.log('LLM 生成的代码:');
  console.log(`
import * as fetch from './servers/fetch/index.js';

const response = await fetch.fetch({
  url: 'https://api.github.com/users/github'
});

const data = JSON.parse(response);
console.log(\`用户名: \${data.login}\`);
console.log(\`关注者: \${data.followers}\`);
  `);

  // 示例 3: 对比 token 消耗
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('步骤 3: Token 消耗对比\n');

  console.log('传统模式:');
  console.log('  工具定义: ~150,000 tokens (所有工具)');
  console.log('  中间结果: 每次调用都经过模型');
  console.log('  总计: ~200,000 tokens\n');

  console.log('Code Mode:');
  console.log('  工具定义: ~2,000 tokens (按需加载)');
  console.log('  中间结果: 在沙箱内处理');
  console.log('  总计: ~5,000 tokens\n');

  console.log('💰 节省: 97.5% tokens!\n');

  // 示例 4: 优势总结
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Code Mode 的核心优势:\n');

  console.log('1️⃣  按需加载工具定义');
  console.log('   - 文件树结构，LLM 只读需要的工具');
  console.log('   - 150K → 2K tokens\n');

  console.log('2️⃣  中间数据不过模型');
  console.log('   - 数据在沙箱内流动');
  console.log('   - 支持大文件/复杂数据结构\n');

  console.log('3️⃣  复杂控制流');
  console.log('   - for 循环、if 判断、错误处理');
  console.log('   - 不需要多轮对话\n');

  console.log('4️⃣  安全隔离');
  console.log('   - sandbox-runtime: 文件系统 + 网络隔离');
  console.log('   - API key 不暴露给 LLM\n');

  console.log('5️⃣  状态持久化');
  console.log('   - 可以保存中间结果到文件');
  console.log('   - 可以保存代码为 Skills 复用\n');

  console.log('✅ 演示完成!');
}

main().catch(console.error);
