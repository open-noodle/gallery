import { addPhotosToAlbumWorkflow } from './workflows/add-photos-to-album.mjs';
import { archiveAssetsWorkflow } from './workflows/archive-assets.mjs';
import { changeAlbumMemberRoleWorkflow } from './workflows/change-album-member-role.mjs';
import { changeMemberRoleWorkflow } from './workflows/change-member-role.mjs';
import { cleanupDuplicatesWorkflow } from './workflows/cleanup-duplicates.mjs';
import { createAlbumFromSourceWorkflow } from './workflows/create-album-from-source.mjs';
import { createRecentTripAlbumWorkflow } from './workflows/create-recent-trip-album.mjs';
import { createSpaceFromSourceWorkflow } from './workflows/create-space-from-source.mjs';
import { favoriteAssetsWorkflow } from './workflows/favorite-assets.mjs';
import { manageSpaceAssetsWorkflow } from './workflows/manage-space-assets.mjs';
import { manageAlbumAccessWorkflow } from './workflows/manage-album-access.mjs';
import { manageSpaceMembersWorkflow } from './workflows/manage-space-members.mjs';
import { movePhotosBetweenAlbumsWorkflow } from './workflows/move-photos-between-albums.mjs';
import { removePhotosFromAlbumWorkflow } from './workflows/remove-photos-from-album.mjs';
import { renameOrDescribeAlbumWorkflow } from './workflows/rename-or-describe-album.mjs';
import { renameOrDescribeSpaceWorkflow } from './workflows/rename-or-describe-space.mjs';
import { setAlbumCoverWorkflow } from './workflows/set-album-cover.mjs';
import { tagAssetsWorkflow } from './workflows/tag-assets.mjs';
import { trashAssetsWorkflow } from './workflows/trash-assets.mjs';
import { restoreAssetsWorkflow } from './workflows/restore-assets.mjs';
import { untagAssetsWorkflow } from './workflows/untag-assets.mjs';
import { visualCleanupWorkflow } from './workflows/visual-cleanup.mjs';
import { adjustAssetsWorkflow } from './workflows/adjust-assets.mjs';
import { cropAssetsWorkflow } from './workflows/crop-assets.mjs';
import { flipAssetsWorkflow } from './workflows/flip-assets.mjs';
import { rotateAssetsWorkflow } from './workflows/rotate-assets.mjs';
import { shareAlbumWorkflow } from './workflows/share-album.mjs';
import { shareAssetsWorkflow } from './workflows/share-assets.mjs';
import { stackAssetsWorkflow } from './workflows/stack-assets.mjs';
import { unstackAssetsWorkflow } from './workflows/unstack-assets.mjs';
import { updateAssetMetadataWorkflow } from './workflows/update-asset-metadata.mjs';
import { renamePersonWorkflow } from './workflows/rename-person.mjs';
import { setPersonBirthdateWorkflow } from './workflows/set-person-birthdate.mjs';
import { hidePersonWorkflow } from './workflows/hide-person.mjs';
import { lockAssetsWorkflow } from './workflows/lock-assets.mjs';
import { deleteAlbumWorkflow } from './workflows/delete-album.mjs';
import { deleteSpaceWorkflow } from './workflows/delete-space.mjs';
import { mergePeopleWorkflow } from './workflows/merge-people.mjs';

