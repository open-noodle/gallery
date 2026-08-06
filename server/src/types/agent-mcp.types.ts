import type { AgentToolName } from 'src/enum';

export type AgentMcpRequestId = string | number;

export type AgentMcpJsonObject = Record<string, unknown>;

export type AgentMcpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type AgentMcpToolDefinition = {
  name: AgentToolName;
  title: string;
  description: string;
  inputSchema: AgentMcpJsonObject;
  annotations: AgentMcpToolAnnotations;
};

export type AgentMcpToolsListResult = {
  tools: AgentMcpToolDefinition[];
};

export type AgentMcpToolTextContent = {
  type: 'text';
  text: string;
};

export type AgentMcpToolCallResult = {
  content: AgentMcpToolTextContent[];
  structuredContent: unknown;
  isError?: boolean;
};

export type AgentMcpToolValidationIssue = {
  path: string;
  message: string;
  hint?: string;
};

export type AgentMcpToolValidationErrorContent = {
  status: 'error';
  error: 'Invalid tool arguments';
  toolName: AgentToolName;
  retryable: true;
  issues: AgentMcpToolValidationIssue[];
  expected?: string;
  hint?: string;
  exampleArguments?: AgentMcpJsonObject;
};

export type AgentMcpRecoverableToolErrorContent = {
  status: 'error';
  error: string;
  toolName: AgentToolName;
  retryable: true;
  hint: string;
  recovery: AgentMcpJsonObject;
};

export type AgentMcpError = {
  code: number;
  message: string;
  data?: unknown;
};

export type AgentMcpSuccessResponse = {
  jsonrpc: '2.0';
  id: AgentMcpRequestId;
  result: unknown;
};

export type AgentMcpErrorResponse = {
  jsonrpc: '2.0';
  id: AgentMcpRequestId | null;
  error: AgentMcpError;
};

export type AgentMcpHandleResponse = AgentMcpSuccessResponse | AgentMcpErrorResponse | undefined;

export type AgentMcpInitializeResult = {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    tools: Record<string, never>;
  };
};
