// Precision / negatives: the classifier must NOT fabricate a workflow for
// questions, chatter, or actionable-but-unsupported requests. All expect `none`
// (which then falls through to open orchestration). These run via the LLM, so
// they're repeated to measure precision, not a single lucky pass.
export default [
  // Questions ---------------------------------------------------------------
  { id: 'neg.q.count', category: 'negatives', prompt: 'how many photos are in my Family album?', expect: { kind: 'none' } },
  { id: 'neg.q.biggest', category: 'negatives', prompt: "what's my biggest album?", expect: { kind: 'none' } },
  { id: 'neg.q.where', category: 'negatives', prompt: 'which photos did I take in Paris?', expect: { kind: 'none' } },
  { id: 'neg.q.when', category: 'negatives', prompt: 'when did I last visit Italy?', expect: { kind: 'none' } },

  // Chatter / acknowledgements ----------------------------------------------
  { id: 'neg.chat.thanks', category: 'negatives', prompt: 'thanks, that looks great', expect: { kind: 'none' } },
  { id: 'neg.chat.okcool', category: 'negatives', prompt: 'ok cool', expect: { kind: 'none' } },
  { id: 'neg.chat.perfect', category: 'negatives', prompt: "that's perfect, thank you", expect: { kind: 'none' } },
  { id: 'neg.chat.weather', category: 'negatives', prompt: 'the weather is lovely today', expect: { kind: 'none' } },

  // Actionable but unsupported by any strict workflow (-> open orchestration) -
  { id: 'neg.unsup.favorite', category: 'negatives', prompt: 'favorite the best 3 photos from last weekend', expect: { kind: 'none' } },
  { id: 'neg.unsup.search', category: 'negatives', prompt: 'find my Sony photos from May', expect: { kind: 'none' } },
  { id: 'neg.unsup.rotate', category: 'negatives', prompt: 'rotate the sideways photos clockwise', expect: { kind: 'none' } },
  { id: 'neg.unsup.delete', category: 'negatives', prompt: 'delete the Family album', expect: { kind: 'none' } },

  // Subjective / out-of-scope arms of the new batch workflows -> none (decline) -
  { id: 'neg.archive.subjective', category: 'negatives', prompt: 'archive the best ones', expect: { kind: 'none' } },

  // Space workflows: questions and the photo-vs-member disambiguation ---------
  { id: 'neg.space.question', category: 'negatives', prompt: 'who has access to the Family space?', expect: { kind: 'none' } },
  {
    // A subjective album source declines (resolver would hand off anyway).
    id: 'neg.createalbum.subjective',
    category: 'negatives',
    prompt: 'make an album of the best photos',
    expect: { kind: 'none' },
  },

  // update_asset_metadata routing boundaries ---------------------------------
  {
    // Album describe stays with rename_or_describe_album (NOT update_asset_metadata).
    id: 'neg.metadata.album',
    category: 'negatives',
    prompt: 'set the description on the Family album to Summer',
    expect: { kind: 'rename_or_describe_album' },
  },
  {
    // Place-name location edit is now supported (B2: resolveLocation) → update_asset_metadata.
    id: 'neg.metadata.placename',
    category: 'negatives',
    prompt: 'set the location on these photos to Paris',
    expect: { kind: 'update_asset_metadata' },
  },
  {
    // "set Paris as the album cover" must NOT route to update_asset_metadata (no loose-asset source).
    id: 'neg.metadata.placename.cover',
    category: 'negatives',
    prompt: 'set Paris as the album cover',
    expect: { kind: 'none' },
  },
  {
    // Filename change is unsupported → none.
    id: 'neg.metadata.filename',
    category: 'negatives',
    prompt: 'change the filename on these photos to beach.jpg',
    expect: { kind: 'none' },
  },

  // manage_album_access boundaries -------------------------------------------
  {
    // Public-link album share must route to share_album, NOT manage_album_access.
    id: 'neg.albumaccess.link',
    category: 'negatives',
    prompt: 'share the Family album as a link',
    expect: { kind: 'share_album' },
  },
  {
    // Space target must route to manage_space_members, NOT manage_album_access.
    id: 'neg.albumaccess.space',
    category: 'negatives',
    prompt: 'add Alex to the Family space',
    expect: { kind: 'manage_space_members' },
  },
  {
    // Photo-source "share as a link" must route to share_assets, NOT manage_album_access.
    id: 'neg.albumaccess.photos-link',
    category: 'negatives',
    prompt: 'share my newest 20 photos as a link',
    expect: { kind: 'share_assets' },
  },
  {
    // Adding photos to an album must NOT route to manage_album_access (photo source guard).
    id: 'neg.albumaccess.photo-source',
    category: 'negatives',
    prompt: 'add these photos to the Family album',
    expect: { kind: 'add_photos_to_album' },
  },

  // manage_space_assets boundaries -------------------------------------------
  {
    // Adding a member (Alex) to a space must NOT route to manage_space_assets (photo op).
    id: 'neg.spaceassets.member',
    category: 'negatives',
    prompt: 'add Alex to the Family space',
    expect: { kind: 'manage_space_members' },
  },

  // move_photos_between_albums boundaries ------------------------------------
  {
    // No `from` album → not a move (bare "move … to …" must not match).
    id: 'neg.move.no-from',
    category: 'negatives',
    prompt: 'move my newest 20 photos to Keepers',
    expect: { kind: 'none' },
  },

  // remove_photos_from_album boundaries --------------------------------------
  {
    // Tag removal now owned by untag_assets — must NOT route to remove_photos_from_album.
    id: 'neg.remove.tag-not-album',
    category: 'negatives',
    prompt: 'remove my newest 20 from the Italy 2024 album',
    expect: { kind: 'remove_photos_from_album' },
  },
  {
    // Subjective source declines — the resolver would hand off anyway.
    id: 'neg.remove.subjective',
    category: 'negatives',
    prompt: 'remove the best ones from Family',
    expect: { kind: 'none' },
  },

  // share_album boundaries ---------------------------------------------------
  {
    // Asset-level share (no "album" noun) must NOT route to share_album → share_assets.
    id: 'neg.share-album.assets',
    category: 'negatives',
    prompt: 'share these photos as a link',
    expect: { kind: 'share_assets' },
  },

  // create_space_from_source boundaries -------------------------------------
  {
    // Subjective space source declines — must not route to create_space_from_source.
    id: 'neg.createspace.subjective',
    category: 'negatives',
    prompt: 'create a space of the best photos from last weekend',
    expect: { kind: 'none' },
  },

  // adjust_assets / flip_assets boundaries -----------------------------------
  {
    // rotate phrasing must NOT route to adjust_assets.
    id: 'neg.adjust.rotate',
    category: 'negatives',
    prompt: 'rotate these 90 clockwise',
    expect: { kind: 'rotate_assets' },
  },
  {
    // "upside down" must route to rotate_assets (180°), NOT flip_assets.
    id: 'neg.flip.upside-down',
    category: 'negatives',
    prompt: 'flip my photos upside down',
    expect: { kind: 'rotate_assets' },
  },
  {
    // Subjective source for adjust → none.
    id: 'neg.adjust.subjective',
    category: 'negatives',
    prompt: 'make these look amazing',
    expect: { kind: 'none' },
  },

  // rotate_assets boundaries -------------------------------------------------
  {
    // Subjective source declines — no metadata-describable set.
    id: 'neg.rotate.subjective',
    category: 'negatives',
    prompt: 'rotate the best ones 90 clockwise',
    expect: { kind: 'none' },
  },
  {
    // Bad angle (45 not in {90,180,270}) — declines.
    id: 'neg.rotate.badangle',
    category: 'negatives',
    prompt: 'rotate my newest 20 photos 45 clockwise',
    expect: { kind: 'none' },
  },

  // visual_cleanup boundaries ------------------------------------------------
  {
    // Plain trash has no quality keyword; it remains trash_assets.
    id: 'neg.visualcleanup.plain-trash',
    category: 'negatives',
    prompt: 'trash my newest 20 photos',
    expect: { kind: 'trash_assets' },
  },
  {
    // Duplicate keyword owns duplicate cleanup, even with a trash verb.
    id: 'neg.visualcleanup.duplicates',
    category: 'negatives',
    prompt: 'trash duplicate photos',
    expect: { kind: 'cleanup_duplicates' },
  },

  // restore_assets boundaries ------------------------------------------------
  {
    // Plain trash must NOT be stolen by restore_assets.
    id: 'neg.restore.trash-stays-trash',
    category: 'negatives',
    prompt: 'trash my newest 20',
    expect: { kind: 'trash_assets' },
  },
  {
    // Tag removal must NOT be stolen by restore_assets.
    id: 'neg.restore.untag-stays-untag',
    category: 'negatives',
    prompt: 'remove the Travel tag from my newest 20',
    expect: { kind: 'untag_assets' },
  },

  // crop_assets boundaries ---------------------------------------------------
  {
    // No geometry → crop without coordinates cannot plan → not crop_assets.
    id: 'neg.crop.no-geometry',
    category: 'negatives',
    prompt: 'crop this photo',
    expect: { kind: 'none' },
  },
  {
    // crop ≠ rotate: rotate phrasing must NOT route to crop_assets.
    id: 'neg.crop.not-rotate',
    category: 'negatives',
    prompt: 'rotate my newest 20 photos 90 clockwise',
    expect: { kind: 'rotate_assets' },
  },

  // set_album_cover boundaries -----------------------------------------------
  {
    // Subjective cover reference — no explicit position.
    id: 'neg.cover.subjective',
    category: 'negatives',
    prompt: 'pick a better cover for the Family album',
    expect: { kind: 'none' },
  },
  {
    // Cover reference unspecified — no "to <position>".
    id: 'neg.cover.unspecified',
    category: 'negatives',
    prompt: 'change the cover photo on my Italy album',
    expect: { kind: 'none' },
  },

  // stack_assets boundaries ---------------------------------------------------
  {
    // Subjective source — stack must not route subjective sources.
    id: 'neg.stack.subjective',
    category: 'negatives',
    prompt: 'stack the best ones',
    expect: { kind: 'none' },
  },
  {
    // Group without "into a stack" — must not steal "group by date" etc.
    id: 'neg.stack.group-no-into',
    category: 'negatives',
    prompt: 'group my photos by date',
    expect: { kind: 'none' },
  },

  // unstack_assets boundaries -------------------------------------------------
  {
    // Subjective source — unstack must not route subjective sources.
    id: 'neg.unstack.subjective',
    category: 'negatives',
    prompt: 'unstack the best ones',
    expect: { kind: 'none' },
  },

  // person workflow boundaries -------------------------------------------------
  {
    // rename_person must NOT steal album renames — these route to rename_or_describe_album.
    id: 'neg.person.rename-album',
    category: 'negatives',
    prompt: 'rename the Family album to Family 2026',
    expect: { kind: 'rename_or_describe_album' },
  },
  {
    // hide_person must NOT steal album hide prompts (container noun guard).
    id: 'neg.person.hide-album',
    category: 'negatives',
    prompt: 'hide the Family album',
    expect: { kind: 'none' },
  },
  {
    // merge_people must NOT match prompts about merging photos or albums (no person object).
    id: 'neg.person.merge-nopeople',
    category: 'negatives',
    prompt: 'merge duplicate photos',
    expect: { kind: 'cleanup_duplicates' },
  },

  // lock_assets boundaries ---------------------------------------------------
  {
    // "hide Alex" has no folder cue → hide_person, not lock_assets.
    id: 'neg.lock.hide-person',
    category: 'negatives',
    prompt: 'hide Alex',
    expect: { kind: 'hide_person' },
  },
  {
    // "archive these photos" → archive_assets, not lock_assets (different verb).
    id: 'neg.lock.archive-stays-archive',
    category: 'negatives',
    prompt: 'archive these photos',
    expect: { kind: 'archive_assets' },
  },
  {
    // Subjective source must decline (declineSourceFastPath).
    id: 'neg.lock.subjective',
    category: 'negatives',
    prompt: 'lock the best ones',
    expect: { kind: 'none' },
  },

  // change_member_role / change_album_member_role boundaries -----------------
  {
    // Album-role prompts must NOT route to change_member_role (it now declines "album").
    id: 'neg.role.album-to-albumrole',
    category: 'negatives',
    prompt: 'make Alex an editor on the Family album',
    expect: { kind: 'change_album_member_role' },
  },
  {
    // Space-role prompts must NOT route to change_album_member_role (it requires "album").
    id: 'neg.albumrole.space-to-role',
    category: 'negatives',
    prompt: 'make Alex an editor in the Family space',
    expect: { kind: 'change_member_role' },
  },
  {
    // Bare prompt (no album/space noun) must NOT route to change_album_member_role.
    id: 'neg.albumrole.bare-declined',
    category: 'negatives',
    prompt: 'make Alex an editor in Family',
    expect: { kind: 'change_member_role' },
  },
];
