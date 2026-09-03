import { planReservation, ReservableMemory } from 'src/services/memory-rules/reservation.util';

const memory = (overrides: Partial<ReservableMemory> & { id: string }): ReservableMemory => ({
  assetIds: [],
  priority: 1000,
  floor: 1,
  managed: true,
  ...overrides,
});

describe('planReservation', () => {
  it('P1: returns an empty plan for no memories', () => {
    expect(planReservation([])).toEqual({ strip: [], remove: [] });
  });

  it('P2: leaves a lone memory at or above its floor alone', () => {
    const plan = planReservation([memory({ id: 'a', assetIds: ['1', '2', '3'], floor: 3 })]);
    expect(plan).toEqual({ strip: [], remove: [] });
  });

  it('P3: removes a lone memory below its floor even with nothing overlapping', () => {
    const plan = planReservation([memory({ id: 'a', assetIds: ['1', '2'], floor: 3 })]);
    expect(plan.remove).toEqual(['a']);
    expect(plan.strip).toEqual([]);
  });

  it('P4: does not strip memories with disjoint assets', () => {
    const plan = planReservation([
      memory({ id: 'a', assetIds: ['1', '2'], priority: 200, floor: 1 }),
      memory({ id: 'b', assetIds: ['3', '4'], priority: 100, floor: 1 }),
    ]);
    expect(plan).toEqual({ strip: [], remove: [] });
  });

  it('P5: strips only the shared ids from the lower-priority memory', () => {
    const plan = planReservation([
      memory({ id: 'high', assetIds: ['1', '2'], priority: 200, floor: 1 }),
      memory({ id: 'low', assetIds: ['2', '3', '4'], priority: 100, floor: 1 }),
    ]);
    expect(plan.strip).toEqual([{ memoryId: 'low', assetIds: ['2'] }]);
    expect(plan.remove).toEqual([]);
  });

  it('P6: removes a loser that falls below its floor, and it claims nothing', () => {
    const plan = planReservation([
      memory({ id: 'high', assetIds: ['1', '2'], priority: 200, floor: 1 }),
      memory({ id: 'low', assetIds: ['1', '2'], priority: 100, floor: 2 }),
    ]);
    expect(plan.remove).toEqual(['low']);
    expect(plan.strip).toEqual([]);
  });

  it('P7: a removed memory releases its assets to the next in line', () => {
    const plan = planReservation([
      memory({ id: 'a', assetIds: ['1'], priority: 300, floor: 1 }),
      memory({ id: 'b', assetIds: ['1', '2'], priority: 200, floor: 2 }),
      memory({ id: 'c', assetIds: ['2', '3'], priority: 100, floor: 2 }),
    ]);
    // b drops below its floor (only '2' left) and claims nothing, so c keeps both.
    expect(plan.remove).toEqual(['b']);
    expect(plan.strip).toEqual([]);
  });

  it('P8: never removes an unmanaged memory below its floor', () => {
    const plan = planReservation([memory({ id: 'a', assetIds: ['1'], floor: 5, managed: false })]);
    expect(plan).toEqual({ strip: [], remove: [] });
  });

  it('P9: an unmanaged memory claims first and the managed one is stripped', () => {
    const plan = planReservation([
      memory({ id: 'managed', assetIds: ['1', '2', '3'], priority: 1_000_300, floor: 1 }),
      memory({ id: 'pinned', assetIds: ['1'], priority: 2_000_000, floor: 1, managed: false }),
    ]);
    expect(plan.strip).toEqual([{ memoryId: 'managed', assetIds: ['1'] }]);
    expect(plan.remove).toEqual([]);
  });

  it('P10: leaves duplicates between two unmanaged memories in place', () => {
    const plan = planReservation([
      memory({ id: 'a', assetIds: ['1', '2'], priority: 2_000_000, managed: false }),
      memory({ id: 'b', assetIds: ['1', '2'], priority: 2_000_000, managed: false }),
    ]);
    expect(plan).toEqual({ strip: [], remove: [] });
  });

  it('P11: breaks priority ties on id ascending', () => {
    const plan = planReservation([
      memory({ id: 'zzz', assetIds: ['1', '3'], priority: 100, floor: 1 }),
      memory({ id: 'aaa', assetIds: ['1', '2'], priority: 100, floor: 1 }),
    ]);
    // 'aaa' sorts first on id and claims '1'; 'zzz' keeps '3' and loses the shared one.
    // NOTE: the sets must only PARTIALLY overlap. If 'zzz' were left with nothing it would fall
    // under its floor and be removed, which tests removal rather than the tie-break.
    expect(plan.remove).toEqual([]);
    expect(plan.strip).toEqual([{ memoryId: 'zzz', assetIds: ['1'] }]);
  });

  it('P12/P13: a lower priority always yields, whatever the caller encoded', () => {
    const plan = planReservation([
      memory({ id: 'rule-no-score', assetIds: ['1'], priority: 1_000_000, floor: 1 }),
      memory({ id: 'on-this-day', assetIds: ['1', '2'], priority: 0, floor: 1 }),
    ]);
    expect(plan.strip).toEqual([{ memoryId: 'on-this-day', assetIds: ['1'] }]);
  });

  it('P14: removes a memory that already holds no assets', () => {
    const plan = planReservation([memory({ id: 'a', assetIds: [], floor: 1 })]);
    expect(plan.remove).toEqual(['a']);
  });

  it('P15: de-duplicates ids within one memory before applying the floor', () => {
    const plan = planReservation([memory({ id: 'a', assetIds: ['1', '1', '1'], floor: 2 })]);
    expect(plan.remove).toEqual(['a']);
  });

  it('P16: never removes a memory whose floor is 0', () => {
    const plan = planReservation([memory({ id: 'a', assetIds: [], floor: 0 })]);
    expect(plan).toEqual({ strip: [], remove: [] });
  });

  it('P17: can remove every memory', () => {
    const plan = planReservation([
      memory({ id: 'a', assetIds: [], floor: 1 }),
      memory({ id: 'b', assetIds: [], floor: 1 }),
    ]);
    expect(plan.remove.toSorted()).toEqual(['a', 'b']);
    expect(plan.strip).toEqual([]);
  });

  it('P18: keeps a memory left with exactly its floor', () => {
    const plan = planReservation([
      memory({ id: 'high', assetIds: ['1'], priority: 200, floor: 1 }),
      memory({ id: 'low', assetIds: ['1', '2', '3'], priority: 100, floor: 2 }),
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.strip).toEqual([{ memoryId: 'low', assetIds: ['1'] }]);
  });

  it('P19: an unmanaged on_this_day still claims ahead of a rule memory', () => {
    const plan = planReservation([
      memory({ id: 'rule', assetIds: ['1', '2'], priority: 1_000_330, floor: 1 }),
      memory({ id: 'saved-otd', assetIds: ['1'], priority: 2_000_000, floor: 3, managed: false }),
    ]);
    expect(plan.strip).toEqual([{ memoryId: 'rule', assetIds: ['1'] }]);
    expect(plan.remove).toEqual([]);
  });

  it('P20: managed-ness never re-sorts; only priority then id decide order', () => {
    const plan = planReservation([
      memory({ id: 'b-unmanaged', assetIds: ['1'], priority: 100, floor: 1, managed: false }),
      memory({ id: 'a-managed', assetIds: ['1'], priority: 100, floor: 1 }),
    ]);
    // 'a-managed' sorts first on id and claims '1'; the unmanaged one is simply left alone.
    expect(plan.strip).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [memory({ id: 'a', assetIds: ['1', '2'], priority: 100 })];
    const snapshot = structuredClone(input);
    planReservation(input);
    expect(input).toEqual(snapshot);
  });
});
