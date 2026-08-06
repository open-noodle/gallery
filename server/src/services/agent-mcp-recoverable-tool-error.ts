import { BadRequestException } from '@nestjs/common';
import { AgentToolName } from 'src/enum';
import { AgentIdDomain } from 'src/types/agent-asset-source.types';
import { AgentMcpJsonObject, AgentMcpRecoverableToolErrorContent } from 'src/types/agent-mcp.types';

export class AgentMcpRecoverableToolError extends BadRequestException {
  constructor(public readonly content: AgentMcpRecoverableToolErrorContent & { recovery: AgentMcpJsonObject }) {
    super(content.error);
  }
}

export const isAgentMcpRecoverableToolError = (error: unknown): error is AgentMcpRecoverableToolError =>
  error instanceof AgentMcpRecoverableToolError;

export const invalidSelectionHandleError = (input: {
  toolName: AgentToolName;
  error: string;
  hint: string;
  recovery: AgentMcpJsonObject;
}) =>
  new AgentMcpRecoverableToolError({
    status: 'error',
    error: input.error,
    toolName: input.toolName,
    retryable: true,
    hint: input.hint,
    recovery: input.recovery,
  });

export const invalidSourceRefError = (input: {
  toolName: AgentToolName;
  error: string;
  hint: string;
  recovery: AgentMcpJsonObject;
}) =>
  new AgentMcpRecoverableToolError({
    status: 'error',
    error: input.error,
    toolName: input.toolName,
    retryable: true,
    hint: input.hint,
    recovery: input.recovery,
  });

export const selectionTooLargeError = (input: {
  toolName: AgentToolName;
  sourceAssetCount: number;
  maxSourceAssetCount: number;
  instruction: string;
}) =>
  new AgentMcpRecoverableToolError({
    status: 'error',
    error: 'Selection is too large for metadata-only curation',
    toolName: input.toolName,
    retryable: true,
    hint: input.instruction,
    recovery: {
      kind: 'selection-too-large',
      sourceAssetCount: input.sourceAssetCount,
      maxSourceAssetCount: input.maxSourceAssetCount,
      instruction: input.instruction,
    },
  });

const agentIdDomainLabel = (domain: AgentIdDomain) => {
  switch (domain) {
    case 'selectionHandle': {
      return 'selection handle';
    }
    case 'sourceRef': {
      return 'source reference';
    }
    default: {
      return domain;
    }
  }
};

const articleFor = (label: string) => (/^[aeiou]/i.test(label) ? 'an' : 'a');

export const wrongIdDomainError = (input: {
  toolName: AgentToolName;
  field: string;
  expectedDomain: AgentIdDomain;
  receivedDomain: AgentIdDomain;
  instruction: string;
}) => {
  const receivedLabel = agentIdDomainLabel(input.receivedDomain);
  const expectedLabel = agentIdDomainLabel(input.expectedDomain);

  return new AgentMcpRecoverableToolError({
    status: 'error',
    error: `That value is ${articleFor(receivedLabel)} ${receivedLabel} ID, not ${articleFor(expectedLabel)} ${expectedLabel} ID.`,
    toolName: input.toolName,
    retryable: true,
    hint: input.instruction,
    recovery: {
      kind: 'wrong_id_domain',
      field: input.field,
      expectedDomain: input.expectedDomain,
      receivedDomain: input.receivedDomain,
      instruction: input.instruction,
    },
  });
};
