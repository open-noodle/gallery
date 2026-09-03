import { describe, expect, it } from 'vitest';
import { createReviewModel, STATE_COLOR, STATE_ICON, type FaceState, type FlaggedFace } from './review.svelte';

// State must never be encoded in colour alone: owner/stay/other used to share one check mark on the tile badge,
// leaving indigo-vs-violet as the only thing separating "moved away" from "locked in place" — unreadable for a
// colourblind admin. Every state carries its own glyph, and no two states may share one.
describe('STATE_ICON', () => {
  const STATES: FaceState[] = ['owner', 'other', 'stay', 'lock', 'detach', 'unknown'];

  it('gives every state its own distinct icon', () => {
    const icons = STATES.map((state) => STATE_ICON[state]);

    expect(icons.filter(Boolean)).toHaveLength(STATES.length);
    expect(new Set(icons).size).toBe(STATES.length);
  });

  it('covers exactly the same states as STATE_COLOR, so a swatch never outlives its glyph', () => {
    expect(Object.keys(STATE_ICON).sort()).toEqual(Object.keys(STATE_COLOR).sort());
  });
});

// Model B (full per-face resolution) review model. Every flagged face carries its OWN suspectedOwnerId (a
// mixed cluster can flag faces toward different owners), so "move to owner" is a per-face grouping, not one
// destination. Every face resolves to exactly one of six terminal states
// (`owner`/`other`/`stay`/`lock`/`detach`/`unknown`).
describe('createReviewModel (Model B / full resolution)', () => {
  // #1061 context fields (localDateTime + the box) are irrelevant to the review model itself — it never reads
  // them, only carries them through into FaceEntry for the grid/modal — so every fixture face shares one stub.
  const photoContext = {
    localDateTime: '2019-07-04T10:30:00.000Z',
    imageWidth: 400,
    imageHeight: 300,
    boundingBoxX1: 100,
    boundingBoxY1: 75,
    boundingBoxX2: 200,
    boundingBoxY2: 150,
  };

  const makeFaces = (): FlaggedFace[] => [
    { assetFaceId: 'f1', suspectedOwnerId: 'owner-a', ...photoContext },
    { assetFaceId: 'f2', suspectedOwnerId: 'owner-a', ...photoContext },
    { assetFaceId: 'f3', suspectedOwnerId: 'owner-b', ...photoContext },
  ];

  const sortedGroups = (req: { moveToPerson?: { destinationPersonId: string; faceIds: string[]; lock?: boolean }[] }) =>
    [...(req.moveToPerson ?? [])].sort((a, b) => a.destinationPersonId.localeCompare(b.destinationPersonId));

  it('starts every face in the owner state with no selection', () => {
    const vm = createReviewModel(makeFaces());
    expect(vm.total).toBe(3);
    expect(vm.selectedCount).toBe(0);
    expect(vm.tally).toEqual({ owner: 3, other: 0, stay: 0, lock: 0, detach: 0, unknown: 0 });
    expect(vm.faces.map((f) => f.state)).toEqual(['owner', 'owner', 'owner']);
  });

  // ---- W1: buildResolveRequest groups owner faces by EACH face's own suspectedOwnerId ----

  it("W1: groups default (owner-state) faces by each face's own suspectedOwnerId, not one destination", () => {
    const vm = createReviewModel(makeFaces());
    const req = vm.buildResolveRequest('person-1');

    expect(req.personId).toBe('person-1');
    // owner-state groups never auto-lock (Slice 3, move-and-lock: only a deliberate "other" pick can).
    expect(sortedGroups(req)).toEqual([
      { destinationPersonId: 'owner-a', faceIds: ['f1', 'f2'], lock: false },
      { destinationPersonId: 'owner-b', faceIds: ['f3'], lock: false },
    ]);
    expect(req.stay).toEqual([]);
    expect(req.lock).toEqual([]);
    expect(req.detach).toEqual([]);
    expect(req.entireCluster).toBeUndefined();
  });

  it('W1: an "other"-state face routes to its chosen destination, not its suspected owner', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f3');
    vm.applyToSelection('other', { personId: 'chosen-1', name: 'Chosen Person' });

    const req = vm.buildResolveRequest('person-1');
    expect(sortedGroups(req)).toEqual([
      { destinationPersonId: 'chosen-1', faceIds: ['f3'], lock: false },
      { destinationPersonId: 'owner-a', faceIds: ['f1', 'f2'], lock: false },
    ]);
  });

  it('W1: owner and other faces sharing the same destination merge into one group', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f3');
    vm.applyToSelection('other', { personId: 'owner-a', name: 'Owner A' });

    const req = vm.buildResolveRequest('person-1');
    expect(sortedGroups(req)).toEqual([{ destinationPersonId: 'owner-a', faceIds: ['f1', 'f2', 'f3'], lock: false }]);
  });

  // ---- W1 (Slice 3, move-and-lock): the picker's lock toggle rides along on "other"-state groups only ----

  it('W1: an "other"-state group carries lock:true when the picker toggle is on; the owner-state group never auto-locks', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f3');
    vm.applyToSelection('other', { personId: 'chosen-1', name: 'Chosen Person', lock: true });

    const req = vm.buildResolveRequest('person-1');
    const chosenGroup = req.moveToPerson?.find((g) => g.destinationPersonId === 'chosen-1');
    const ownerGroup = req.moveToPerson?.find((g) => g.destinationPersonId === 'owner-a');

    expect(chosenGroup?.lock).toBe(true);
    // f1/f2 are still on the default `owner` state — a suggested-owner move must never auto-lock.
    expect(ownerGroup?.lock ?? false).toBe(false);
  });

  it('W1 (Slice 3 fix): an owner-state face never auto-locks when an other-state face shares its destination with lock:true', () => {
    const vm = createReviewModel(makeFaces());
    // f1/f2 stay in the default owner state (suspectedOwnerId 'owner-a' — the "P" from the bug report).
    // f3 is explicitly routed via the picker to that SAME destination ('owner-a') with the lock toggle on.
    vm.toggleSelect('f3');
    vm.applyToSelection('other', { personId: 'owner-a', name: 'Owner A', lock: true });

    const req = vm.buildResolveRequest('person-1');
    const groupsForOwnerA = (req.moveToPerson ?? []).filter((g) => g.destinationPersonId === 'owner-a');

    // Two separate groups to the same destination — the owner-state group must NOT inherit the other-state
    // group's lock:true (that would silently auto-lock a face the admin never asked to lock).
    expect(groupsForOwnerA).toHaveLength(2);
    const lockedGroup = groupsForOwnerA.find((g) => g.lock);
    const unlockedGroup = groupsForOwnerA.find((g) => !g.lock);
    expect(lockedGroup?.faceIds).toEqual(['f3']);
    expect(unlockedGroup?.faceIds).toEqual(['f1', 'f2']);
  });

  it('W2: toggling the picker lock off emits lock:false for that group', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f3');
    vm.applyToSelection('other', { personId: 'chosen-1', name: 'Chosen Person', lock: false });

    const req = vm.buildResolveRequest('person-1');
    const chosenGroup = req.moveToPerson?.find((g) => g.destinationPersonId === 'chosen-1');
    expect(chosenGroup?.lock).toBe(false);
  });

  it('W1: omitting lock on an "other"-state destination defaults that group to lock:false', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f3');
    vm.applyToSelection('other', { personId: 'chosen-1', name: 'Chosen Person' });

    const req = vm.buildResolveRequest('person-1');
    const chosenGroup = req.moveToPerson?.find((g) => g.destinationPersonId === 'chosen-1');
    expect(chosenGroup?.lock).toBe(false);
  });

  it('W1: stay/lock/detach faces are emitted as id lists and excluded from moveToPerson', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f1');
    vm.applyToSelection('stay');
    vm.toggleSelect('f2');
    vm.applyToSelection('lock');
    vm.toggleSelect('f3');
    vm.applyToSelection('detach');

    const req = vm.buildResolveRequest('person-1');
    expect(req.moveToPerson).toEqual([]);
    expect(req.stay).toEqual(['f1']);
    expect(req.lock).toEqual(['f2']);
    expect(req.detach).toEqual(['f3']);
    expect(req.unknown).toEqual([]);
  });

  it('W1: unknown faces are emitted in `unknown`, never as a move to the suspected owner', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f1');
    vm.toggleSelect('f2');
    vm.applyToSelection('unknown');

    const req = vm.buildResolveRequest('person-1');
    expect(req.unknown).toEqual(['f1', 'f2']);
    // The whole point: an unknown face must NOT be routed to the owner the scan suspected — that suggestion is
    // exactly what the admin is rejecting when they say they cannot name it. Only f3 (still `owner`) moves.
    expect(req.moveToPerson).toEqual([{ destinationPersonId: 'owner-b', faceIds: ['f3'], lock: false }]);
    expect(req.stay).toEqual([]);
    expect(req.detach).toEqual([]);
  });

  // ---- W2: the outcome tally always sums to N across every sequence of bulk actions ----

  it('W2: tally always sums to N across a sequence of bulk actions', () => {
    const vm = createReviewModel(makeFaces());
    const sumTally = () => Object.values(vm.tally).reduce((a, b) => a + b, 0);
    expect(sumTally()).toBe(3);

    vm.toggleSelect('f1');
    vm.applyToSelection('stay');
    expect(sumTally()).toBe(3);
    expect(vm.tally).toEqual({ owner: 2, other: 0, stay: 1, lock: 0, detach: 0, unknown: 0 });

    vm.toggleSelect('f2');
    vm.toggleSelect('f3');
    vm.applyToSelection('lock');
    expect(sumTally()).toBe(3);
    expect(vm.tally).toEqual({ owner: 0, other: 0, stay: 1, lock: 2, detach: 0, unknown: 0 });

    vm.selectAll();
    vm.applyToSelection('detach');
    expect(sumTally()).toBe(3);
    expect(vm.tally).toEqual({ owner: 0, other: 0, stay: 0, lock: 0, detach: 3, unknown: 0 });

    vm.toggleSelect('f1');
    vm.applyToSelection('owner');
    expect(sumTally()).toBe(3);
    expect(vm.tally).toEqual({ owner: 1, other: 0, stay: 0, lock: 0, detach: 2, unknown: 0 });
  });

  it('W2: re-routing an already-routed face keeps the tally at N (no double counting)', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f1');
    vm.applyToSelection('other', { personId: 'chosen-1', name: 'Chosen' });
    vm.toggleSelect('f1');
    vm.applyToSelection('stay');

    expect(Object.values(vm.tally).reduce((a, b) => a + b, 0)).toBe(3);
    expect(vm.tally).toEqual({ owner: 2, other: 0, stay: 1, lock: 0, detach: 0, unknown: 0 });
    // the stale "other" destination must not leak back in once re-routed away from "other"
    expect(vm.faces.find((f) => f.assetFaceId === 'f1')?.destinationPersonId).toBeNull();
  });

  // ---- W3: bulk actions mutate per-face state correctly; Reset returns all tiles to owner ----

  it('W3: bulk actions mutate exactly the selected faces and clear the selection afterward', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f1');
    vm.toggleSelect('f2');
    vm.applyToSelection('lock');

    expect(vm.faces.find((f) => f.assetFaceId === 'f1')?.state).toBe('lock');
    expect(vm.faces.find((f) => f.assetFaceId === 'f2')?.state).toBe('lock');
    expect(vm.faces.find((f) => f.assetFaceId === 'f3')?.state).toBe('owner');
    expect(vm.selectedCount).toBe(0); // bulk actions clear the selection (mirrors the mockup's apply(s))
  });

  it('W3: Reset returns every face to owner and clears any chosen destination', () => {
    const vm = createReviewModel(makeFaces());
    vm.toggleSelect('f1');
    vm.applyToSelection('other', { personId: 'chosen-1', name: 'Chosen' });
    vm.toggleSelect('f2');
    vm.applyToSelection('stay');
    expect(vm.tally.owner).toBe(1);

    vm.reset();

    expect(vm.tally).toEqual({ owner: 3, other: 0, stay: 0, lock: 0, detach: 0, unknown: 0 });
    for (const face of vm.faces) {
      expect(face.state).toBe('owner');
      expect(face.destinationPersonId).toBeNull();
      expect(face.destinationName).toBeNull();
    }
    expect(vm.selectedCount).toBe(0);

    const req = vm.buildResolveRequest('person-1');
    expect(req.stay).toEqual([]);
    expect(
      (req.moveToPerson ?? [])
        .flatMap((g) => g.faceIds)
        .slice()
        .sort(),
    ).toEqual(['f1', 'f2', 'f3']);
  });

  // ---- selection ops backing P1 (click toggle, shift-range, select-all, clear) ----

  it('selection: click toggles, shift-click selects a range, selectAll/clearSelection work', () => {
    const vm = createReviewModel(makeFaces());

    vm.toggleSelect('f1');
    expect(vm.isSelected('f1')).toBe(true);
    expect(vm.selectedCount).toBe(1);
    vm.toggleSelect('f1'); // toggling again deselects
    expect(vm.isSelected('f1')).toBe(false);
    expect(vm.selectedCount).toBe(0);

    vm.toggleSelect('f1'); // anchor the range at f1
    vm.selectRange('f3'); // shift-click f3 → selects f1..f3 inclusive
    expect(vm.isSelected('f1')).toBe(true);
    expect(vm.isSelected('f2')).toBe(true);
    expect(vm.isSelected('f3')).toBe(true);
    expect(vm.selectedCount).toBe(3);

    vm.clearSelection();
    expect(vm.selectedCount).toBe(0);

    vm.selectAll();
    expect(vm.selectedCount).toBe(3);
  });
});
