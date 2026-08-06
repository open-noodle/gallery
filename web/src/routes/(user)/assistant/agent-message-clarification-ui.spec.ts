import { buildAgentClarificationChoiceReply, getAgentClarificationInitials } from './agent-message-clarification-ui';

describe('agent-message-clarification-ui', () => {
  it('builds a safe follow-up reply that carries the choice ref, query, kind, and label', () => {
    expect(
      buildAgentClarificationChoiceReply(
        { kind: 'person', query: 'Pierre' },
        { choiceRef: 'choice:person:abcDEF1234567890', label: 'Pierre M.' },
      ),
    ).toBe('Use choice:person:abcDEF1234567890 for person "Pierre" (Pierre M.).');
  });

  it('builds initials fallback without leaking the choice token', () => {
    expect(getAgentClarificationInitials('Pierre M.')).toBe('PM');
    expect(getAgentClarificationInitials('choice:person:abcDEF1234567890')).toBe('C');
  });
});