// Workflow factories keyed by kind. Adding a workflow is a registry entry, not a
// runtime edit. Registering here makes a workflow both regex-routable (each
// `match`) AND visible to the LLM classifier (via `listWorkflows`/manifest).
//
// Order matters for the regex fast-path (first match wins):
//   - `rename_or_describe_space` BEFORE `rename_or_describe_album` so the strict
//     `space`-keyword gate wins "rename the X space …" (album declines those).
//   - `manage_album_access` BEFORE `manage_space_members`: album-user ops are gated
//     by the "album" keyword; space-member ops are gated by "space". Both are first
//     placed before the photo-add workflows so member adds never fall to add_photos_*.
//   - `change_album_member_role` BEFORE `change_member_role`: the album variant
//     requires "album" in the target and change_member_role now declines album
//     targets; placing the album variant first gives it priority in the fast-path.
//   - `manage_space_members` / `change_member_role` BEFORE `manage_space_assets` so
//     member ops (people) win over asset ops (photos) for space targets.
//   - `manage_space_assets` BEFORE `add_photos_to_album` so "add <photos> to the X
//     space" routes to the space workflow, not the album one.
//   - `favorite_assets` / `tag_assets` / `untag_assets` / `manage_space_members`
//     BEFORE `remove_photos_from_album` so "remove … from my favorites" →
//     favorite_assets, "remove Bob from the Family space" → manage_space_members,
//     "remove the Travel tag …" → untag_assets (requires the literal `tag` token;
//     never steals favorite/space/member removals which have no `tag` token).
//   - `move_photos_between_albums` BEFORE `remove_photos_from_album` and
//     `add_photos_to_album` (distinct `move … from … to …` shape; requires
//     both `from` and `to`; never stolen by the add/remove patterns).
//   - `remove_photos_from_album` AFTER `favorite_assets`/`tag_assets`/
//     `untag_assets`/`manage_space_members`, BEFORE `manage_space_assets`/
//     `add_photos_to_album`.
//   - `add_photos_to_album` stays LAST so its "add <source> to <album>" pattern
//     never steals "add the tag <tag> to <source>" (tag_assets) or member adds.
//   - `update_asset_metadata` after `rename_or_describe_*` so album/space describe
//     wins their refs; it declines album/space refs.
//   - `create_album_from_source` and `create_space_from_source` are grouped as
//     create-verb workflows. `create_album_from_source` comes first so "album"
//     prompts are not stolen; `create_space_from_source` immediately follows and
//     its inline-name form discriminates via the "space" noun.
//   - `cleanup_duplicates` BEFORE `trash_assets` so "trash duplicates" / "delete
//     duplicate photos" routes to cleanup (the duplicate keyword wins), not to
//     the generic trash workflow. Both require a trash/delete verb but
//     cleanup_duplicates requires the additional "duplicate(s)/dupe(s)" keyword.
//   - `visual_cleanup` BEFORE `trash_assets` so objective-quality cleanup
//     ("trash blurry photos", "delete dark uploads") uses quality filters instead
//     of the generic trash source resolver.
//   - `trash_assets` is adjacent to `archive_assets` (both source-state workflows).
//     Its distinct verbs (trash/delete/bin/move-to-trash) do not collide with
//     `remove_photos_from_album` ("remove … from") or `untag_assets` ("remove … tag").
//   - `restore_assets` is placed immediately after `trash_assets` (complementary
//     inverse operation: restore/recover/untrash). Its verbs (restore/recover/
//     untrash/bring-back) are fully disjoint from the trash verb set, so ordering
//     relative to trash does not matter for the regex fast-path, but adjacency
//     groups the two lifecycle-state workflows together for readability.
//   - `crop_assets` is placed adjacent to `rotate_assets` (both image-edit
//     workflows). Its verb (`crop`) is fully disjoint from rotate/flip/spin, so
//     ordering relative to rotate does not matter for the regex fast-path, but
//     adjacency groups the two image-edit workflows together for readability.
//     `crop_assets` requires EXPLICIT geometry — no geometry → needs_input.
//   - `unstack_assets` is placed BEFORE `stack_assets` because the hyphenated
//     form "un-stack" creates a word boundary before "stack" (the hyphen is a
//     non-word character), so `\bstack` would otherwise match "un-stack" before
//     the unstack workflow gets a turn. `unstack_assets` wins first and the
//     stack workflow never sees an unstack prompt.
//   - `stack_assets` and `unstack_assets` are placed adjacent to `crop_assets`
//     and `rotate_assets` (all four are asset-level transform workflows). Their
//     verbs (`stack`/`group…into a stack`, `unstack`/`un-stack`/`ungroup`) are
//     fully disjoint from rotate/flip/crop, but adjacency groups them together.
//     `stack_assets` gates on assetCount >= 2 at run time (not at match).
//   - `share_assets` is placed after `trash_assets`/`restore_assets` (all three
//     operate on a resolved asset source and route via proposeAlbumOperations).
//     The share verbs ("share … as a link", "create a share link for …") are
//     fully disjoint from trash/archive/rotate/crop, so ordering relative to
//     those does not matter for the regex fast-path. OUTWARD-FACING and High
//     risk; propose-only (createSharedLinks scope defaults false in every
//     preset); see OQ-F2.
const WORKFLOW_FACTORIES = Object.freeze([
  createRecentTripAlbumWorkflow,
  createAlbumFromSourceWorkflow,
  createSpaceFromSourceWorkflow,
  renameOrDescribeSpaceWorkflow,
  renamePersonWorkflow,
  renameOrDescribeAlbumWorkflow,
  setPersonBirthdateWorkflow,
  //   - `lock_assets` is placed BEFORE `hide_person`. The
  //     `hide … in (the/my) locked|private folder` pattern requires an explicit
  //     folder cue, so it must win over `hide_person` (which has no folder-cue
  //     guard and would otherwise claim "hide these in the locked folder" as a
  //     personRef). The `lock`, `move/put/add … to/in the locked/private folder`
  //     patterns are fully disjoint from archive/trash verbs.
  lockAssetsWorkflow,
  hidePersonWorkflow,
  //   - `merge_people` is placed after hide_person (all people workflows grouped).
  //     Its distinct `merge … into …` / `merge … and …` verb+preposition shape is
  //     fully disjoint from rename/set-birthdate/hide, so ordering within the
  //     people group does not matter for the regex fast-path.
  mergePeopleWorkflow,
  setAlbumCoverWorkflow,
  //   - `delete_album` is placed BEFORE `trash_assets`. trash_assets already
  //     declines container-ending sources via `containerSourcePattern`, so
  //     "delete the Beach album" is ceded regardless of order — but placing
  //     delete_album first makes the intent explicit and ensures the strict
  //     album-delete path wins without relying on trash_assets' fast-path decline.
  //   - `delete_space` is placed immediately after `delete_album` (both are
  //     container-delete workflows). `delete_album` declines "space" targets and
  //     `delete_space` declines "album" targets — the two are mutually exclusive.
  //     Both are placed before `trash_assets` for the same container-cede reason.
  deleteAlbumWorkflow,
  deleteSpaceWorkflow,
  archiveAssetsWorkflow,
  cleanupDuplicatesWorkflow,
  visualCleanupWorkflow,
  trashAssetsWorkflow,
  restoreAssetsWorkflow,
  //   - `share_album` BEFORE `share_assets` (container-noun gate: share_album
  //     requires the literal "album" noun; share_assets declines when the source
  //     ends with "album" or "space", so no collision — but share_album must win
  //     first to avoid share_assets consuming album-level share prompts before
  //     the album gate fires). OUTWARD-FACING and High risk; propose-only.
  shareAlbumWorkflow,
  shareAssetsWorkflow,
  favoriteAssetsWorkflow,
  tagAssetsWorkflow,
  untagAssetsWorkflow,
  updateAssetMetadataWorkflow,
  rotateAssetsWorkflow,
  cropAssetsWorkflow,
  adjustAssetsWorkflow,
  flipAssetsWorkflow,
  unstackAssetsWorkflow,
  stackAssetsWorkflow,
  manageAlbumAccessWorkflow,
  manageSpaceMembersWorkflow,
  changeAlbumMemberRoleWorkflow,
  changeMemberRoleWorkflow,
  movePhotosBetweenAlbumsWorkflow,
  removePhotosFromAlbumWorkflow,
  manageSpaceAssetsWorkflow,
  addPhotosToAlbumWorkflow,
]);

