import { Command } from 'commander';

export const mcpCommand = new Command('mcp')
  .description('启动 stdio MCP Server（供 Claude Code 等 AI 客户端调用 CLI 能力）')
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  });
