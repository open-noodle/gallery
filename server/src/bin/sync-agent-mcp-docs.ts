#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AGENT_MCP_GENERATED_DOC_RELATIVE_PATH, AgentMcpDocsService } from 'src/services/agent-mcp-docs.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const sync = async () => {
  const outputPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_DOC_RELATIVE_PATH);
  const docs = new AgentMcpDocsService(new AgentMcpToolContractService()).generateMarkdown();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, docs, 'utf8');
  console.log(`Wrote ${AGENT_MCP_GENERATED_DOC_RELATIVE_PATH}`);
};

sync().catch((error) => {
  console.error(error);
  process.exit(1);
});
