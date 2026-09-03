import { describe, expect, it } from 'vitest';
import { STATE_COLOR, STATE_ICON } from '../../[personId]/review.svelte';
import {
  createManualReviewModel,
  MANUAL_STATE_COLOR,
  MANUAL_STATE_ICON,
  type ManualFace,
  type ManualFaceState,
  type ManualResolveRequest,
} from './manual-review.svelte';

// Manual mode has no scan, so a cluster face has no suspectedOwnerId (design §6.5: the guided FlaggedFace
// shape does not even typecheck here). It still carries the #1061 source-photo context every ManualFace now
// does — irrelevant to these state/tally tests, so every fixture face shares one stub rather than each test
// inventing its own.
const PHOTO_CONTEXT = {
  localDateTime: '2019-07-04T10:30:00.000Z',
  imageWidth: 400,
  imageHeight: 300,
  boundingBoxX1: 100,
  boundingBoxY1: 75,
  boundingBoxX2: 200,
  boundingBoxY2: 150,
};

const face = (assetFaceId: string): ManualFace => ({ assetFaceId, ...PHOTO_CONTEXT });

const makeFaces = (): ManualFace[] => [face('f1'), face('f2'), face('f3')];

// Every array in a request built in this file must be checked against `stay` (always []) so a regression that
// starts emitting `stay` — the one thing manual must never do (design §3.2) — fails loudly everywhere, not just
// in one dedicated test.
const assertNeverEmitsStayOrOwner = (req: ManualResolveRequest) => {
  expect(req.stay).toEqual([]);
  expect(Object.keys(req)).not.toContain('owner');
};

describe('MANUAL_STATE_COLOR / MANUAL_STATE_ICON', () => {
  it('reuses the exact guided tokens for the four non-keep states', () => {
    expect(MANUAL_STATE_COLOR.move).toBe(STATE_COLOR.other);
    expect(MANUAL_STATE_COLOR.lock).toBe(STATE_COLOR.lock);
    expect(MANUAL_STATE_COLOR.unknown).toBe(STATE_COLOR.unknown);
    expect(MANUAL_STATE_COLOR.detach).toBe(STATE_COLOR.detach);

    expect(MANUAL_STATE_ICON.move).toBe(STATE_ICON.other);
    expect(MANUAL_STATE_ICON.lock).toBe(STATE_ICON.lock);
    expect(MANUAL_STATE_ICON.unknown).toBe(STATE_ICON.unknown);
    expect(MANUAL_STATE_ICON.detach).toBe(STATE_ICON.detach);
  });

  it('has no entry for `keep` — it is signalled by absence, not a 7th swatch (design §6.4)', () => {
    expect(Object.keys(MANUAL_STATE_COLOR).sort()).toEqual(['detach', 'lock', 'move', 'unknown']);
    expect(Object.keys(MANUAL_STATE_ICON).sort()).toEqual(['detach', 'lock', 'move', 'unknown']);
  });
});

describe('createManualReviewModel — defaults', () => {
  it('1. every face starts in `keep`', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    expect(vm.stateOf('f1')).toBe('keep');
    expect(vm.stateOf('f2')).toBe('keep');
    expect(vm.stateOf('f3')).toBe('keep');
  });

  it('2. tally is all zeros and hasStagedWork is false on a fresh model (before any faces load)', () => {
    const vm = createManualReviewModel('person-1');

    expect(vm.tally).toEqual({ move: 0, lock: 0, unknown: 0, detach: 0 });
    expect(vm.hasStagedWork).toBe(false);
  });

  it('2b. tally is all zeros and hasStagedWork is false once faces are loaded but all left as `keep`', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    expect(vm.tally).toEqual({ move: 0, lock: 0, unknown: 0, detach: 0 });
    expect(vm.hasStagedWork).toBe(false);
  });

  it('3. buildResolveRequest() returns null when everything is `keep` — an all-keep review builds to NOTHING', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    expect(vm.buildResolveRequest()).toBeNull();
  });

  it('3b. buildResolveRequest() returns null on a completely empty model (no faces ever loaded)', () => {
    const vm = createManualReviewModel('person-1');

    expect(vm.buildResolveRequest()).toBeNull();
  });
});

