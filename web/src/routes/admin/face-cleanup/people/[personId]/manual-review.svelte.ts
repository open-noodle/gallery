import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { FACE_ACTIONS } from '$lib/components/face-cleanup/face-actions';

// Manual review has no scan (design docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md §6.4,
// §6.5). Guided's review.svelte.ts model cannot serve this page without being rewritten, so this is a
// deliberately SEPARATE model that avoids its two defects:
//
//   1. NO NEUTRAL STATE. Guided's FaceState is six TERMINAL states and every face initialises to 'owner', so
//      an untouched review submits a move for every face. Here the default is `keep`, which writes nothing —
//      an all-keep review builds to NOTHING (§3.1).
//   2. $derived REBUILD WIPES STATE. Guided does `vm = $derived(createReviewModel(flaggedFaces))`, so
//      appending a page rebuilds the model and discards staged decisions. This model OWNS its face list and
//      exposes `appendFaces` instead of being handed a growing array to re-derive from.
export type ManualFaceState = 'keep' | 'move' | 'lock' | 'unknown' | 'detach';

export interface ManualFace {
  // NOTE: no suspectedOwnerId — manual mode has no scan snapshot to suggest a destination.
  assetFaceId: string;
}

export interface ManualResolveRequest {
  personId: string;
  moveToPerson: { destinationPersonId: string; faceIds: string[]; lock: boolean }[];
  // ALWAYS empty — manual never emits `stay`; stay is scan-only, by construction (design §3.2).
  stay: [];
  lock: string[];
  detach: string[];
  unknown: string[];
}

// Projected from the registry under manual's `other` → `move` rename (design §3.1). `keep` deliberately has no
// entry: it is signalled by absence, not a 5th swatch.
export const MANUAL_STATE_COLOR: Record<Exclude<ManualFaceState, 'keep'>, string> = {
  move: FACE_ACTIONS.other.swatchColor!,
  lock: FACE_ACTIONS.lock.swatchColor!,
  unknown: FACE_ACTIONS.unknown.swatchColor!,
  detach: FACE_ACTIONS.detach.swatchColor!,
};

export const MANUAL_STATE_ICON: Record<Exclude<ManualFaceState, 'keep'>, string> = {
  move: FACE_ACTIONS.other.buttonIcon!,
  lock: FACE_ACTIONS.lock.buttonIcon!,
  unknown: FACE_ACTIONS.unknown.buttonIcon!,
  detach: FACE_ACTIONS.detach.buttonIcon!,
};

export type ManualTally = Record<Exclude<ManualFaceState, 'keep'>, number>;

export interface ManualReviewModel {
  // Ordered snapshot of every face loaded so far (across every appendFaces call). Per-face state/destination
  // are read via stateOf/destinationOf rather than carried on this array — there is no scan snapshot to widen
  // ManualFace with, unlike guided's FaceEntry.
  readonly faces: ManualFace[];
  // Server-reported total for the cluster; independent of how many faces have actually loaded (loadedCount).
  readonly total: number;
  readonly loadedCount: number;
  readonly selectedCount: number;
  // Never includes `keep` — a kept face is not "staged", it is the absence of a decision.
  readonly tally: ManualTally;
  readonly hasStagedWork: boolean;

