#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AGENT_MCP_GENERATED_PROMPT_RELATIVE_PATH, AgentMcpPromptService } from 'src/services/agent-mcp-prompt.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const sync = async () => {
  const outputPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_PROMPT_RELATIVE_PATH);
  const moduleText = new AgentMcpPromptService(new AgentMcpToolContractService()).generateAgentRunnerModule();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, moduleText, 'utf8');
  console.log(`Wrote ${AGENT_MCP_GENERATED_PROMPT_RELATIVE_PATH}`);
};

sync().catch((error) => {
  console.error(error);
  process.exit(1);
});
