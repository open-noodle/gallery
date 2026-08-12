import type { FaceRepairResolveRequestDto } from '@immich/sdk';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { FACE_ACTIONS, GUIDED_STATE_IDS } from '$lib/components/face-cleanup/face-actions';

// Model B (full per-face resolution, docs/plans/2026-07-10-face-cleanup-full-resolution-design.md). Every
// flagged face resolves to exactly one of six terminal states.
//
// `unknown` is the sixth: a real face of a real person the admin cannot name. It is the standard case whenever
// an admin reviews someone else's library — a friend of the family turns up in a mixed cluster, the admin knows
// it is not the cluster's person, but has no one to route it to. Without it the review cannot be finished: every
// other action is a lie (moving it to the suggested owner is wrong, keeping it is wrong, and "not a face" is
// wrong — it plainly IS a face). The server parks these in a fresh unnamed cluster of their own.
export type FaceState = 'owner' | 'other' | 'stay' | 'lock' | 'detach' | 'unknown';

// Projected from the shared registry (design §3.1) rather than declared here, so the bulk bar, the tile badge,
// the tally chip and the help modal cannot drift apart. NARROWS to the six tile states: `keep`/`unmark` have no
// tile state and must never appear here (review.spec.ts pins these key sets).
export const STATE_COLOR: Record<FaceState, string> = Object.fromEntries(
  GUIDED_STATE_IDS.map((id) => [id, FACE_ACTIONS[id].swatchColor!]),
) as Record<FaceState, string>;

// One icon per state, so state is never encoded in COLOR ALONE. The tile badge used to stamp the same check
// mark on owner/stay/other, leaving indigo-vs-violet as the only thing separating "moved away" from "locked in
// place" — unreadable for a colorblind admin, and hard for anyone at a glance. Same icon on the tile badge, the
// bulk-bar button, the tally chip and the help modal, so one glyph means one thing everywhere on the page.
export const STATE_ICON: Record<FaceState, string> = Object.fromEntries(
  GUIDED_STATE_IDS.map((id) => [id, FACE_ACTIONS[id].buttonIcon!]),
) as Record<FaceState, string>;

export interface FlaggedFace {
  assetFaceId: string;
  // Per-face suspected owner from the persisted scan snapshot — a mixed cluster can flag faces toward
  // different owners, so "move to owner" groups by each face's OWN suspectedOwnerId, not one destination.
  suspectedOwnerId: string;
}

export interface FaceEntry extends FlaggedFace {
  readonly state: FaceState;
  // Only meaningful when state === 'other' (a picked destination); null otherwise.
  readonly destinationPersonId: string | null;
  readonly destinationName: string | null;
}

export type FaceTally = Record<FaceState, number>;

export interface ReviewModel {
  // Ordered snapshot of every flagged face with its current state, for rendering the grid.
  readonly faces: FaceEntry[];
  readonly total: number;
  // Always sums to `total` — the client-side completeness guarantee (W2 / spec E17).
  readonly tally: FaceTally;
  readonly selectedCount: number;

  isSelected(assetFaceId: string): boolean;
  /** Click: toggles one tile in/out of the selection and anchors the next shift-click range. */
  toggleSelect(assetFaceId: string): void;
  /** Shift-click: selects every tile between the last toggled tile and this one, inclusive. */
  selectRange(assetFaceId: string): void;
  selectAll(): void;
  clearSelection(): void;
  /** Returns every face to `owner` (clearing any chosen destination) and clears the selection. */
  reset(): void;
  /** Applies `state` (+ optional destination for `other`) to every currently-selected face, then clears the
   *  selection — mirrors the mockup's `apply(s)` bulk-bar action. `destination.lock` (Slice 3, move-and-lock)
   *  is the PersonPicker's "Lock so it won't re-flag" toggle; it defaults to false and only ever applies to
   *  `other`-state (chosen-person) destinations — a suggested-owner move never auto-locks. */
  applyToSelection(state: FaceState, destination?: { personId: string; name?: string | null; lock?: boolean }): void;
  /** Pure builder: groups `owner`/`other` faces by destination (owner destination = each face's own
   *  suspectedOwnerId) and emits `stay`/`lock`/`detach` id lists. Never touches the network.
   *
   *  `added` carries the rest-of-cluster faces the admin ticked — faces the scan never flagged, which they want
   *  moved to the same destination anyway. They join the SAME resolve as the flagged faces (one terminal Apply):
   *  a separate resolve for them alone would settle none of the flagged snapshot, and the server would (rightly)
   *  refuse to drain the person — leaving the review half-done. */
  buildResolveRequest(
    personId: string,
    added?: { destinationPersonId: string; faceIds: string[] },
  ): FaceRepairResolveRequestDto;
}

