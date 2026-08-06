import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkflowRegistry } from './registry.mjs';

// Regex-only registry (no LLM classifier) — locks in the cross-workflow routing
// precedence so a future fast-path change that introduces a collision fails here.
// LLM-mode recall is covered by the L1 eval battery.
const registry = createWorkflowRegistry();
const routeOf = async (prompt) => (await registry.classify(prompt)).kind;

const CASES = [
  // create_recent_trip_album vs create_album_from_source
  ['create an album for my recent trip to USA', 'create_recent_trip_album'],
  ['make an album for my recent trip', 'create_recent_trip_album'],
  ['make an album of my newest 50 photos', 'create_album_from_source'],
  ['create an album from my 2024 photos called Best of 2024', 'create_album_from_source'],
  ['build an album of my newest 100 photos', 'create_album_from_source'],
  // add_photos_to_album (album target, no "space" keyword)
  ['add my newest 20 photos to Family', 'add_photos_to_album'],
  ['add my Berlin photos from last weekend to the Trips album', 'add_photos_to_album'],
  // manage_space_assets (photo add/remove to a "space" target)
  ['add my newest 20 photos to the Family space', 'manage_space_assets'],
  ['remove my screenshots from the Family space', 'manage_space_assets'],
  // archive_assets
  ['archive my newest 50 photos', 'archive_assets'],
  ['unarchive my last 10 photos', 'archive_assets'],
  ['move my 2024 photos out of the archive', 'archive_assets'],
  // favorite_assets (incl. "add … to my favorites")
  ['favorite my newest 10 photos', 'favorite_assets'],
  ['unfavorite my last 5 photos', 'favorite_assets'],
  ['add my newest 20 photos to my favorites', 'favorite_assets'],
  // tag_assets (incl. "add the tag … to …" — not an album add)
  ['tag my newest 20 photos as Travel', 'tag_assets'],
  ['add the tag Spring Break to my newest 50 photos', 'tag_assets'],
  ['add the Travel tag to my last 10 photos', 'tag_assets'],
  // rename_or_describe_space vs rename_or_describe_album (the space-keyword gate)
  ['rename the Family space to Family 2026', 'rename_or_describe_space'],
  ['set the description on the Trips space to Our adventures', 'rename_or_describe_space'],
  ['rename the Family album to Family 2026', 'rename_or_describe_album'],
  ['set the description on my Italy album to Summer 2026', 'rename_or_describe_album'],
  // manage_album_access (album keyword gate; must not steal space/photo ops)
  ['share the Family album with Alex', 'manage_album_access'],
  ['give Alex edit access to the Beach album', 'manage_album_access'],
  ['remove Sam from the Beach album', 'manage_album_access'],
  // manage_album_access must NOT steal link-share (share_album) or space-member (manage_space_members)
  ['share the Family album as a link', 'share_album'],
  ['add Alex to the Family space', 'manage_space_members'],
  // manage_space_members
  ['add Alex to the Family space as editor', 'manage_space_members'],
  ['remove Bob from the Trips space', 'manage_space_members'],
  ['add Sam and Jo to the Family space', 'manage_space_members'],
  // change_album_member_role (requires "album" in target; declines "space")
  ['make Alex an editor on the Family album', 'change_album_member_role'],
  ["change Bob's role to viewer in the Beach album", 'change_album_member_role'],
  // change_album_member_role must NOT steal space targets
  ['make Alex an editor in the Family space', 'change_member_role'],
  // change_member_role
  ['make Alex an editor in Family', 'change_member_role'],
  ["change Bob's role to viewer in Trips", 'change_member_role'],
  ['make Sam a viewer in the Family space', 'change_member_role'],
  // change_member_role must NOT steal album targets
  ['make Alex an editor on the Family album', 'change_album_member_role'],
  // update_asset_metadata (loose-asset metadata edits — not album or space)
  ['set the description on my newest 20 photos to Berlin', 'update_asset_metadata'],
  ['rate my newest 12 photos five stars', 'update_asset_metadata'],
  ['set the timezone on my newest 20 photos to Europe/Berlin', 'update_asset_metadata'],
  // rename_or_describe_album wins over update_asset_metadata for album refs
  ['set the description on the Family album to Summer 2026', 'rename_or_describe_album'],
  // place-name-only location edit → none (not a supported asset-metadata edit)
  ['set these photos to Paris', 'none'],
  // move_photos_between_albums (compound move: requires both `from` and `to`)
  ['move my newest 20 photos from Drafts to Keepers', 'move_photos_between_albums'],
  ['move my photos from 2024 from the Trips album to the Italy album', 'move_photos_between_albums'],
  // move_photos_between_albums must NOT steal archive's "move out of archive" (archive first)
  ['move my 2024 photos out of the archive', 'archive_assets'],
  // move without `from` → none (regex gate: both from and to required)
  ['move my newest 20 to Keepers', 'none'],
  // remove_photos_from_album
  ['remove my newest 20 photos from Family', 'remove_photos_from_album'],
  ['take my newest 20 photos out of the Family album', 'remove_photos_from_album'],
  ['remove my Berlin photos from last weekend from the Trips album', 'remove_photos_from_album'],
  // collision guards (remove_photos_from_album must NOT steal these)
  ['remove Bob from the Family space', 'manage_space_members'],
  ['remove my newest 20 from my favorites', 'favorite_assets'],
  // create_space_from_source vs create_album_from_source / manage_space_assets / manage_space_members
  ['make a Family space of my newest 50 photos', 'create_space_from_source'],
  ['create a shared space from my 2024 photos', 'create_space_from_source'],
  // rotate_assets (explicit angle required; subjective source → none)
  ['rotate my newest 20 photos 90 clockwise', 'rotate_assets'],
  ['flip my newest 5 photos upside down', 'rotate_assets'],
  // crop_assets (explicit geometry required; no geometry → none at regex path)
  ['crop this photo to 100,100,800,600', 'crop_assets'],
  ['crop this image to 0,0,1000,1000', 'crop_assets'],
  // set_album_cover
  ['set the cover of the Family album to the 3rd photo', 'set_album_cover'],
  ['make the Family album cover the first photo', 'set_album_cover'],
  // --- cross-cutting seam sweep (slice 21) -------------------------------------
  // Verb/phrasing variants must each land on exactly one kind. The load-bearing
  // seams: the four "remove … from …" owners (remove_photos_from_album,
  // manage_space_assets[remove], manage_space_members, favorite_assets), the two
  // "set the <field> …" owners (update_asset_metadata vs rename_or_describe_*), and
  // the three create-verb owners (album / space / recent-trip).
  ['put my newest 20 photos into the Family space', 'manage_space_assets'],
  ['pull my screenshots out of the Trips space', 'manage_space_assets'],
  ['turn my newest 20 photos 180', 'rotate_assets'],
  ['make a space from my newest 50 photos called Trips', 'create_space_from_source'],
  ['remove my newest 20 from Family', 'remove_photos_from_album'],
  ['set the rating on my last 10 photos to 4', 'update_asset_metadata'],
  ['use the cover of the Family album to the last photo', 'set_album_cover'],
  // none (subjective / out-of-scope / chatter decline at the regex fast-path)
  ['archive the best ones', 'none'],
  ['favorite the best 3 photos from last weekend', 'none'],
  ['remove the Travel tag from my newest 20', 'untag_assets'],
  ['remove tag Spring Break from my last 50 photos', 'untag_assets'],
  ['untag my newest 20 as Travel', 'untag_assets'],
  // untag requires the literal "tag" token; album/space/favorite removals keep theirs
  ['remove my newest 20 from the Italy album', 'remove_photos_from_album'],
  // upload-dated sources do not change verb-routing (resolver bounds at run time)
  ['archive everything I uploaded today', 'archive_assets'],
  ['tag my recent uploads as Imported', 'tag_assets'],
  // cleanup_duplicates (duplicate keyword required; wins over trash_assets for dup prompts)
  ['clean up my duplicate photos', 'cleanup_duplicates'],
  ['trash duplicate photos', 'cleanup_duplicates'],
  ['find and remove duplicates', 'cleanup_duplicates'],
  ['dedupe my library', 'cleanup_duplicates'],
  // visual_cleanup (quality keyword required; wins over generic trash for objective quality)
  ['trash my blurry photos', 'visual_cleanup'],
  ['remove blurry photos from my last 100 uploaded photos', 'visual_cleanup'],
  ['delete dark photos from my recent uploads', 'visual_cleanup'],
  ['cleanup low-quality photos from last month', 'visual_cleanup'],
  // trash_assets (explicit trash/bin/delete/move-to-trash verb; container and subjective decline)
  ['trash my newest 20 photos', 'trash_assets'],
  ['delete my 2024 screenshots', 'trash_assets'],
  ['move my newest 50 photos to the trash', 'trash_assets'],
  // delete_album (album-container deletion; declines photo-deletion, space deletion)
  ['delete the Beach album', 'delete_album'],
  ['remove the Trip album', 'delete_album'],
  ['get rid of the Family album', 'delete_album'],
  // delete_album must NOT steal photo-deletion or space intents
  // "delete the photos in the Beach album" → none (trash declines via container-end guard; delete_album declines via photo-source guard)
  ['delete the photos in the Beach album', 'none'],
  // "delete the Beach album photos" → trash_assets (source ends with "photos", not "album")
  ['delete the Beach album photos', 'trash_assets'],
  // "delete the Family space" → delete_space (delete_album declines space targets)
  ['delete the Family space', 'delete_space'],
  // delete_space (space-container deletion; declines photo-deletion, album deletion)
  ['delete the Trip space', 'delete_space'],
  ['remove the Beach space', 'delete_space'],
  ['get rid of the Vacations space', 'delete_space'],
  // delete_space must NOT steal photo-deletion, album deletion, or in-frame intents
  ['delete the photos in the Family space', 'none'],
  ['delete the Family album', 'delete_album'],
  // trash_assets must NOT steal album-container prompts (container-source guard)
  ['trash the best ones', 'none'],
  ['make an album of the best photos', 'none'],
  ['how many photos do I have?', 'none'],
  ['thanks, that looks great', 'none'],
  // restore_assets (restore/recover/untrash/bring-back verbs; disjoint from trash)
  ['restore my newest 20 from trash', 'restore_assets'],
  ['recover the photos I just trashed', 'restore_assets'],
  ['untrash these photos', 'restore_assets'],
  // restore_assets must NOT steal trash_assets or untag_assets
  ['trash my newest 20', 'trash_assets'],
  ['remove the Travel tag from my newest 20', 'untag_assets'],
  // share_album (album-targeted, outward-facing, propose-only; requires "album" noun)
  ['share the Family album as a link', 'share_album'],
  ['create a share link for the Italy album', 'share_album'],
  ['make a shareable link for the Trips album', 'share_album'],
  // share_assets (outward-facing, propose-only; share verb + link/shareable)
  ['share these photos as a link', 'share_assets'],
  ['create a share link for my newest 20', 'share_assets'],
  ['make a shareable link for these, expires in 7 days', 'share_assets'],
  // share_album must NOT steal asset-level share (no album noun)
  ['share my newest 20 as a link', 'share_assets'],
  // share_assets must NOT steal trash/archive/rotate
  ['trash my newest 20 photos', 'trash_assets'],
  ['archive my newest 50 photos', 'archive_assets'],
  // stack_assets (stack/group-into-a-stack verb; subjective source declines)
  ['stack my newest 10 photos', 'stack_assets'],
  ['group my newest 5 photos into a stack', 'stack_assets'],
  // unstack_assets (unstack/un-stack/ungroup verb; disjoint from stack_assets)
  ['unstack my newest 10 photos', 'unstack_assets'],
  ['un-stack my photos from 2024', 'unstack_assets'],
  ['ungroup my newest 5 photos', 'unstack_assets'],
  // stack_assets must NOT steal unstack
  ['unstack my newest 10 photos', 'unstack_assets'],
  // rename_person (person target; container noun → space/album rename wins)
  ['Rename Alejandra to Karina', 'rename_person'],
  ['rename alex to alexander', 'rename_person'],
  // rename_person must NOT steal album/space renames (container noun guard wins)
  ['rename the Family album to Family 2026', 'rename_or_describe_album'],
  ['rename the Family space to Family 2026', 'rename_or_describe_space'],
  // set_person_birthdate (birthday/birthdate/date of birth + possessive pattern)
  ["set Alex's birthday to 1990-05-01", 'set_person_birthdate'],
  ["set Alex's date of birth to May 1 1990", 'set_person_birthdate'],
  // hide_person (hide/unhide/show verb; container noun → none)
  ['hide Alex', 'hide_person'],
  ['unhide Alex', 'hide_person'],
  ['show Alex', 'hide_person'],
  // hide_person must NOT steal album hide prompts (container noun guard)
  ['hide the Family album', 'none'],
  // merge_people (merge verb + into/and + two person names)
  ['merge Alejandra into Karina', 'merge_people'],
  ['merge Alex and Karina', 'merge_people'],
  // adjust_assets (tonal/enhance verbs; excludes flip/rotate/crop)
  ['brighten my last 10 photos', 'adjust_assets'],
  ['make these more vivid', 'adjust_assets'],
  ['auto-enhance my newest 5', 'adjust_assets'],
  // adjust_assets must NOT steal rotate/flip/crop
  ['rotate these 90 clockwise', 'rotate_assets'],
  ['flip my photos upside down', 'rotate_assets'],
  // flip_assets (flip/mirror verb; excludes upside-down, rotate, crop)
  ['flip my newest 5 photos horizontally', 'flip_assets'],
  ['mirror these', 'flip_assets'],
  // flip_assets must NOT steal "upside down" (rotate_assets owns it)
  ['flip my newest 5 photos upside down', 'rotate_assets'],
  // lock_assets (lock verb or locked/private folder cue; folder cue gates HIDE_IN_LOCKED)
  ['lock my passport scans', 'lock_assets'],
  ['move my 2024 receipts to the locked folder', 'lock_assets'],
  ['put these in my private folder', 'lock_assets'],
  ['hide these in the locked folder', 'lock_assets'],
  // lock_assets must NOT steal hide_person ("hide Alex" has no folder cue)
  ['hide Alex', 'hide_person'],
  // lock_assets must NOT steal archive_assets
  ['archive my newest 50 photos', 'archive_assets'],
  // lock the best ones (subjective) → none
  ['lock the best ones', 'none'],
];

describe('cross-workflow disambiguation (regex fast-path)', () => {
  for (const [prompt, kind] of CASES) {
    it(`routes "${prompt}" → ${kind}`, async () => {
      assert.equal(await routeOf(prompt), kind);
    });
  }

  it('exercises every registered workflow kind at least once', () => {
    const registeredKinds = new Set(registry.listWorkflows().map((w) => w.kind));
    const coveredKinds = new Set(CASES.map(([, kind]) => kind).filter((k) => k !== 'none'));
    for (const kind of registeredKinds) {
      assert.ok(coveredKinds.has(kind), `disambiguation table is missing a case for ${kind}`);
    }
  });
});