  /** Appends a page of faces. Preserves every existing face's state and the current selection; a face already
   *  present (by assetFaceId) is skipped, so re-fetching an overlapping page is a no-op. `total` is always
   *  refreshed from the server value passed in. */
  appendFaces(faces: ManualFace[], total: number): void;
  /** Drops every loaded face, every staged state, and the selection — back to the model's just-constructed
   *  state. The counterpart `appendFaces` needs: appending is idempotent by assetFaceId, so REFETCHING the
   *  cluster (as the page does after a successful apply) into a populated model skips every id it already
   *  holds and keeps rendering the faces the resolve just moved away. A refresh has to replace, not merge. */
  clear(): void;
  stateOf(assetFaceId: string): ManualFaceState;
  /** Only meaningful when stateOf(id) === 'move' (the picked destination); null otherwise. */
  destinationOf(assetFaceId: string): string | null;
  isSelected(assetFaceId: string): boolean;
  /** Click: toggles one tile in/out of the selection and anchors the next shift-click range. Shift-click:
   *  selects every tile between the last toggled tile and this one, inclusive — bounded by the faces actually
   *  loaded, since that is all this model (or the admin) can see. */
  toggle(assetFaceId: string, shiftKey?: boolean): void;
  /** Selects exactly the faces currently loaded — never `total`. A cluster can hold thousands; "select all"
   *  can only ever mean what is on screen (design §6.4, "Selection cannot claim the whole cluster"). */
  selectAllLoaded(): void;
  clearSelection(): void;
  /** Applies `state` (+ optional destination for `move`) to every selected face, then clears the selection. */
  applyToSelection(state: ManualFaceState, destination?: { personId: string; lock: boolean }): void;
  /** Returns every selected face to `keep`, removing it from whatever bucket it was in, then clears the
   *  selection. The undo a `keep`-default review needs, since marking here is a deliberate act (design §6.4,
   *  "A keep default needs an undo"). */
  unmarkSelection(): void;
  /** Returns every loaded face to `keep` and clears the selection. */
  reset(): void;
  /** Pure builder: groups `move` faces by (destinationPersonId, lock) and emits `lock`/`unknown`/`detach` id
   *  lists. `keep` faces are omitted entirely. Returns null when nothing is staged — not an empty request —
   *  so a disabled Apply cannot be bypassed (an empty resolve is a 400 server-side). */
  buildResolveRequest(): ManualResolveRequest | null;
}