export function createReviewModel(flaggedFaces: FlaggedFace[]): ReviewModel {
  const order = flaggedFaces.map((f) => f.assetFaceId);
  // Plain Map (not SvelteMap): a static id→index lookup built once from `flaggedFaces`, which never changes
  // for the lifetime of this model instance — nothing reads it reactively.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const indexById = new Map(order.map((id, i) => [id, i]));

  const states: SvelteMap<string, FaceState> = new SvelteMap(order.map((id) => [id, 'owner' as FaceState]));
  const destinations: SvelteMap<string, { personId: string; name: string | null; lock: boolean }> = new SvelteMap();
  const selected: SvelteSet<string> = new SvelteSet();
  let lastToggledIndex: number | null = null;

  const clearSelectionState = () => {
    selected.clear();
    lastToggledIndex = null;
  };

  return {
    get faces(): FaceEntry[] {
      return flaggedFaces.map((face) => {
        const destination = destinations.get(face.assetFaceId);
        return {
          ...face,
          state: states.get(face.assetFaceId) ?? 'owner',
          destinationPersonId: destination?.personId ?? null,
          destinationName: destination?.name ?? null,
        };
      });
    },

    get total(): number {
      return order.length;
    },

    get tally(): FaceTally {
      const tally: FaceTally = { owner: 0, other: 0, stay: 0, lock: 0, detach: 0, unknown: 0 };
      for (const id of order) {
        const state = states.get(id) ?? 'owner';
        tally[state] += 1;
      }
      return tally;
    },

    get selectedCount(): number {
      return selected.size;
    },

    isSelected(assetFaceId: string): boolean {
      return selected.has(assetFaceId);
    },

    toggleSelect(assetFaceId: string): void {
      if (selected.has(assetFaceId)) {
        selected.delete(assetFaceId);
      } else {
        selected.add(assetFaceId);
      }
      lastToggledIndex = indexById.get(assetFaceId) ?? null;
    },

    selectRange(assetFaceId: string): void {
      const to = indexById.get(assetFaceId);
      if (to === undefined) {
        return;
      }
      const from = lastToggledIndex ?? to;
      const [start, end] = from <= to ? [from, to] : [to, from];
      for (let i = start; i <= end; i++) {
        selected.add(order[i]);
      }
      lastToggledIndex = to;
    },

    selectAll(): void {
      for (const id of order) {
        selected.add(id);
      }
    },

    clearSelection(): void {
      clearSelectionState();
    },

    reset(): void {
      for (const id of order) {
        states.set(id, 'owner');
        destinations.delete(id);
      }
      clearSelectionState();
    },

    applyToSelection(state: FaceState, destination?: { personId: string; name?: string | null; lock?: boolean }): void {
      for (const id of selected) {
        states.set(id, state);
        if (state === 'other' && destination) {
          destinations.set(id, {
            personId: destination.personId,
            name: destination.name ?? null,
            lock: destination.lock ?? false,
          });
        } else {
          destinations.delete(id);
        }
      }
      clearSelectionState();
    },

    buildResolveRequest(
      personId: string,
      added?: { destinationPersonId: string; faceIds: string[] },
    ): FaceRepairResolveRequestDto {
      // Plain Map: local bookkeeping scoped to this single pure-function call, discarded on return — no UI
      // reads it, so it never needs to be reactive.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const moveGroups = new Map<string, { destinationPersonId: string; faceIds: string[]; lock: boolean }>();
      const stay: string[] = [];
      const lock: string[] = [];
      const detach: string[] = [];
      const unknown: string[] = [];

      // `lock` (Slice 3, move-and-lock): a suggested-owner (`owner`-state) move always passes `lock: false` —
      // never auto-lock a face the admin didn't explicitly move. A chosen-person (`other`-state) move passes
      // whatever the PersonPicker's toggle recorded. Groups are keyed by the PAIR (destinationPersonId, lock),
      // not destinationPersonId alone: if an owner-state face and an other-state face happen to share a
      // destination but disagree on lock, they must emit as two separate `moveToPerson` groups so the
      // owner-state group is never swept into a lock:true it never asked for.
      const addToMoveGroup = (destinationPersonId: string, assetFaceId: string, faceLock: boolean) => {
        const key = `${destinationPersonId}|${faceLock}`;
        const group = moveGroups.get(key);
        if (group) {
          group.faceIds.push(assetFaceId);
        } else {
          moveGroups.set(key, { destinationPersonId, faceIds: [assetFaceId], lock: faceLock });
        }
      };

      for (const face of flaggedFaces) {
        const state = states.get(face.assetFaceId) ?? 'owner';
        switch (state) {
          case 'owner': {
            addToMoveGroup(face.suspectedOwnerId, face.assetFaceId, false);
            break;
          }
          case 'other': {
            const destination = destinations.get(face.assetFaceId);
            if (destination) {
              addToMoveGroup(destination.personId, face.assetFaceId, destination.lock);
            }
            break;
          }
          case 'stay': {
            stay.push(face.assetFaceId);
            break;
          }
          case 'lock': {
            lock.push(face.assetFaceId);
            break;
          }
          case 'detach': {
            detach.push(face.assetFaceId);
            break;
          }
          case 'unknown': {
            unknown.push(face.assetFaceId);
            break;
          }
        }
      }

      // Rest-of-cluster faces the admin added ride the same (destination, lock:false) group as an owner-state
      // face bound for the same person — addToMoveGroup dedupes by that key, so they merge rather than emitting
      // a second group for the same destination.
      for (const assetFaceId of added?.faceIds ?? []) {
        addToMoveGroup(added!.destinationPersonId, assetFaceId, false);
      }

      return {
        personId,
        moveToPerson: [...moveGroups.values()].map((group) => ({
          destinationPersonId: group.destinationPersonId,
          faceIds: group.faceIds,
          lock: group.lock,
        })),
        stay,
        lock,
        detach,
        unknown,
      };
    },
  };
}
