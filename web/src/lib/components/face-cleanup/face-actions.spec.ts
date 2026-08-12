import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STATE_COLOR, STATE_ICON } from '../../../routes/admin/face-cleanup/[personId]/review.svelte';
import {
  MANUAL_STATE_COLOR,
  MANUAL_STATE_ICON,
} from '../../../routes/admin/face-cleanup/people/[personId]/manual-review.svelte';
import {
  bodyKeyFor,
  effectKeyFor,
  FACE_ACTIONS,
  GUIDED_STATE_IDS,
  type FaceActionId,
  type FaceReviewMode,
} from './face-actions';

// The registry is the single source of truth behind the bulk-bar buttons, their hover copy and the help
// modal. These tests pin the two things a merge like this silently breaks: that no action lost its glyph,
// and that the actions whose explanation DIFFERS per mode still resolve to the two different keys they
// used before the merge (spec §3.1 "Mode-dependent copy").

const ALL_IDS: FaceActionId[] = ['owner', 'stay', 'lock', 'other', 'unknown', 'detach', 'keep', 'unmark'];
const MODES: FaceReviewMode[] = ['guided', 'manual'];

const en = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../i18n/en.json'), 'utf8')) as {
  admin: Record<string, string>;
};

const existsInEn = (dottedKey: string) => Object.hasOwn(en.admin, dottedKey.replace(/^admin\./, ''));

describe('FACE_ACTIONS registry', () => {
  // R1
  it('has an entry for every action id, so a new id cannot be added without its meta', () => {
    expect(Object.keys(FACE_ACTIONS).sort()).toEqual([...ALL_IDS].sort());
  });

  // R2
  it('gives every action its own label, tip, body and effect — no copy-pasted explanations', () => {
    const labels = ALL_IDS.map((id) => FACE_ACTIONS[id].labelKey);
    const tips = ALL_IDS.map((id) => FACE_ACTIONS[id].tipKey);
    expect(new Set(labels).size).toBe(ALL_IDS.length);
    expect(new Set(tips).size).toBe(ALL_IDS.length);

    for (const mode of MODES) {
      const bodies = ALL_IDS.map((id) => bodyKeyFor(id, mode));
      const effects = ALL_IDS.map((id) => effectKeyFor(id, mode));
      expect(new Set(bodies).size).toBe(ALL_IDS.length);
      expect(new Set(effects).size).toBe(ALL_IDS.length);
    }
  });

  // R3 — both arms of every mode-dependent key, not just the one a given mode happens to pick.
  it('names only keys that exist in en.json, in both modes', () => {
    for (const id of ALL_IDS) {
      expect(existsInEn(FACE_ACTIONS[id].labelKey), `${id}.labelKey`).toBe(true);
      expect(existsInEn(FACE_ACTIONS[id].tipKey), `${id}.tipKey`).toBe(true);
      for (const mode of MODES) {
        expect(existsInEn(bodyKeyFor(id, mode)), `${id}.body[${mode}]`).toBe(true);
        expect(existsInEn(effectKeyFor(id, mode)), `${id}.effect[${mode}]`).toBe(true);
      }
    }
  });

  // R4 — the F2 split. A button glyph is not a tile state, and the two absences do not coincide.
  it('gives every bar action a glyph (including unmark) and withholds a swatch only from keep and unmark', () => {
    const actionIdsExceptKeep = ALL_IDS.filter((candidate) => candidate !== 'keep');
    for (const id of actionIdsExceptKeep) {
      expect(FACE_ACTIONS[id].buttonIcon, `${id} must have a button glyph`).toBeTruthy();
    }
    expect(FACE_ACTIONS.keep.buttonIcon).toBeUndefined();

    const withoutSwatch = ALL_IDS.filter((id) => FACE_ACTIONS[id].swatchColor === undefined);
    expect(withoutSwatch.sort()).toEqual(['keep', 'unmark']);
  });

  // R5
  it('marks only the irreversible action as dangerous', () => {
    const dangerous = ALL_IDS.filter((id) => FACE_ACTIONS[id].tone === 'danger');
    expect(dangerous).toEqual(['detach']);
  });

  // R6 — manual's "Move to…" button IS `other`; there is no separate move id.
  it('has no separate move id, so both modes render one label for moving a face to a chosen person', () => {
    expect(Object.keys(FACE_ACTIONS)).not.toContain('move');
    expect(FACE_ACTIONS.other.labelKey).toBe('admin.face_cleanup_review_bulk_other');
  });

  // R7 — the whole point of ModalKey. Each arm pinned to the key that mode used before the merge.
  it('resolves the mode-specific explanations to the exact keys each mode used before the merge', () => {
    expect(bodyKeyFor('other', 'guided')).toBe('admin.face_cleanup_review_help_other_body');
    expect(bodyKeyFor('other', 'manual')).toBe('admin.face_cleanup_manual_review_help_move_body');

    expect(effectKeyFor('other', 'guided')).toBe('admin.face_cleanup_review_help_other_effect');
    expect(effectKeyFor('other', 'manual')).toBe('admin.face_cleanup_manual_review_help_move_effect');

    expect(bodyKeyFor('lock', 'guided')).toBe('admin.face_cleanup_review_help_lock_body');
    expect(bodyKeyFor('lock', 'manual')).toBe('admin.face_cleanup_manual_review_help_lock_body');
  });

  // R8 — the merge must not split what was already shared.
  it('keeps the shared explanations shared across both modes', () => {
    for (const id of ['unknown', 'detach'] as const) {
      expect(bodyKeyFor(id, 'guided')).toBe(bodyKeyFor(id, 'manual'));
      expect(effectKeyFor(id, 'guided')).toBe(effectKeyFor(id, 'manual'));
    }
    expect(effectKeyFor('lock', 'guided')).toBe(effectKeyFor('lock', 'manual'));
  });

  it('lists exactly the six guided tile states', () => {
    expect([...GUIDED_STATE_IDS].sort()).toEqual(['detach', 'lock', 'other', 'owner', 'stay', 'unknown']);
  });
});