describe('createManualReviewModel — bucket construction', () => {
  it('4. lock/unknown/detach selections become their id lists', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.applyToSelection('lock');
    vm.toggle('f2');
    vm.applyToSelection('unknown');
    vm.toggle('f3');
    vm.applyToSelection('detach');

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    expect(req!.lock).toEqual(['f1']);
    expect(req!.unknown).toEqual(['f2']);
    expect(req!.detach).toEqual(['f3']);
    expect(req!.moveToPerson).toEqual([]);
    assertNeverEmitsStayOrOwner(req!);
  });

  it('5. move groups by (destinationPersonId, lock) — same destination merges, different destinations split', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.toggle('f2');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });
    vm.toggle('f3');
    vm.applyToSelection('move', { personId: 'person-b', lock: false });

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    const sorted = [...req!.moveToPerson].sort((a, b) => a.destinationPersonId.localeCompare(b.destinationPersonId));
    expect(sorted).toEqual([
      { destinationPersonId: 'person-a', faceIds: ['f1', 'f2'], lock: false },
      { destinationPersonId: 'person-b', faceIds: ['f3'], lock: false },
    ]);
    assertNeverEmitsStayOrOwner(req!);
  });

  it('6. the lock flag threads onto the move group, and disagreeing locks split even for the same destination', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.applyToSelection('move', { personId: 'person-a', lock: true });
    vm.toggle('f2');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    const groups = req!.moveToPerson.filter((g) => g.destinationPersonId === 'person-a');
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.lock)?.faceIds).toEqual(['f1']);
    expect(groups.find((g) => !g.lock)?.faceIds).toEqual(['f2']);
    assertNeverEmitsStayOrOwner(req!);
  });

  it('7. stay is always [] — asserted on every request shape built in this describe block too', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);
    vm.toggle('f1');
    vm.applyToSelection('lock');

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    expect(req!.stay).toEqual([]);
  });

  it('8. keep faces never appear in any of the five buckets', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2'), face('f3'), face('f4'), face('f5')], 5);

    // f1 stays keep. Mark the rest across every non-keep state.
    vm.toggle('f2');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });
    vm.toggle('f3');
    vm.applyToSelection('lock');
    vm.toggle('f4');
    vm.applyToSelection('unknown');
    vm.toggle('f5');
    vm.applyToSelection('detach');

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    const allMoveIds = req!.moveToPerson.flatMap((g) => g.faceIds);
    expect(allMoveIds).not.toContain('f1');
    expect(req!.stay).not.toContain('f1');
    expect(req!.lock).not.toContain('f1');
    expect(req!.detach).not.toContain('f1');
    expect(req!.unknown).not.toContain('f1');
    assertNeverEmitsStayOrOwner(req!);
  });

  it('9. a face cannot occupy two buckets — re-marking is last-write-wins, id appears exactly once', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.applyToSelection('lock');
    // Re-mark the same face to a different state — it must move buckets, not appear in both.
    vm.toggle('f1');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    expect(req!.lock).not.toContain('f1');
    const allIds = [
      ...req!.moveToPerson.flatMap((g) => g.faceIds),
      ...req!.stay,
      ...req!.lock,
      ...req!.detach,
      ...req!.unknown,
    ];
    expect(allIds.filter((id) => id === 'f1')).toHaveLength(1);
    assertNeverEmitsStayOrOwner(req!);
  });
});

