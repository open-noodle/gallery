export type AgentMessageTextBlock = {
  type: 'text';
  text: string;
};

export type AgentMessageToolCallBlock = {
  type: 'tool-call';
  toolCallId: string;
  summary?: string;
};

export type AgentMessageAssetBlock = {
  type: 'asset';
  assetId: string;
  label?: string;
};

export type AgentMessagePlanBlock = {
  type: 'plan';
  planId: string;
  label?: string;
};

export type AgentMessageClarificationChoice = {
  choiceRef: string;
  label: string;
  description?: string;
  thumbnailAssetId?: string | null;
};

export type AgentMessageClarificationBlock = {
  type: 'clarification';
  kind: 'person' | 'tag' | 'album' | 'space' | 'cameraMake' | 'cameraModel' | 'lensModel';
  query: string;
  summary: string;
  textFallback: string;
  choices: AgentMessageClarificationChoice[];
};

export type AgentMessageBlock =
  | AgentMessageTextBlock
  | AgentMessageToolCallBlock
  | AgentMessageAssetBlock
  | AgentMessagePlanBlock
  | AgentMessageClarificationBlock;

export type AgentMessageContent = {
  blocks: AgentMessageBlock[];
};
