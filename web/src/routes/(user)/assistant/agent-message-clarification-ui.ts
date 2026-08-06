export type AgentClarificationReplyBlock = {
  kind: string;
  query: string;
};

export type AgentClarificationReplyChoice = {
  choiceRef: string;
  label: string;
};

export const buildAgentClarificationChoiceReply = (
  block: AgentClarificationReplyBlock,
  choice: AgentClarificationReplyChoice,
) => `Use ${choice.choiceRef} for ${block.kind} "${block.query}" (${choice.label}).`;

export const getAgentClarificationInitials = (label: string) => {
  const words = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  const initials = words.map((word) => word[0]?.toLocaleUpperCase()).join('');
  return initials || '?';
};
