import {
  mdiAccountArrowRight,
  mdiAccountQuestion,
  mdiArrowRightBold,
  mdiImageOff,
  mdiLock,
  mdiPin,
  mdiUndo,
} from '@mdi/js';
import type { Translations } from 'svelte-i18n';

/**
 * The single source of truth behind every face-cleanup action: its button label, its hover tip, its help-modal
 * explanation, its glyph, its tile colour and its severity. One registry so an explanation can never drift from
 * the button it explains (design docs/superpowers/specs/2026-07-31-face-cleanup-ux-unification-design.md §3.1).
 */
export type FaceActionId = 'owner' | 'stay' | 'lock' | 'other' | 'unknown' | 'detach' | 'keep' | 'unmark';

/** Guided review (scan-driven) and manual review (pick a person, no scan). */
export type FaceReviewMode = 'guided' | 'manual';

/**
 * A key that reads the same in both modes, or one key per mode.
 *
 * Three explanations are genuinely mode-dependent and MUST NOT be collapsed: guided's "move to a chosen
 * person" copy frames the action as overriding the scan and warns the next scan can re-flag the face, which is
 * meaningless in a mode that never scans; and guided's lock copy says "their owner" where manual says "this
 * person". Collapsing either ships copy describing the wrong mode.
 */
type ModalKey = Translations | Readonly<Record<FaceReviewMode, Translations>>;

export interface FaceActionMeta {
  readonly id: FaceActionId;
  /** Button label, and the help modal's heading — one key, so the two can never disagree. */
  readonly labelKey: Translations;
  /** One line for the hover/focus popover. Mode-independent for every action. */
  readonly tipKey: Translations;
  /** Help modal: what it means / when to use it. */
  readonly bodyKey: ModalKey;
  /** Help modal "On apply:", and the dock's inline hint row. */
  readonly effectKey: ModalKey;
  /**
   * Glyph on the bulk-bar button. Present for everything that IS a button — including `unmark`, whose
   * `mdiUndo` is easy to lose in a merge because it has no tile state. `undefined` only for `keep`, which is
   * the default rather than a button and appears solely in the help modal.
   */
  readonly buttonIcon: string | undefined;
  /**
   * The tile-state swatch — badge, ribbon, help-modal rail. `undefined` for `keep` and `unmark`: neither
   * corresponds to a coloured tile state, and both are signalled by ABSENCE. Deliberately NOT the same
   * absence as `buttonIcon` — `unmark` has a glyph but no swatch.
   */
  readonly swatchColor: string | undefined;
  /** `danger` tints the button red. Only `detach`, the one irreversible action. */
  readonly tone: 'default' | 'danger';
}

// Model B state colours (docs/plans/2026-07-10-face-cleanup-resolution-mockup.html :root vars).
const COLOR = {
  owner: '#4f46e5',
  other: '#d97706',
  stay: '#16a34a',
  lock: '#7c3aed',
  detach: '#475569',
  unknown: '#0d9488',
} as const;

