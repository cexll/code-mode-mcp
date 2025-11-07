#!/bin/bash

set -e

echo "🚀 MCP Code Mode Demo - 快速开始"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未找到 npm"
    exit 1
fi

echo "✅ npm 版本: $(npm --version)"
echo ""

# 安装依赖
echo "📦 安装项目依赖..."
npm install

echo ""
echo "📦 安装 sandbox-runtime (全局)..."
npm install -g @anthropic-ai/sandbox-runtime

echo ""
echo "✅ 依赖安装完成!"
echo ""

# 复制配置示例
if [ ! -f ~/.srt-settings.json ]; then
    echo "📝 创建沙箱配置文件..."
    cp .srt-settings.example.json ~/.srt-settings.json
    echo "✅ 已创建 ~/.srt-settings.json"
else
    echo "ℹ️  ~/.srt-settings.json 已存在，跳过"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 安装完成！后续步骤:"
echo ""
echo "1️⃣  查看核心概念演示:"
echo "   npm run example"
echo ""
echo "2️⃣  生成 MCP TypeScript API:"
echo "   npm run generate-api"
echo ""
echo "3️⃣  运行交互式 Agent (需要 ANTHROPIC_API_KEY):"
echo "   export ANTHROPIC_API_KEY='your-key'"
echo "   tsx examples/chat.ts"
echo ""
echo "📚 查看 README.md 了解更多细节"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