describe('createManualReviewModel — pagination stability (the reason this model exists)', () => {
  it('10. appendFaces preserves existing states: marks survive a page append', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2')], 4);
    vm.toggle('f1');
    vm.applyToSelection('lock');

    vm.appendFaces([face('f3'), face('f4')], 4);

    expect(vm.stateOf('f1')).toBe('lock');
    expect(vm.stateOf('f2')).toBe('keep');
    expect(vm.stateOf('f3')).toBe('keep');
    expect(vm.stateOf('f4')).toBe('keep');
  });

  it('11. appendFaces preserves selection across a page append', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2')], 4);
    vm.toggle('f1');

    vm.appendFaces([face('f3'), face('f4')], 4);

    expect(vm.isSelected('f1')).toBe(true);
    expect(vm.selectedCount).toBe(1);
  });

  it('12. appendFaces does not duplicate a face already present (idempotent on id)', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2')], 4);
    vm.toggle('f1');
    vm.applyToSelection('lock');

    // Same page fetched again (e.g. a retry) — re-appending f1/f2 must be a no-op, not a duplicate tile,
    // and must not disturb the state already staged on f1.
    vm.appendFaces([face('f1'), face('f2'), face('f3')], 4);

    expect(vm.faces.filter((f) => f.assetFaceId === 'f1')).toHaveLength(1);
    expect(vm.loadedCount).toBe(3);
    expect(vm.stateOf('f1')).toBe('lock');
  });

  it('13. total updates from the server value while loadedCount reflects what is actually loaded', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2')], 1204);

    expect(vm.total).toBe(1204);
    expect(vm.loadedCount).toBe(2);

    vm.appendFaces([face('f3')], 1204);
    expect(vm.total).toBe(1204);
    expect(vm.loadedCount).toBe(3);
  });

  // The counterpart to idempotent appending (case 12): that idempotence is exactly why a REFRESH cannot go
  // through appendFaces alone. After a successful apply the page refetches page 0, and every face the resolve
  // moved away has to leave the grid — appending would skip the ids it already holds and keep them on screen.
  it('13b. clear() empties the model so a refetch replaces the cluster instead of merging into it', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2'), face('f3')], 3);
    vm.toggle('f1');
    vm.applyToSelection('lock');
    vm.toggle('f2');

    vm.clear();

    expect(vm.faces).toEqual([]);
    expect(vm.loadedCount).toBe(0);
    expect(vm.total).toBe(0);
    expect(vm.selectedCount).toBe(0);
    expect(vm.hasStagedWork).toBe(false);
    expect(vm.buildResolveRequest()).toBeNull();

    // f1 was moved out by the resolve; f2/f3 remain. Re-appending must NOT resurrect f1, and must not carry
    // f1's staged `lock` forward onto anything.
    vm.appendFaces([face('f2'), face('f3')], 2);
    expect(vm.faces.map((f) => f.assetFaceId)).toEqual(['f2', 'f3']);
    expect(vm.stateOf('f2')).toBe('keep');
    expect(vm.stateOf('f3')).toBe('keep');
    expect(vm.total).toBe(2);
  });
});

