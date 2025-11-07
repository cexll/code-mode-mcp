import { CodeModeAgent } from '../src/agent.js';
import * as readline from 'readline';

/**
 * Code Mode Agent 使用示例
 */
async function main() {
  // 从环境变量获取 API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ 请设置 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  const agent = new CodeModeAgent(apiKey, './generated-api');

  try {
    console.log('🚀 初始化 Code Mode Agent...\n');

    // 连接 MCP servers（需要与生成 API 时使用的相同）
    await agent.connectMCPServer(
      'filesystem',
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]
    );

    await agent.connectMCPServer(
      'fetch',
      'npx',
      ['-y', '@modelcontextprotocol/server-fetch']
    );

    console.log('✅ Agent 初始化完成\n');
    console.log('💡 尝试以下示例:');
    console.log('  - "列出当前目录的所有 TypeScript 文件"');
    console.log('  - "读取 package.json 并告诉我项目名称"');
    console.log('  - "获取 https://api.github.com/users/github 并解析"');
    console.log('');

    // 交互式聊天
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const chat = async () => {
      rl.question('You: ', async (input) => {
        if (!input.trim()) {
          rl.close();
          return;
        }

        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          rl.close();
          return;
        }

        try {
          console.log('\n🤖 Agent 正在思考和执行...\n');
          const response = await agent.chat(input);
          console.log('Assistant:', response);
          console.log('');
        } catch (error) {
          console.error('❌ 错误:', error);
        }

        chat();
      });
    };

    chat();

    rl.on('close', async () => {
      console.log('\n👋 再见!');
      await agent.cleanup();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ 错误:', error);
    await agent.cleanup();
    process.exit(1);
  }
}

main();
