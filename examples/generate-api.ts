import { MCPToTypeScriptGenerator } from '../src/generator.js';

/**
 * 生成 MCP 工具的 TypeScript API
 */
async function main() {
  const generator = new MCPToTypeScriptGenerator();

  try {
    console.log('🚀 开始生成 MCP TypeScript API...\n');

    // 连接你的 MCP servers
    // 示例 1: Filesystem MCP Server
    await generator.connectServer(
      'filesystem',
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]
    );

    // 示例 2: Fetch MCP Server
    await generator.connectServer(
      'fetch',
      'uvx',
      [
        '--from',
        'git+https://github.com/cexll/mcp-server-fetch.git',
        'mcp-server-fetch',
      ]
    );

    // 你可以添加更多 MCP servers
    // await generator.connectServer('your-server', 'command', ['args']);

    // 生成 TypeScript API
    await generator.generateTypeScriptAPI('./generated-api');

    console.log('\n✅ API 生成完成！');
    console.log('📁 查看生成的文件: ./generated-api/servers/');
  } catch (error) {
    console.error('❌ 生成失败:', error);
    process.exit(1);
  } finally {
    await generator.close();
  }
}

main();
