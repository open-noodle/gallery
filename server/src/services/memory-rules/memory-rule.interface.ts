import { DateTime } from 'luxon';

export interface MemoryRuleCandidate {
  ruleId: string;
  dedupeKey: string;
  title?: string;
  subtitle?: string;
  score: number;
  assetIds: string[];
  memoryAt: DateTime;
  context?: Record<string, unknown>;
  /**
   * How many days the memory stays visible, starting from its trigger day. Defaults to 1
   * (visible only on the trigger day) so existing rules are unaffected. Recap-style rules
   * set a larger window so they linger past the day they were generated.
   */
  visibleForDays?: number;
}

export interface MemoryRuleContext {
  ownerId: string;
  target: DateTime;
}

export interface MemoryRule {
  readonly id: string;
  evaluate(context: MemoryRuleContext): Promise<MemoryRuleCandidate[]>;
}