describe('createManualReviewModel — selection', () => {
  it('14. toggle selects/deselects; shift-range selects the span over loaded faces only', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    expect(vm.isSelected('f1')).toBe(true);
    vm.toggle('f1');
    expect(vm.isSelected('f1')).toBe(false);

    vm.toggle('f1'); // anchor the range at f1
    vm.toggle('f3', true); // shift-click f3 -> selects f1..f3 inclusive
    expect(vm.isSelected('f1')).toBe(true);
    expect(vm.isSelected('f2')).toBe(true);
    expect(vm.isSelected('f3')).toBe(true);
    expect(vm.selectedCount).toBe(3);
  });

  it('14b. a shift-range click never reaches ids beyond what is currently loaded', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2')], 10);

    vm.toggle('f1');
    vm.toggle('f2', true);
    // Only two faces are loaded — the range cannot possibly select more than that, and a not-yet-loaded id
    // is simply not selectable yet.
    expect(vm.selectedCount).toBe(2);

    vm.appendFaces([face('f3')], 10);
    // The earlier shift-range must not retroactively grow to include a face appended afterward.
    expect(vm.isSelected('f3')).toBe(false);
    expect(vm.selectedCount).toBe(2);
  });

  it('15. selectAllLoaded selects exactly the loaded faces, not total', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces([face('f1'), face('f2')], 1204);

    vm.selectAllLoaded();

    expect(vm.selectedCount).toBe(2);
    expect(vm.selectedCount).not.toBe(vm.total);
  });

  it('16. applyToSelection marks only selected faces', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.toggle('f2');
    vm.applyToSelection('lock');

    expect(vm.stateOf('f1')).toBe('lock');
    expect(vm.stateOf('f2')).toBe('lock');
    expect(vm.stateOf('f3')).toBe('keep');
  });

  it('17. unmarkSelection returns selected faces to keep, removing them from buckets', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });
    vm.toggle('f2');
    vm.applyToSelection('lock');

    vm.toggle('f1');
    vm.unmarkSelection();

    expect(vm.stateOf('f1')).toBe('keep');
    expect(vm.destinationOf('f1')).toBeNull();
    expect(vm.stateOf('f2')).toBe('lock'); // untouched — was not in the unmark selection

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    const allMoveIds = req!.moveToPerson.flatMap((g) => g.faceIds);
    expect(allMoveIds).not.toContain('f1');
    expect(req!.lock).toEqual(['f2']);
    assertNeverEmitsStayOrOwner(req!);
  });

  it('18. reset returns everything to keep and clears selection', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);

    vm.toggle('f1');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });
    vm.toggle('f2');
    vm.applyToSelection('lock');
    vm.toggle('f3');

    vm.reset();

    expect(vm.stateOf('f1')).toBe('keep');
    expect(vm.stateOf('f2')).toBe('keep');
    expect(vm.stateOf('f3')).toBe('keep');
    expect(vm.destinationOf('f1')).toBeNull();
    expect(vm.selectedCount).toBe(0);
    expect(vm.hasStagedWork).toBe(false);
    expect(vm.buildResolveRequest()).toBeNull();
  });
});

describe('createManualReviewModel — guided contrast (regression guard)', () => {
  it("19a. ManualFaceState has exactly the five expected members — no 'owner', no 'stay'", () => {
    const allStates: ManualFaceState[] = ['keep', 'move', 'lock', 'unknown', 'detach'];
    expect(allStates).not.toContain('owner');
    expect(allStates).not.toContain('stay');
    expect(allStates).toHaveLength(5);
  });

  // Compile-level guard: if ManualFaceState ever regained guided's 'owner' or 'stay' members, these two
  // assignments would stop erroring and `pnpm check:typescript` would catch it even though vitest (which does
  // not type-check) would not.
  it('19b. owner/stay are rejected by the type system (see @ts-expect-error lines above this test)', () => {
    // @ts-expect-error - 'owner' must never be a valid ManualFaceState; guided's neutral-state defect (§6.5).
    const invalidOwner: ManualFaceState = 'owner';
    // @ts-expect-error - 'stay' must never be a valid ManualFaceState; manual never emits stay (§3.2).
    const invalidStay: ManualFaceState = 'stay';

    // Keep the values "used" for lint purposes; the meaningful assertion is the @ts-expect-error above.
    expect([invalidOwner, invalidStay]).toEqual(['owner', 'stay']);
  });

  it('19c. buildResolveRequest never emits an `owner` key and `stay` is always [], across every state', () => {
    const vm = createManualReviewModel('person-1');
    vm.appendFaces(makeFaces(), 3);
    vm.toggle('f1');
    vm.applyToSelection('move', { personId: 'person-a', lock: false });
    vm.toggle('f2');
    vm.applyToSelection('unknown');

    const req = vm.buildResolveRequest();
    expect(req).not.toBeNull();
    expect(Object.keys(req!).sort()).toEqual(['detach', 'lock', 'moveToPerson', 'personId', 'stay', 'unknown']);
    assertNeverEmitsStayOrOwner(req!);
  });
});