// R9/R10 — the route tokens are PROJECTIONS of the registry. Asserts both halves: the values match, and the
// projection NARROWS (keep/unmark must never leak into a tile-state map).
describe('state tokens derived from the registry', () => {
  it('projects exactly the six guided states, with the registry values', () => {
    expect(Object.keys(STATE_COLOR).sort()).toEqual(['detach', 'lock', 'other', 'owner', 'stay', 'unknown']);
    expect(Object.keys(STATE_ICON).sort()).toEqual(['detach', 'lock', 'other', 'owner', 'stay', 'unknown']);

    for (const id of GUIDED_STATE_IDS) {
      expect(STATE_COLOR[id]).toBe(FACE_ACTIONS[id].swatchColor);
      expect(STATE_ICON[id]).toBe(FACE_ACTIONS[id].buttonIcon);
    }
  });

  it('projects manual’s four states, renaming other → move, and leaks neither keep nor unmark', () => {
    expect(Object.keys(MANUAL_STATE_COLOR).sort()).toEqual(['detach', 'lock', 'move', 'unknown']);
    expect(Object.keys(MANUAL_STATE_ICON).sort()).toEqual(['detach', 'lock', 'move', 'unknown']);

    expect(MANUAL_STATE_COLOR.move).toBe(FACE_ACTIONS.other.swatchColor);
    expect(MANUAL_STATE_ICON.move).toBe(FACE_ACTIONS.other.buttonIcon);
    for (const id of ['lock', 'unknown', 'detach'] as const) {
      expect(MANUAL_STATE_COLOR[id]).toBe(FACE_ACTIONS[id].swatchColor);
      expect(MANUAL_STATE_ICON[id]).toBe(FACE_ACTIONS[id].buttonIcon);
    }
  });
});
