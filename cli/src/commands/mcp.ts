import { startMcpServer } from "../mcp/server.js";

export async function mcpCommand(): Promise<void> {
  try {
    await startMcpServer();
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
