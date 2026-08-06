// Recall: does the agent route real paraphrases to the right workflow, with
// slots that survive parseSlots? `slotsSurvive: true` is the key assertion — a
// correctly-classified prompt whose slots get rejected is still a recall miss.
export default [
  // create_recent_trip_album ------------------------------------------------
  {
    id: 'recall.trip.usa.canonical',
    category: 'recall',
    prompt: 'Create an album for my recent trip to USA',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: 'USA' } },
  },
  {
    id: 'recall.trip.noplace',
    category: 'recall',
    prompt: 'Make an album for my recent trip',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true },
  },
  {
    id: 'recall.trip.japan.paraphrase',
    category: 'recall',
    prompt: 'put my Japan trip from last week into an album',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: 'Japan' } },
  },
  {
    id: 'recall.trip.italy.uncommon-verb',
    category: 'recall',
    prompt: 'throw the pics from our Italy getaway into a new album',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: /italy/i } },
  },
  {
    id: 'recall.trip.lisbon.weekend',
    category: 'recall',
    prompt: 'build an album out of my weekend in Lisbon',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: /lisbon/i } },
  },
  {
    id: 'recall.trip.portugal.question',
    category: 'recall',
    prompt: 'can you make an album from my trip to Portugal?',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: /portugal/i } },
  },
  {
    id: 'recall.trip.roadtrip.noplace',
    category: 'recall',
    prompt: 'assemble an album for our recent road trip',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true },
  },
  {
    id: 'recall.trip.spain.vacation-word',
    category: 'recall',
    prompt: 'gather my vacation photos from Spain into an album',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true, slots: { placeHint: /spain/i } },
  },

  // rename_or_describe_album ------------------------------------------------
  {
    id: 'recall.rename.family.canonical',
    category: 'recall',
    prompt: 'rename the Family album to Family 2026',
    expect: { kind: 'rename_or_describe_album', slotsSurvive: true, slots: { albumRef: 'Family', newName: 'Family 2026' } },
  },
  {
    id: 'recall.rename.this-album',
    category: 'recall',
    prompt: 'rename this album to Berlin Weekend',
    expect: { kind: 'rename_or_describe_album', slotsSurvive: true, slots: { newName: 'Berlin Weekend' } },
  },
  {
    id: 'recall.describe.italy.valued',
    category: 'recall',
    prompt: 'set the description on my Italy album to Summer 2026 memories',
    expect: { kind: 'rename_or_describe_album', slotsSurvive: true, slots: { albumRef: /italy/i } },
  },
  {
    id: 'recall.rename.wedding.valued',
    category: 'recall',
    prompt: 'rename my Wedding album to Wedding Day',
    expect: { kind: 'rename_or_describe_album', slotsSurvive: true, slots: { albumRef: /wedding/i, newName: /wedding day/i } },
  },

  // delete_album -------------------------------------------------------------
  {
    id: 'recall.deletealbum.beach.canonical',
    category: 'recall',
    prompt: 'delete the Beach album',
    expect: { kind: 'delete_album', slotsSurvive: true, slots: { albumRef: 'Beach' } },
  },
  {
    id: 'recall.deletealbum.remove.trip',
    category: 'recall',
    prompt: 'remove the Trip album',
    expect: { kind: 'delete_album', slotsSurvive: true, slots: { albumRef: 'Trip' } },
  },
  {
    id: 'recall.deletealbum.getridof',
    category: 'recall',
    prompt: 'get rid of the Family album',
    expect: { kind: 'delete_album', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  // Negatives: photo-deletion intent must NOT route to delete_album
  {
    id: 'recall.deletealbum.neg.photos-in',
    category: 'recall',
    prompt: 'delete the photos in the Beach album',
    expect: { kind: 'none' },
  },
  {
    id: 'recall.deletealbum.neg.trash-assets-cede',
    category: 'recall',
    prompt: 'trash my 2024 screenshots',
    expect: { kind: 'trash_assets' },
  },

  // delete_space -------------------------------------------------------------
  {
    id: 'recall.deletespace.family.canonical',
    category: 'recall',
    prompt: 'delete the Family space',
    expect: { kind: 'delete_space', slotsSurvive: true, slots: { spaceRef: 'Family' } },
  },
  {
    id: 'recall.deletespace.remove.trip',
    category: 'recall',
    prompt: 'remove the Trip space',
    expect: { kind: 'delete_space', slotsSurvive: true, slots: { spaceRef: 'Trip' } },
  },
  {
    id: 'recall.deletespace.getridof',
    category: 'recall',
    prompt: 'get rid of the Beach space',
    expect: { kind: 'delete_space', slotsSurvive: true, slots: { spaceRef: 'Beach' } },
  },
  // Negatives: photo-deletion intent must NOT route to delete_space
  {
    id: 'recall.deletespace.neg.photos-in',
    category: 'recall',
    prompt: 'delete the photos in the Family space',
    expect: { kind: 'none' },
  },
  // delete_space must NOT steal manage_space_assets (photos-in-space ops)
  {
    id: 'recall.deletespace.neg.manage-space-assets',
    category: 'recall',
    prompt: 'remove my screenshots from the Family space',
    expect: { kind: 'manage_space_assets' },
  },
  // delete_space must NOT steal manage_space_members
  {
    id: 'recall.deletespace.neg.manage-space-members',
    category: 'recall',
    prompt: 'remove Bob from the Family space',
    expect: { kind: 'manage_space_members' },
  },
  // delete_space must NOT steal delete_album
  {
    id: 'recall.deletespace.neg.delete-album',
    category: 'recall',
    prompt: 'delete the Family album',
    expect: { kind: 'delete_album' },
  },

  // add_photos_to_album -----------------------------------------------------
  {
    id: 'recall.add.newest20.canonical',
    category: 'recall',
    prompt: 'add my newest 20 photos to Family',
    expect: { kind: 'add_photos_to_album', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  {
    id: 'recall.add.stick.uncommon-verb',
    category: 'recall',
    prompt: 'stick my newest 20 photos into the Family album',
    expect: { kind: 'add_photos_to_album', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  {
    id: 'recall.add.berlin.weekend',
    category: 'recall',
    prompt: 'put my Berlin photos from last weekend into the Trips album',
    expect: { kind: 'add_photos_to_album', slotsSurvive: true, slots: { albumRef: /trips/i } },
  },
  {
    id: 'recall.add.yesterday',
    category: 'recall',
    prompt: 'add the photos I took yesterday to my Family album',
    expect: { kind: 'add_photos_to_album', slotsSurvive: true, slots: { albumRef: /family/i } },
  },
  {
    id: 'recall.add.beach.drop',
    category: 'recall',
    prompt: 'drop my beach pics into the Summer album',
    expect: { kind: 'add_photos_to_album', slotsSurvive: true, slots: { albumRef: /summer/i } },
  },

  // archive_assets ----------------------------------------------------------
  {
    id: 'recall.archive.canonical',
    category: 'recall',
    prompt: 'archive my newest 50 photos',
    expect: {
      kind: 'archive_assets',
      slotsSurvive: true,
      slots: { archived: true, sourceDescription: /newest 50 photos/i },
    },
  },
  {
    id: 'recall.archive.unarchive',
    category: 'recall',
    prompt: 'move my last 10 photos out of the archive',
    expect: {
      kind: 'archive_assets',
      slotsSurvive: true,
      slots: { archived: false, sourceDescription: /last 10 photos/i },
    },
  },
  {
    id: 'recall.archive.uncommon-verb',
    category: 'recall',
    prompt: 'put my newest 20 photos in the archive',
    expect: { kind: 'archive_assets', slotsSurvive: true },
  },
  {
    // Routes at classify-time. The resolver now resolves "screenshots" tag-first
    // (Screenshots / Auto/Screenshots) when the tag is configured on the instance;
    // discloses and hands off when neither tag exists. L1 only observes routing.
    id: 'recall.archive.screenshots',
    category: 'recall',
    prompt: 'archive old screenshots from 2024',
    expect: { kind: 'archive_assets', slotsSurvive: true },
  },
  {
    // Verb parity (E1): the same "screenshots" source rides the trash verb →
    // trash_assets, not archive. Routing is pre-resolution; the tag resolves at run
    // time. Bounded phrasing (no "all") is not declined.
    id: 'recall.trash.screenshots',
    category: 'recall',
    prompt: 'trash my screenshots',
    expect: { kind: 'trash_assets' },
  },

  // lock_assets -------------------------------------------------------------
  {
    id: 'recall.lock.canonical',
    category: 'recall',
    prompt: 'lock my passport scans',
    expect: {
      kind: 'lock_assets',
      slotsSurvive: true,
      slots: { sourceDescription: /passport scans/i },
    },
  },
  {
    id: 'recall.lock.move-to-locked-folder',
    category: 'recall',
    prompt: 'move my 2024 receipts to the locked folder',
    expect: {
      kind: 'lock_assets',
      slotsSurvive: true,
      slots: { sourceDescription: /2024 receipts/i },
    },
  },
  {
    id: 'recall.lock.put-in-private-folder',
    category: 'recall',
    prompt: 'put these in my private folder',
    expect: { kind: 'lock_assets', slotsSurvive: true },
  },
  {
    // negative: "hide Alex" has no folder cue → hide_person, not lock_assets
    id: 'recall.lock.neg.hide-person',
    category: 'recall',
    prompt: 'hide Alex',
    expect: { kind: 'hide_person', slotsSurvive: true },
  },
  {
    // negative: "archive these photos" → archive_assets, not lock_assets
    id: 'recall.lock.neg.archive',
    category: 'recall',
    prompt: 'archive these photos',
    expect: { kind: 'archive_assets', slotsSurvive: true },
  },

  // favorite_assets ---------------------------------------------------------
  {
    id: 'recall.favorite.canonical',
    category: 'recall',
    prompt: 'favorite my newest 10 photos',
    expect: {
      kind: 'favorite_assets',
      slotsSurvive: true,
      slots: { favorite: true, sourceDescription: /newest 10 photos/i },
    },
  },
  {
    id: 'recall.favorite.unfavorite',
    category: 'recall',
    prompt: 'unfavorite my last 5 photos',
    expect: { kind: 'favorite_assets', slotsSurvive: true, slots: { favorite: false } },
  },
  {
    // "add … to my favorites" is a favorite intent, owned by favorite_assets
    // (not an album add) — see ADD_TO_FAVS_PATTERN.
    id: 'recall.favorite.add-to-favorites',
    category: 'recall',
    prompt: 'add my newest 20 photos to my favorites',
    expect: {
      kind: 'favorite_assets',
      slotsSurvive: true,
      slots: { favorite: true, sourceDescription: /newest 20 photos/i },
    },
  },

  // tag_assets --------------------------------------------------------------
  {
    id: 'recall.tag.canonical',
    category: 'recall',
    prompt: 'tag my newest 20 photos as Travel',
    expect: {
      kind: 'tag_assets',
      slotsSurvive: true,
      slots: { sourceDescription: /newest 20 photos/i, tagName: 'Travel' },
    },
  },
  {
    // Must NOT be stolen by add_photos_to_album's "add <source> to <album>".
    id: 'recall.tag.add-the-tag',
    category: 'recall',
    prompt: 'add the tag Spring Break to my newest 50 photos',
    expect: { kind: 'tag_assets', slotsSurvive: true, slots: { tagName: 'Spring Break' } },
  },
  {
    id: 'recall.tag.uncommon-verb',
    category: 'recall',
    prompt: 'label my newest 20 photos Travel',
    expect: { kind: 'tag_assets', slotsSurvive: true },
  },

  // untag_assets ------------------------------------------------------------
  {
    id: 'recall.untag.canonical',
    category: 'recall',
    prompt: 'remove the Travel tag from my newest 20',
    expect: {
      kind: 'untag_assets',
      slotsSurvive: true,
      slots: { sourceDescription: /newest 20/i, tagName: 'Travel' },
    },
  },
  {
    id: 'recall.untag.tag-named-from',
    category: 'recall',
    prompt: 'remove tag Spring Break from my last 50 photos',
    expect: { kind: 'untag_assets', slotsSurvive: true, slots: { tagName: 'Spring Break' } },
  },
  {
    id: 'recall.untag.verb',
    category: 'recall',
    prompt: 'untag my newest 20 as Travel',
    expect: { kind: 'untag_assets', slotsSurvive: true, slots: { tagName: 'Travel' } },
  },

  // trash_assets ------------------------------------------------------------
  {
    id: 'recall.trash.canonical',
    category: 'recall',
    prompt: 'trash my newest 20 photos',
    expect: { kind: 'trash_assets', slotsSurvive: true, slots: { sourceDescription: /newest 20/i } },
  },
  {
    id: 'recall.trash.delete-verb',
    category: 'recall',
    prompt: 'delete my newest 50 photos',
    expect: { kind: 'trash_assets', slotsSurvive: true },
  },
  {
    id: 'recall.trash.move-to-trash',
    category: 'recall',
    prompt: 'move my newest 20 photos to the trash',
    expect: { kind: 'trash_assets', slotsSurvive: true },
  },

  // restore_assets ------------------------------------------------------------
  {
    id: 'recall.restore.canonical',
    category: 'recall',
    prompt: 'restore my newest 20 from trash',
    expect: { kind: 'restore_assets', slotsSurvive: true },
  },
  {
    id: 'recall.restore.recover',
    category: 'recall',
    prompt: 'recover the photos I just trashed',
    expect: { kind: 'restore_assets', slotsSurvive: true },
  },
  {
    id: 'recall.restore.untrash',
    category: 'recall',
    prompt: 'untrash these photos',
    expect: { kind: 'restore_assets', slotsSurvive: true },
  },

  // rename_or_describe_space ------------------------------------------------
  {
    id: 'recall.space.rename',
    category: 'recall',
    prompt: 'rename the Family space to Family 2026',
    expect: {
      kind: 'rename_or_describe_space',
      slotsSurvive: true,
      slots: { spaceRef: 'Family', newName: 'Family 2026' },
    },
  },
  {
    id: 'recall.space.describe',
    category: 'recall',
    prompt: 'set the description on the Trips space to Our adventures',
    expect: { kind: 'rename_or_describe_space', slotsSurvive: true, slots: { spaceRef: 'Trips', description: /adventures/i } },
  },

  // manage_album_access -----------------------------------------------------
  {
    id: 'recall.albumaccess.share',
    category: 'recall',
    prompt: 'share the Family album with Alex',
    expect: { kind: 'manage_album_access', slotsSurvive: true, slots: { action: 'add', albumRef: 'Family' } },
  },
  {
    id: 'recall.albumaccess.grant',
    category: 'recall',
    prompt: 'give Alex edit access to the Beach album',
    expect: { kind: 'manage_album_access', slotsSurvive: true, slots: { action: 'add', albumRef: 'Beach', role: 'editor' } },
  },
  {
    id: 'recall.albumaccess.remove',
    category: 'recall',
    prompt: 'remove Sam from the Beach album',
    expect: { kind: 'manage_album_access', slotsSurvive: true, slots: { action: 'remove', albumRef: 'Beach' } },
  },

  // manage_space_members ----------------------------------------------------
  {
    id: 'recall.members.add',
    category: 'recall',
    prompt: 'add Alex to the Family space as editor',
    expect: { kind: 'manage_space_members', slotsSurvive: true, slots: { action: 'add', spaceRef: 'Family', role: 'editor' } },
  },
  {
    id: 'recall.members.remove',
    category: 'recall',
    prompt: 'remove Bob from the Trips space',
    expect: { kind: 'manage_space_members', slotsSurvive: true, slots: { action: 'remove', spaceRef: 'Trips' } },
  },
  {
    // Routing-only: an uncommon verb the regex misses. The local model reliably
    // routes "invite" → manage_space_members but does not always extract the member
    // name into memberQueries (slot fidelity is covered by the regex-path tests).
    id: 'recall.members.add.llm',
    category: 'recall',
    prompt: 'invite Alex to the Family space',
    expect: { kind: 'manage_space_members' },
  },

  // change_member_role ------------------------------------------------------
  {
    id: 'recall.role.make',
    category: 'recall',
    prompt: 'make Alex an editor in the Family space',
    expect: { kind: 'change_member_role', slotsSurvive: true, slots: { memberQuery: /alex/i, role: 'editor', spaceRef: 'Family' } },
  },
  {
    id: 'recall.role.possessive',
    category: 'recall',
    prompt: "change Bob's role to viewer in Trips",
    expect: { kind: 'change_member_role', slotsSurvive: true, slots: { role: 'viewer', spaceRef: 'Trips' } },
  },
  {
    // change_member_role must NOT steal album-role prompts → undefined (declined)
    id: 'recall.role.album-declined',
    category: 'recall',
    prompt: 'make Alex an editor on the Family album',
    expect: { kind: 'change_album_member_role', slotsSurvive: true, slots: { memberQuery: /alex/i, role: 'editor', albumRef: 'Family' } },
  },

  // change_album_member_role ------------------------------------------------
  {
    id: 'recall.albumrole.make',
    category: 'recall',
    prompt: 'make Alex an editor on the Family album',
    expect: { kind: 'change_album_member_role', slotsSurvive: true, slots: { memberQuery: /alex/i, role: 'editor', albumRef: 'Family' } },
  },
  {
    id: 'recall.albumrole.possessive',
    category: 'recall',
    prompt: "change Bob's role to viewer in the Beach album",
    expect: { kind: 'change_album_member_role', slotsSurvive: true, slots: { role: 'viewer', albumRef: 'Beach' } },
  },
  {
    // change_album_member_role must DECLINE space targets
    id: 'recall.albumrole.space-declined',
    category: 'recall',
    prompt: 'make Alex an editor in the Family space',
    expect: { kind: 'change_member_role', slotsSurvive: true, slots: { spaceRef: 'Family' } },
  },

  // create_album_from_source ------------------------------------------------
  {
    id: 'recall.createalbum.canonical',
    category: 'recall',
    prompt: 'make an album of my newest 50 photos',
    expect: { kind: 'create_album_from_source', slotsSurvive: true, slots: { sourceDescription: /newest 50 photos/i } },
  },
  {
    id: 'recall.createalbum.named',
    category: 'recall',
    prompt: 'create an album from my 2024 photos called Best of 2024',
    expect: { kind: 'create_album_from_source', slotsSurvive: true, slots: { albumName: /best of 2024/i } },
  },
  {
    id: 'recall.createalbum.llm',
    category: 'recall',
    prompt: 'put my newest 50 photos into a brand new album',
    expect: { kind: 'create_album_from_source', slotsSurvive: true },
  },
  {
    // Disambiguation: a recent-trip album stays with the trip workflow.
    id: 'recall.createalbum.trip-disambig',
    category: 'recall',
    prompt: 'create an album for my recent trip to USA',
    expect: { kind: 'create_recent_trip_album', slotsSurvive: true },
  },
  {
    // Disambiguation: adding to an EXISTING album stays with add_photos.
    id: 'recall.createalbum.add-disambig',
    category: 'recall',
    prompt: 'add my newest 20 photos to Family',
    expect: { kind: 'add_photos_to_album', slotsSurvive: true },
  },

  // update_asset_metadata ------------------------------------------------------
  {
    id: 'recall.metadata.describe',
    category: 'recall',
    prompt: 'set the description on my newest 20 photos to Berlin weekend',
    expect: { kind: 'update_asset_metadata', slotsSurvive: true, slots: { sourceDescription: /newest 20 photos/i } },
  },
  {
    id: 'recall.metadata.rating',
    category: 'recall',
    prompt: 'rate my newest 12 photos five stars',
    expect: { kind: 'update_asset_metadata', slotsSurvive: true, slots: { sourceDescription: /newest 12 photos/i } },
  },
  {
    id: 'recall.metadata.caption',
    category: 'recall',
    prompt: 'set the caption on my newest 20 photos to Beach day',
    expect: { kind: 'update_asset_metadata', slotsSurvive: true, slots: { sourceDescription: /newest 20 photos/i } },
  },
  {
    id: 'recall.metadata.location.placename',
    category: 'recall',
    prompt: 'set the location on my newest 20 to Paris',
    expect: { kind: 'update_asset_metadata', slotsSurvive: true, slots: { sourceDescription: /newest 20/i } },
  },
  {
    id: 'recall.metadata.location.coords',
    category: 'recall',
    prompt: 'set my newest 20 photos to latitude 48.8566 and longitude 2.3522',
    expect: { kind: 'update_asset_metadata', slotsSurvive: true, slots: { sourceDescription: /newest 20 photos/i } },
  },

  // move_photos_between_albums -----------------------------------------------
  {
    id: 'recall.move.basic',
    category: 'recall',
    prompt: 'move my newest 20 photos from Drafts to Keepers',
    expect: { kind: 'move_photos_between_albums', slotsSurvive: true, slots: { fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' } },
  },

  // remove_photos_from_album -------------------------------------------------
  {
    id: 'recall.remove.canonical',
    category: 'recall',
    prompt: 'remove my newest 20 photos from Family',
    expect: { kind: 'remove_photos_from_album', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  {
    id: 'recall.remove.takeout',
    category: 'recall',
    prompt: 'take my newest 20 photos out of the Family album',
    expect: { kind: 'remove_photos_from_album', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  {
    // Forces the LLM path — 'pull' is not a regex verb.
    id: 'recall.remove.llm',
    category: 'recall',
    prompt: 'pull my 2024 photos out of the Trips album',
    expect: { kind: 'remove_photos_from_album' },
  },

  // manage_space_assets --------------------------------------------------------
  {
    id: 'recall.spaceassets.add',
    category: 'recall',
    prompt: 'add my newest 20 photos to the Family space',
    expect: { kind: 'manage_space_assets', slotsSurvive: true, slots: { action: 'add', spaceRef: 'Family' } },
  },
  {
    id: 'recall.spaceassets.put',
    category: 'recall',
    prompt: 'put my newest 20 photos into the Family space',
    expect: { kind: 'manage_space_assets', slotsSurvive: true },
  },
  {
    id: 'recall.spaceassets.takeout',
    category: 'recall',
    prompt: 'take my newest 20 photos out of the Family space',
    expect: { kind: 'manage_space_assets', slotsSurvive: true },
  },

  // entity-source variants (resolveAssetSearchFilters path) -------------------
  {
    id: 'recall.archive.entity',
    category: 'recall',
    prompt: 'archive my Berlin photos',
    expect: { kind: 'archive_assets', slotsSurvive: true, slots: { archived: true, sourceDescription: /berlin photos/i } },
  },
  {
    id: 'recall.tag.entity',
    category: 'recall',
    prompt: 'tag photos of Alex as Family',
    expect: { kind: 'tag_assets', slotsSurvive: true, slots: { tagName: 'Family', sourceDescription: /of Alex/i } },
  },
  {
    id: 'recall.favorite.entity',
    category: 'recall',
    prompt: 'favorite my 5-star photos',
    expect: { kind: 'favorite_assets', slotsSurvive: true, slots: { favorite: true, sourceDescription: /5-star/i } },
  },
  {
    id: 'recall.createalbum.entity',
    category: 'recall',
    prompt: 'make an album of my Sony photos from May',
    expect: { kind: 'create_album_from_source', slotsSurvive: true, slots: { sourceDescription: /sony photos/i } },
  },

  // create_space_from_source ------------------------------------------------
  {
    id: 'recall.createspace.canonical',
    category: 'recall',
    prompt: 'make a Family space of my newest 50 photos',
    expect: { kind: 'create_space_from_source', slotsSurvive: true, slots: { spaceName: 'Family' } },
  },
  {
    id: 'recall.createspace.named',
    category: 'recall',
    prompt: 'create a space from my newest 50 photos called Trips',
    expect: { kind: 'create_space_from_source', slotsSurvive: true, slots: { spaceName: 'Trips' } },
  },
  {
    // Disambiguation: an album source stays with create_album_from_source.
    id: 'recall.createspace.album-disambig',
    category: 'recall',
    prompt: 'make an album of my newest 50 photos',
    expect: { kind: 'create_album_from_source' },
  },
  {
    // Disambiguation: a member add stays with manage_space_members.
    id: 'recall.createspace.member-disambig',
    category: 'recall',
    prompt: 'add Alex to the Family space',
    expect: { kind: 'manage_space_members' },
  },
  // rotate_assets -------------------------------------------------------------
  {
    id: 'recall.rotate.canonical',
    category: 'recall',
    prompt: 'rotate my newest 20 photos 90 clockwise',
    expect: { kind: 'rotate_assets', slotsSurvive: true },
  },
  {
    id: 'recall.rotate.ccw',
    category: 'recall',
    prompt: 'rotate my last 10 photos 90 counterclockwise',
    expect: { kind: 'rotate_assets', slotsSurvive: true },
  },
  {
    id: 'recall.rotate.flip',
    category: 'recall',
    prompt: 'flip my newest 5 photos upside down',
    expect: { kind: 'rotate_assets', slotsSurvive: true },
  },

  // adjust_assets -------------------------------------------------------------
  {
    id: 'recall.adjust.brighten',
    category: 'recall',
    prompt: 'brighten my last 10 photos',
    expect: { kind: 'adjust_assets', slotsSurvive: true, slots: { sourceDescription: /last 10 photos/i } },
  },
  {
    id: 'recall.adjust.vivid',
    category: 'recall',
    prompt: 'make these more vivid',
    expect: { kind: 'adjust_assets', slotsSurvive: true },
  },
  {
    id: 'recall.adjust.auto-enhance',
    category: 'recall',
    prompt: 'auto-enhance my newest 5',
    expect: { kind: 'adjust_assets', slotsSurvive: true },
  },

  // flip_assets ---------------------------------------------------------------
  {
    id: 'recall.flip.horizontal',
    category: 'recall',
    prompt: 'flip this horizontally',
    expect: { kind: 'flip_assets', slotsSurvive: true },
  },
  {
    id: 'recall.flip.mirror',
    category: 'recall',
    prompt: 'mirror these',
    expect: { kind: 'flip_assets', slotsSurvive: true },
  },

  // cleanup_duplicates ---------------------------------------------------------
  {
    id: 'recall.cleanup_duplicates.canonical',
    category: 'recall',
    prompt: 'clean up my duplicate photos',
    expect: { kind: 'cleanup_duplicates', slotsSurvive: true },
  },

  // visual_cleanup ------------------------------------------------------------
  {
    id: 'recall.visualcleanup.blurry',
    category: 'recall',
    prompt: 'trash my blurry photos from last week',
    expect: {
      kind: 'visual_cleanup',
      slotsSurvive: true,
      slots: { qualityMetric: 'sharpness', sourceDescription: /photos from last week/i },
    },
  },
  {
    id: 'recall.visualcleanup.dark-uploads',
    category: 'recall',
    prompt: 'delete dark photos from my recent uploads',
    expect: {
      kind: 'visual_cleanup',
      slotsSurvive: true,
      slots: { qualityMetric: 'brightness', sourceDescription: /photos from my recent uploads/i },
    },
  },

  // crop_assets ---------------------------------------------------------------
  {
    id: 'recall.crop.comma-form',
    category: 'recall',
    prompt: 'crop this photo to 100,100,800,600',
    expect: { kind: 'crop_assets', slotsSurvive: true, slots: { x: 100, y: 100, width: 800, height: 600 } },
  },
  {
    id: 'recall.crop.labeled-form',
    category: 'recall',
    prompt: 'crop this image to x=10 y=20 w=300 h=400',
    expect: { kind: 'crop_assets', slotsSurvive: true, slots: { x: 10, y: 20, width: 300, height: 400 } },
  },
  {
    id: 'recall.crop.zero-origin',
    category: 'recall',
    prompt: 'crop this image to 0,0,1000,1000',
    expect: { kind: 'crop_assets', slotsSurvive: true, slots: { x: 0, y: 0, width: 1000, height: 1000 } },
  },

  // share_album (propose-only / outward-facing / album-targeted) ----------------
  {
    // OUTWARD-FACING safety note: createSharedLinks write-scope defaults false
    // in every preset, so this workflow is propose-only in all evals. The L1
    // recall test only asserts routing — no link is ever created.
    id: 'recall.share-album.basic',
    category: 'recall',
    prompt: 'share the Family album as a link',
    expect: { kind: 'share_album', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  {
    id: 'recall.share-album.create-link',
    category: 'recall',
    prompt: 'create a share link for the Italy album',
    expect: { kind: 'share_album', slotsSurvive: true, slots: { albumRef: 'Italy' } },
  },

  // share_assets (propose-only / outward-facing) --------------------------------
  {
    // OUTWARD-FACING safety note: createSharedLinks write-scope defaults false
    // in every preset, so this workflow is propose-only in all evals. The L1
    // recall test only asserts routing — no link is ever created.
    id: 'recall.share.as-link',
    category: 'recall',
    prompt: 'share these as a link',
    expect: { kind: 'share_assets', slotsSurvive: true },
  },
  {
    id: 'recall.share.create-link',
    category: 'recall',
    prompt: 'create a share link for my newest 20',
    expect: { kind: 'share_assets', slotsSurvive: true, slots: { sourceDescription: /newest 20/i } },
  },
  {
    // Confirm asset-level share still works (share_album must not steal it).
    id: 'recall.share.assets-still-works',
    category: 'recall',
    prompt: 'share my newest 20 as a link',
    expect: { kind: 'share_assets', slotsSurvive: true },
  },
  {
    // Negative: trash must NOT be stolen by share_assets.
    id: 'recall.share.neg.trash',
    category: 'recall',
    prompt: 'trash my newest 20 photos',
    expect: { kind: 'trash_assets', slotsSurvive: true },
  },
  {
    // Negative: album-level share routes to share_album (not none).
    id: 'recall.share.neg.album',
    category: 'recall',
    prompt: 'share the Family album as a link',
    expect: { kind: 'share_album', slotsSurvive: true },
  },

  // set_album_cover -----------------------------------------------------------
  {
    id: 'recall.cover.index',
    category: 'recall',
    prompt: 'set the cover of the Family album to the 3rd photo',
    expect: { kind: 'set_album_cover', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },
  {
    id: 'recall.cover.first',
    category: 'recall',
    prompt: 'make the Family album cover the first photo',
    expect: { kind: 'set_album_cover', slotsSurvive: true, slots: { albumRef: 'Family' } },
  },

  // rename_person ---------------------------------------------------------------
  {
    id: 'recall.person.rename',
    category: 'recall',
    prompt: 'Rename Alejandra to Karina',
    expect: { kind: 'rename_person', slotsSurvive: true, slots: { personRef: 'Alejandra', newName: 'Karina' } },
  },

  // set_person_birthdate --------------------------------------------------------
  {
    id: 'recall.person.birthdate',
    category: 'recall',
    prompt: "set Alex's birthday to 1990-05-01",
    expect: { kind: 'set_person_birthdate', slotsSurvive: true, slots: { personRef: 'Alex', dateStr: '1990-05-01' } },
  },

  // hide_person (hide) ----------------------------------------------------------
  {
    id: 'recall.person.hide',
    category: 'recall',
    prompt: 'hide Alex',
    expect: { kind: 'hide_person', slotsSurvive: true, slots: { personRef: 'Alex', verb: 'hide' } },
  },

  // hide_person (unhide) --------------------------------------------------------
  {
    id: 'recall.person.unhide',
    category: 'recall',
    prompt: 'unhide Alex',
    expect: { kind: 'hide_person', slotsSurvive: true, slots: { personRef: 'Alex', verb: 'unhide' } },
  },

  // merge_people ---------------------------------------------------------------
  {
    id: 'recall.person.merge',
    category: 'recall',
    prompt: 'merge Alejandra into Karina',
    expect: { kind: 'merge_people', slotsSurvive: true, slots: { sourceRef: 'Alejandra', keepRef: 'Karina' } },
  },

  // stack_assets ---------------------------------------------------------------
  {
    id: 'recall.stack.basic',
    category: 'recall',
    prompt: 'stack my 5 newest photos',
    expect: { kind: 'stack_assets', slotsSurvive: true },
  },
  {
    id: 'recall.stack.group-form',
    category: 'recall',
    prompt: 'group my photos from 2024 into a stack',
    expect: { kind: 'stack_assets', slotsSurvive: true },
  },

  // unstack_assets -------------------------------------------------------------
  {
    id: 'recall.unstack.basic',
    category: 'recall',
    prompt: 'unstack these photos',
    expect: { kind: 'unstack_assets', slotsSurvive: true },
  },
  {
    id: 'recall.unstack.ungroup',
    category: 'recall',
    prompt: 'ungroup my newest 10 photos',
    expect: { kind: 'unstack_assets', slotsSurvive: true },
  },
];
