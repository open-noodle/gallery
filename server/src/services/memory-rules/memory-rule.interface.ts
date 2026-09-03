import { DateTime } from 'luxon';

export interface MemoryRuleCandidate {
  ruleId: string;
  dedupeKey: string;
  /**
   * Finished prose, for a rule that has some fixed, language-free label to show. Leave unset:
   * a memory is generated once and then read for days by clients in whatever language each
   * viewer picked, so English written here is stuck (#1006, #1045). Every current rule leaves
   * both unset and lets the clients build the card text from `context` instead.
   */
  title?: string;
  subtitle?: string;
  score: number;
  assetIds: string[];
  memoryAt: DateTime;
  /**
   * Structured facts the clients build the card's title and subtitle from, in the viewer's
   * language. Put every part of the card text here, then add the message to `i18n/en.json` and
   * the builders in `web/src/lib/utils/memory-card.ts` and
   * `mobile/lib/utils/memory_card_text.dart`.
   */
  context?: Record<string, unknown>;
  /**
   * How many days the memory stays visible, starting from its trigger day. Defaults to 1
   * (visible only on the trigger day) so existing rules are unaffected. Recap-style rules
   * set a larger window so they linger past the day they were generated.
   */
  visibleForDays?: number;
  /**
   * Years whose plain `on_this_day` ("N years ago") memory this card stands in for, on the
   * same trigger day: the two would hold substantially the same photos, so only one should
   * reach the memory lane. Once the candidate is persisted, the service removes each of those
   * years' `on_this_day` memories for the day (never a saved one).
   *
   * A rule must only list a year when its card genuinely stands in for that year's whole day
   * — it silently drops whatever the card left behind.
   */
  supersedesOnThisDayYears?: number[];
}

export interface MemoryRuleContext {
  ownerId: string;
  target: DateTime;
}

export interface MemoryRule {
  readonly id: string;
  evaluate(context: MemoryRuleContext): Promise<MemoryRuleCandidate[]>;
}
