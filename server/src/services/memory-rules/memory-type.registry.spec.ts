import { MEMORY_TYPE_KEYS, MEMORY_TYPE_METADATA } from 'src/services/memory-rules/memory-type.metadata';
import { createMemoryRules, MemoryRuleDeps } from 'src/services/memory-rules/memory-type.registry';

const deps = {} as MemoryRuleDeps;
const ruleKeys = MEMORY_TYPE_METADATA.filter((m) => m.kind === 'rule').map((m) => m.key);

describe('createMemoryRules', () => {
  it('instantiates a single rule by key', () => {
    const rules = createMemoryRules(['birthday'], deps);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('birthday');
  });

  it('instantiates multiple rules in registry order', () => {
    const rules = createMemoryRules(['birthday', 'recent_trip'], deps);
    expect(rules.map((r) => r.id)).toEqual(['birthday', 'recent_trip']);
  });

  it('returns nothing for a non-rule key', () => {
    expect(createMemoryRules(['on_this_day'], deps)).toEqual([]);
  });

  it('returns nothing for an empty key set', () => {
    expect(createMemoryRules([], deps)).toEqual([]);
  });

  it('builds a rule whose id matches its metadata key (parity, every rule-kind entry)', () => {
    for (const key of ruleKeys) {
      const rules = createMemoryRules([key], deps);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe(key);
    }
  });

  it('has a factory for every rule-kind metadata entry and no extras (completeness guard)', () => {
    const rules = createMemoryRules(MEMORY_TYPE_KEYS, deps);
    expect(rules).toHaveLength(ruleKeys.length);
    expect(rules.map((r) => r.id).toSorted()).toEqual(ruleKeys.toSorted());
  });

  it('dedupes duplicate keys', () => {
    expect(createMemoryRules(['birthday', 'birthday'], deps)).toHaveLength(1);
  });
});