export function createManualReviewModel(personId: string): ManualReviewModel {
  // $state (not $derived over an input array — see the file-level note above): THIS is what lets appendFaces
  // grow the list in place without discarding anything staged on the faces already loaded. `faces` is only
  // ever mutated in place (push in appendFaces, `length = 0` in clear) — never reassigned — so it stays
  // `const`; `total` is reassigned on every appendFaces call, so it stays `let`.
  const faces = $state<ManualFace[]>([]);
  let total = $state(0);

  // Plain (non-reactive) id -> index cache mirroring `faces`' order. Nothing reads it reactively — only
  // toggle()'s shift-range math does internal bookkeeping with it. Unlike guided's static indexById (built
  // once from an array that never changes), this one grows alongside `faces` in appendFaces.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const indexById = new Map<string, number>();

  const states: SvelteMap<string, ManualFaceState> = new SvelteMap();
  const destinations: SvelteMap<string, { personId: string; lock: boolean }> = new SvelteMap();
  const selected: SvelteSet<string> = new SvelteSet();
  let lastToggledIndex: number | null = null;

  const clearSelectionState = () => {
    selected.clear();
    lastToggledIndex = null;
  };

  return {
    get faces(): ManualFace[] {
      return faces;
    },

    get total(): number {
      return total;
    },

    get loadedCount(): number {
      return faces.length;
    },

    get selectedCount(): number {
      return selected.size;
    },

    get tally(): ManualTally {
      const tally: ManualTally = { move: 0, lock: 0, unknown: 0, detach: 0 };
      for (const f of faces) {
        const state = states.get(f.assetFaceId) ?? 'keep';
        if (state !== 'keep') {
          tally[state] += 1;
        }
      }
      return tally;
    },

    get hasStagedWork(): boolean {
      for (const f of faces) {
        if ((states.get(f.assetFaceId) ?? 'keep') !== 'keep') {
          return true;
        }
      }
      return false;
    },

    appendFaces(newFaces: ManualFace[], newTotal: number): void {
      for (const f of newFaces) {
        if (indexById.has(f.assetFaceId)) {
          continue; // idempotent on id — an overlapping/re-fetched page never duplicates a tile
        }
        indexById.set(f.assetFaceId, faces.length);
        faces.push(f);
      }
      total = newTotal;
    },

    clear(): void {
      // In place (`length = 0`), never a reassignment — `faces` is the array the page's `{#each}` is bound to,
      // same invariant `appendFaces`' push relies on.
      faces.length = 0;
      indexById.clear();
      states.clear();
      destinations.clear();
      clearSelectionState();
      total = 0;
    },

    stateOf(assetFaceId: string): ManualFaceState {
      return states.get(assetFaceId) ?? 'keep';
    },

    destinationOf(assetFaceId: string): string | null {
      return destinations.get(assetFaceId)?.personId ?? null;
    },

    isSelected(assetFaceId: string): boolean {
      return selected.has(assetFaceId);
    },

    toggle(assetFaceId: string, shiftKey = false): void {
      const to = indexById.get(assetFaceId);
      if (to === undefined) {
        return;
      }
      if (shiftKey) {
        const from = lastToggledIndex ?? to;
        const [start, end] = from <= to ? [from, to] : [to, from];
        for (let i = start; i <= end; i++) {
          selected.add(faces[i].assetFaceId);
        }
      } else if (selected.has(assetFaceId)) {
        selected.delete(assetFaceId);
      } else {
        selected.add(assetFaceId);
      }
      lastToggledIndex = to;
    },

    selectAllLoaded(): void {
      for (const f of faces) {
        selected.add(f.assetFaceId);
      }
    },

    clearSelection(): void {
      clearSelectionState();
    },

    applyToSelection(state: ManualFaceState, destination?: { personId: string; lock: boolean }): void {
      for (const id of selected) {
        states.set(id, state);
        if (state === 'move' && destination) {
          destinations.set(id, { personId: destination.personId, lock: destination.lock });
        } else {
          destinations.delete(id);
        }
      }
      clearSelectionState();
    },

    unmarkSelection(): void {
      for (const id of selected) {
        states.set(id, 'keep');
        destinations.delete(id);
      }
      clearSelectionState();
    },

    reset(): void {
      for (const f of faces) {
        states.set(f.assetFaceId, 'keep');
        destinations.delete(f.assetFaceId);
      }
      clearSelectionState();
    },

    buildResolveRequest(): ManualResolveRequest | null {
      let staged = false;
      // Plain Map: local bookkeeping scoped to this single pure-function call, discarded on return.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const moveGroups = new Map<string, { destinationPersonId: string; faceIds: string[]; lock: boolean }>();
      const lock: string[] = [];
      const detach: string[] = [];
      const unknown: string[] = [];

      const addToMoveGroup = (destinationPersonId: string, assetFaceId: string, faceLock: boolean) => {
        const key = `${destinationPersonId}|${faceLock}`;
        const group = moveGroups.get(key);
        if (group) {
          group.faceIds.push(assetFaceId);
        } else {
          moveGroups.set(key, { destinationPersonId, faceIds: [assetFaceId], lock: faceLock });
        }
      };

      for (const f of faces) {
        const state = states.get(f.assetFaceId) ?? 'keep';
        switch (state) {
          case 'keep': {
            break; // writes nothing — the whole point of the neutral default (§3.1)
          }
          case 'move': {
            staged = true;
            const destination = destinations.get(f.assetFaceId);
            if (destination) {
              addToMoveGroup(destination.personId, f.assetFaceId, destination.lock);
            }
            break;
          }
          case 'lock': {
            staged = true;
            lock.push(f.assetFaceId);
            break;
          }
          case 'detach': {
            staged = true;
            detach.push(f.assetFaceId);
            break;
          }
          case 'unknown': {
            staged = true;
            unknown.push(f.assetFaceId);
            break;
          }
        }
      }

      if (!staged) {
        return null;
      }

      return {
        personId,
        moveToPerson: [...moveGroups.values()],
        stay: [],
        lock,
        detach,
        unknown,
      };
    },
  };
}
