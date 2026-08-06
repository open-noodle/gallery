// Slot fidelity: exact normalized slot values. Most of these hit the regex
// fast-path (deterministic), so they lock the extractor + alias normalization;
// a couple force the LLM path to check it produces usable, correctly-keyed slots.
export default [
  {
    id: 'slots.usa.alias.unitedstates',
    category: 'slots',
    prompt: 'Create an album for my recent trip to United States',
    expect: { kind: 'create_recent_trip_album', slots: { placeHint: 'USA', albumName: 'USA Trip' } },
  },
  {
    id: 'slots.usa.alias.us-dot',
    category: 'slots',
    prompt: 'Create an album for my recent trip to U.S.',
    expect: { kind: 'create_recent_trip_album', slots: { placeHint: 'USA' } },
  },
  {
    id: 'slots.usa.alias.the-united-states',
    category: 'slots',
    prompt: 'Create an album for my recent trip to the United States',
    expect: { kind: 'create_recent_trip_album', slots: { placeHint: 'USA' } },
  },
  {
    id: 'slots.trip.place-and-name',
    category: 'slots',
    prompt: 'Create an album for my recent trip to USA called Spring Break',
    expect: { kind: 'create_recent_trip_album', slots: { placeHint: 'USA', albumName: 'Spring Break' } },
  },
  {
    id: 'slots.trip.quoted-name',
    category: 'slots',
    prompt: 'Create an album for my recent trip called "Bob\'s Vacation"',
    expect: { kind: 'create_recent_trip_album', slots: { albumName: "Bob's Vacation" } },
  },
  {
    id: 'slots.trip.default-name',
    category: 'slots',
    prompt: 'Make an album for my recent trip',
    expect: { kind: 'create_recent_trip_album', slots: { albumName: 'Recent Trip' } },
  },
  {
    id: 'slots.rename.ref-and-name',
    category: 'slots',
    prompt: 'rename the Family album to Family 2026',
    expect: { kind: 'rename_or_describe_album', slots: { albumRef: 'Family', newName: 'Family 2026' } },
  },
  {
    id: 'slots.archive.unarchive-polarity',
    category: 'slots',
    prompt: 'unarchive my newest 5 photos',
    expect: { kind: 'archive_assets', slots: { archived: false, sourceDescription: 'my newest 5 photos' } },
  },
  {
    id: 'slots.favorite.polarity',
    category: 'slots',
    prompt: 'unfavorite my newest 5 photos',
    expect: { kind: 'favorite_assets', slots: { favorite: false, sourceDescription: 'my newest 5 photos' } },
  },
  {
    id: 'slots.tag.quoted-name',
    category: 'slots',
    prompt: 'tag my newest 20 as "Spring Break"',
    expect: { kind: 'tag_assets', slots: { tagName: 'Spring Break', sourceDescription: 'my newest 20' } },
  },
  {
    id: 'slots.trash.canonical',
    category: 'slots',
    prompt: 'trash my newest 20 photos',
    expect: { kind: 'trash_assets', slots: { sourceDescription: 'my newest 20 photos' } },
  },
  {
    id: 'slots.lock.canonical',
    category: 'slots',
    prompt: 'lock my passport scans',
    expect: { kind: 'lock_assets', slots: { sourceDescription: 'my passport scans' } },
  },
  {
    id: 'slots.lock.move-to-locked-folder',
    category: 'slots',
    prompt: 'move my 2024 receipts to the locked folder',
    expect: { kind: 'lock_assets', slots: { sourceDescription: 'my 2024 receipts' } },
  },
  {
    id: 'slots.untag.canonical',
    category: 'slots',
    prompt: 'remove the Travel tag from my newest 20',
    expect: { kind: 'untag_assets', slots: { tagName: 'Travel', sourceDescription: 'my newest 20' } },
  },
  {
    id: 'slots.albumaccess.role-default',
    category: 'slots',
    prompt: 'share the Family album with Alex',
    expect: { kind: 'manage_album_access', slots: { action: 'add', role: 'viewer', albumRef: 'Family' } },
  },
  {
    id: 'slots.albumaccess.editor-synonym',
    category: 'slots',
    prompt: 'give Alex edit access to the Trip album',
    expect: { kind: 'manage_album_access', slots: { action: 'add', role: 'editor', albumRef: 'Trip' } },
  },
  {
    id: 'slots.members.role-default',
    category: 'slots',
    prompt: 'add Alex to the Family space',
    expect: { kind: 'manage_space_members', slots: { action: 'add', role: 'viewer', spaceRef: 'Family' } },
  },
  {
    id: 'slots.role.synonym',
    category: 'slots',
    prompt: 'make Alex a contributor in Family',
    expect: { kind: 'change_member_role', slots: { role: 'editor', spaceRef: 'Family' } },
  },
  {
    id: 'slots.albumrole.synonym',
    category: 'slots',
    prompt: 'make Alex a contributor on the Family album',
    expect: { kind: 'change_album_member_role', slots: { role: 'editor', albumRef: 'Family' } },
  },
  {
    id: 'slots.albumrole.viewer',
    category: 'slots',
    prompt: 'make Alex a reader on the Beach album',
    expect: { kind: 'change_album_member_role', slots: { role: 'viewer', albumRef: 'Beach' } },
  },
  {
    id: 'slots.createalbum.default-name',
    category: 'slots',
    prompt: 'make an album of my newest 50 photos',
    expect: { kind: 'create_album_from_source', slots: { sourceDescription: 'my newest 50 photos', albumName: 'New Album' } },
  },
  {
    id: 'slots.archive.entity',
    category: 'slots',
    prompt: 'archive my Berlin photos',
    expect: { kind: 'archive_assets', slots: { archived: true, sourceDescription: 'my Berlin photos' } },
  },
  {
    id: 'slots.metadata.describe',
    category: 'slots',
    prompt: 'set the description on my newest 20 photos to Berlin weekend',
    expect: { kind: 'update_asset_metadata', slots: { sourceDescription: 'my newest 20 photos' } },
  },
  {
    id: 'slots.move.from-to',
    category: 'slots',
    prompt: 'move my newest 20 photos from Drafts to Keepers',
    expect: { kind: 'move_photos_between_albums', slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' } },
  },
  {
    id: 'slots.remove.canonical',
    category: 'slots',
    prompt: 'remove my newest 5 photos from Family',
    expect: { kind: 'remove_photos_from_album', slots: { albumRef: 'Family', sourceDescription: 'my newest 5 photos' } },
  },
  {
    id: 'slots.spaceassets.remove',
    category: 'slots',
    prompt: 'remove my newest 20 photos from the Family space',
    expect: { kind: 'manage_space_assets', slots: { action: 'remove', spaceRef: 'Family', sourceDescription: 'my newest 20 photos' } },
  },
  {
    id: 'slots.createspace.default-name',
    category: 'slots',
    prompt: 'create a space from my 2024 photos',
    expect: { kind: 'create_space_from_source', slots: { sourceDescription: 'my 2024 photos' } },
  },
  {
    id: 'slots.rotate.ccw-polarity',
    category: 'slots',
    prompt: 'rotate my newest 5 photos 90 counterclockwise',
    expect: { kind: 'rotate_assets', slots: { angle: 270, sourceDescription: 'my newest 5 photos' } },
  },
  {
    id: 'slots.cover.index',
    category: 'slots',
    prompt: 'set the cover of the Family album to the 3rd photo',
    expect: { kind: 'set_album_cover', slots: { albumRef: 'Family', coverRef: /3rd|third/i } },
  },

  // share_album ---------------------------------------------------------------
  {
    id: 'slots.share-album.ref',
    category: 'slots',
    prompt: 'share the Family album as a link',
    expect: { kind: 'share_album', slots: { albumRef: 'Family' } },
  },
  {
    id: 'slots.share-album.expiry',
    category: 'slots',
    prompt: 'share the Italy album as a link, expires in 7 days',
    expect: { kind: 'share_album', slots: { albumRef: 'Italy', expiryDays: 7 } },
  },

  // stack_assets ---------------------------------------------------------------
  {
    id: 'slots.stack.source',
    category: 'slots',
    prompt: 'stack my photos from Berlin',
    expect: { kind: 'stack_assets', slots: { sourceDescription: /berlin/i } },
  },

  // unstack_assets -------------------------------------------------------------
  {
    id: 'slots.unstack.source',
    category: 'slots',
    prompt: 'unstack my photos from Berlin',
    expect: { kind: 'unstack_assets', slots: { sourceDescription: /berlin/i } },
  },

  // adjust_assets ---------------------------------------------------------------
  {
    id: 'slots.adjust.contrast-strong',
    category: 'slots',
    prompt: 'increase contrast a lot on these',
    expect: { kind: 'adjust_assets', slots: { params: { contrast: 'strong_increase' } } },
  },
  {
    id: 'slots.adjust.auto-enhance',
    category: 'slots',
    prompt: 'auto-enhance my newest 5',
    expect: { kind: 'adjust_assets', slots: { params: { autoEnhance: true } } },
  },

  // flip_assets ----------------------------------------------------------------
  {
    id: 'slots.flip.vertical',
    category: 'slots',
    prompt: 'flip these vertically',
    expect: { kind: 'flip_assets', slots: { axis: 'vertical' } },
  },
  {
    id: 'slots.flip.horizontal-default',
    category: 'slots',
    prompt: 'mirror my newest 5 photos',
    expect: { kind: 'flip_assets', slots: { axis: 'horizontal' } },
  },

  // rename_person ---------------------------------------------------------------
  {
    id: 'slots.person.rename',
    category: 'slots',
    prompt: 'Rename Alejandra to Karina',
    expect: { kind: 'rename_person', slots: { personRef: 'Alejandra', newName: 'Karina' } },
  },

  // set_person_birthdate --------------------------------------------------------
  {
    id: 'slots.person.birthdate',
    category: 'slots',
    prompt: "set Alex's birthday to 1990-05-01",
    expect: { kind: 'set_person_birthdate', slots: { personRef: 'Alex', dateStr: '1990-05-01' } },
  },

  // merge_people ---------------------------------------------------------------
  {
    id: 'slots.person.merge',
    category: 'slots',
    prompt: 'merge Alejandra into Karina',
    expect: { kind: 'merge_people', slots: { sourceRef: 'Alejandra', keepRef: 'Karina' } },
  },

  // delete_album ---------------------------------------------------------------
  {
    id: 'slots.deletealbum.canonical',
    category: 'slots',
    prompt: 'delete the Beach album',
    expect: { kind: 'delete_album', slots: { albumRef: 'Beach' } },
  },
  {
    id: 'slots.deletealbum.remove',
    category: 'slots',
    prompt: 'remove the Trip album',
    expect: { kind: 'delete_album', slots: { albumRef: 'Trip' } },
  },

  // delete_space ---------------------------------------------------------------
  {
    id: 'slots.deletespace.canonical',
    category: 'slots',
    prompt: 'delete the Family space',
    expect: { kind: 'delete_space', slots: { spaceRef: 'Family' } },
  },
  {
    id: 'slots.deletespace.remove',
    category: 'slots',
    prompt: 'remove the Trip space',
    expect: { kind: 'delete_space', slots: { spaceRef: 'Trip' } },
  },
];