export const FACE_ACTIONS: Readonly<Record<FaceActionId, FaceActionMeta>> = {
  owner: {
    id: 'owner',
    labelKey: 'admin.face_cleanup_review_bulk_owner',
    tipKey: 'admin.face_cleanup_action_owner_tip',
    bodyKey: 'admin.face_cleanup_review_help_owner_body',
    effectKey: 'admin.face_cleanup_review_help_owner_effect',
    buttonIcon: mdiArrowRightBold,
    swatchColor: COLOR.owner,
    tone: 'default',
  },
  stay: {
    id: 'stay',
    labelKey: 'admin.face_cleanup_review_bulk_stay',
    tipKey: 'admin.face_cleanup_action_stay_tip',
    bodyKey: 'admin.face_cleanup_review_help_stay_body',
    effectKey: 'admin.face_cleanup_review_help_stay_effect',
    buttonIcon: mdiPin,
    swatchColor: COLOR.stay,
    tone: 'default',
  },
  lock: {
    id: 'lock',
    labelKey: 'admin.face_cleanup_review_bulk_lock',
    tipKey: 'admin.face_cleanup_action_lock_tip',
    // Guided: "don't resemble their owner". Manual: "don't look like this person".
    bodyKey: {
      guided: 'admin.face_cleanup_review_help_lock_body',
      manual: 'admin.face_cleanup_manual_review_help_lock_body',
    },
    // Shared verbatim before the merge: the lock mechanism is identical in both modes.
    effectKey: 'admin.face_cleanup_review_help_lock_effect',
    buttonIcon: mdiLock,
    swatchColor: COLOR.lock,
    tone: 'default',
  },
  other: {
    id: 'other',
    labelKey: 'admin.face_cleanup_review_bulk_other',
    tipKey: 'admin.face_cleanup_action_other_tip',
    bodyKey: {
      guided: 'admin.face_cleanup_review_help_other_body',
      manual: 'admin.face_cleanup_manual_review_help_move_body',
    },
    effectKey: {
      guided: 'admin.face_cleanup_review_help_other_effect',
      manual: 'admin.face_cleanup_manual_review_help_move_effect',
    },
    buttonIcon: mdiAccountArrowRight,
    swatchColor: COLOR.other,
    tone: 'default',
  },
  unknown: {
    id: 'unknown',
    labelKey: 'admin.face_cleanup_review_bulk_unknown',
    tipKey: 'admin.face_cleanup_action_unknown_tip',
    bodyKey: 'admin.face_cleanup_review_help_unknown_body',
    effectKey: 'admin.face_cleanup_review_help_unknown_effect',
    buttonIcon: mdiAccountQuestion,
    swatchColor: COLOR.unknown,
    tone: 'default',
  },
  detach: {
    id: 'detach',
    labelKey: 'admin.face_cleanup_review_bulk_detach',
    tipKey: 'admin.face_cleanup_action_detach_tip',
    bodyKey: 'admin.face_cleanup_review_help_detach_body',
    effectKey: 'admin.face_cleanup_review_help_detach_effect',
    buttonIcon: mdiImageOff,
    swatchColor: COLOR.detach,
    tone: 'danger',
  },
  keep: {
    id: 'keep',
    labelKey: 'admin.face_cleanup_manual_review_help_keep_name',
    tipKey: 'admin.face_cleanup_action_keep_tip',
    bodyKey: 'admin.face_cleanup_manual_review_help_keep_body',
    effectKey: 'admin.face_cleanup_manual_review_help_keep_effect',
    // Not a button: keep is the default, explained in the modal only.
    buttonIcon: undefined,
    swatchColor: undefined,
    tone: 'default',
  },
  unmark: {
    id: 'unmark',
    labelKey: 'admin.face_cleanup_manual_review_bulk_unmark',
    tipKey: 'admin.face_cleanup_action_unmark_tip',
    bodyKey: 'admin.face_cleanup_manual_review_help_unmark_body',
    effectKey: 'admin.face_cleanup_manual_review_help_unmark_effect',
    // A button WITH a glyph but WITHOUT a swatch — returning a face to `keep` is not a tile state.
    buttonIcon: mdiUndo,
    swatchColor: undefined,
    tone: 'default',
  },
};

const resolve = (key: ModalKey, mode: FaceReviewMode): Translations => (typeof key === 'string' ? key : key[mode]);

/** The ONLY way body copy is read — never reach into `bodyKey` directly, or a mode-dependent key leaks. */
export const bodyKeyFor = (id: FaceActionId, mode: FaceReviewMode): Translations =>
  resolve(FACE_ACTIONS[id].bodyKey, mode);

/** The ONLY way effect copy is read. Feeds both the help modal and the dock's hint row. */
export const effectKeyFor = (id: FaceActionId, mode: FaceReviewMode): Translations =>
  resolve(FACE_ACTIONS[id].effectKey, mode);

/**
 * The six ids that are also guided tile states. `keep`/`unmark` are excluded: they have no tile state, and
 * `STATE_COLOR`/`STATE_ICON` must not widen to include them (review.spec.ts pins their key sets).
 */
export const GUIDED_STATE_IDS = ['owner', 'other', 'stay', 'lock', 'detach', 'unknown'] as const;