// Regex-only fallback classifier, used when no LLM classifier is injected
// (e2e-runtime, dispatcher unit tests). Keeps `classify` deterministic and
// model-free so those callers never reach a provider.
const createRegexClassifier = (workflows) => ({
  async classify(prompt) {
    for (const workflow of workflows.values()) {
      const matched = workflow.match(prompt);
      if (matched) {
        return { kind: workflow.kind, ...matched, via: 'regex', confidence: 'high' };
      }
    }
    return { kind: 'none', via: 'regex' };
  },
});

// `classifier` is the Slice 4 LLM intent classifier (regex fast-path → LLM
// structured classify → parseSlots). When omitted, the registry stays regex-only
// so Slice 3 dispatcher tests and the e2e runtime keep working without a model.
export const createWorkflowRegistry = ({ classifier } = {}) => {
  const workflows = new Map();
  for (const factory of WORKFLOW_FACTORIES) {
    const workflow = factory();
    workflows.set(workflow.kind, workflow);
  }

  const activeClassifier = classifier ?? createRegexClassifier(workflows);

  return {
    getWorkflow(kind) {
      return workflows.get(kind);
    },

    listWorkflows() {
      return [...workflows.values()];
    },

    // Delegates to the injected classifier (or the regex-only fallback). Returns
    // `{ kind, slots? }` or `{ kind: 'none' }`. The dispatcher then runs
    // `parseSlots` before any execution.
    classify(prompt, options) {
      return activeClassifier.classify(prompt, options);
    },
  };
};
