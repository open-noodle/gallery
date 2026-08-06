export const WORKFLOW_MANIFEST = Object.freeze([
  Object.freeze({
    kind: 'create_recent_trip_album',
    flow: 'strict',
    title: 'Create recent trip album',
    classifierDescription:
      'User wants a new album built from a recent trip, vacation, getaway, holiday, or road trip — detected from photo date/location metadata. A place + a travel word (trip/vacation/getaway/holiday) signals this even without the word "trip".',
    positiveExamples: Object.freeze([
      'Create an album for my recent trip to USA',
      'Make an album for my recent trip',
      'Put my Japan trip from last week into an album',
      'Make an album from our recent getaway to the coast',
    ]),
    negativeExamples: Object.freeze([
      'Add my recent trip photos to Family',
      'How many photos are in my recent trip album?',
      'Pick the best photos from my recent trip',
    ]),
    slots: Object.freeze({
      albumName: Object.freeze({
        type: 'string',
        required: false,
        description: 'Explicit album name if the user gave one.',
      }),
      placeHint: Object.freeze({
        type: 'string',
        required: false,
        description: 'Place text to bias trip detection.',
      }),
    }),
    requiredReadTools: Object.freeze(['findTripCandidates']),
    planTool: 'proposeAlbumFromSelection',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Create recent trip album',
      tier: 'Solid now',
      workflowOrBoundary:
        '`create_recent_trip_album` handles recent-trip detection, candidate choice, and album plan creation from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'rename_or_describe_album',
    flow: 'strict',
    title: 'Rename or describe album',
    classifierDescription:
      'User wants to rename an existing album and/or change its description, leaving its assets unchanged.',
    positiveExamples: Object.freeze([
      'Rename this album to Berlin Weekend',
      'Rename the Family album to Family 2026 and add a description',
      'Change the description on my Italy album',
    ]),
    negativeExamples: Object.freeze([
      'Add my newest photos to the Family album',
      'Delete the Family album',
      'Create an album for my recent trip',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the album.' }),
      newName: Object.freeze({ type: 'string', required: false, description: 'New album title, if renaming.' }),
      description: Object.freeze({ type: 'string', required: false, description: 'New description, if setting one.' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Rename or describe album',
      tier: 'Solid now',
      workflowOrBoundary: 'Direct album-detail update plan; preserve unspecified fields.',
    }),
  }),
  Object.freeze({
    kind: 'delete_album',
    flow: 'strict',
    title: 'Delete an album',
    classifierDescription:
      'User wants to delete (remove/get rid of) an existing album container. The album is deleted but all photos stay in the library. DECLINES photo-deletion intents ("delete the photos in X album") and space deletion ("delete the X space" → delete_space).',
    positiveExamples: Object.freeze([
      'Delete the Beach album',
      'Remove the Trip album',
      'Get rid of the Family album',
    ]),
    negativeExamples: Object.freeze([
      'Delete the photos in the Beach album',
      'Delete the Beach album photos',
      'Delete the Family space',
      'Trash my 2024 screenshots',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the album.' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Delete an album',
      tier: 'Solid now',
      workflowOrBoundary:
        '`delete_album` resolves the album by name (durable disambiguation for duplicate names) and proposes an `album.delete` plan. Photos stay in the library — only the container is removed. `deleteContainers` write-scope required.',
    }),
  }),
  Object.freeze({
    kind: 'delete_space',
    flow: 'strict',
    title: 'Delete a space',
    classifierDescription:
      'User wants to delete (remove/get rid of) an existing shared space container. The space and its membership are removed; photos stay in members\' libraries. DECLINES photo-deletion intents ("delete the photos in X space"), "in/from" frames, and album deletion ("delete the X album" → delete_album).',
    positiveExamples: Object.freeze([
      'Delete the Family space',
      'Remove the Trip space',
      'Get rid of the Beach space',
    ]),
    negativeExamples: Object.freeze([
      'Delete the photos in the Family space',
      'Delete the Family space photos',
      'Delete the Family album',
      'Trash my 2024 screenshots',
    ]),
    slots: Object.freeze({
      spaceRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the space.' }),
    }),
    requiredReadTools: Object.freeze(['listSpaces']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Delete a space',
      tier: 'Solid now',
      workflowOrBoundary:
        '`delete_space` resolves the space by name (durable disambiguation for duplicate names) and proposes a `space.delete` plan. The shared space and its membership are removed; photos stay in members\' libraries. Server enforces owner-level permission (`SharedSpaceDelete`); workflow proposes regardless (propose-only; server is the backstop). `deleteContainers` write-scope required.',
    }),
  }),
  Object.freeze({
    kind: 'set_album_cover',
    flow: 'strict',
    title: 'Set album cover',
    classifierDescription:
      'User wants to set the cover photo of an existing album to a specific photo identified by position (first, last, or Nth).',
    positiveExamples: Object.freeze([
      'Set the cover of the Family album to the first photo',
      'Make the Family album cover the 3rd photo',
      'Set the cover of my Italy album to the last photo',
    ]),
    negativeExamples: Object.freeze([
      'Pick a better cover for the Family album',
      'Change the cover photo on my Italy album',
      'Rename the Family album to Family 2026',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'The album whose cover to set.' }),
      coverRef: Object.freeze({ type: 'string', required: true, description: 'Which photo becomes the cover (first/last/Nth).' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'readAlbum']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Set album cover',
      tier: 'Solid now',
      workflowOrBoundary: 'Pi resolves the album + an explicit photo position; Gallery owns the album.setCover plan (cover rides in the asset selection).',
    }),
  }),
  Object.freeze({
    kind: 'add_photos_to_album',
    flow: 'hybrid',
    title: 'Add photos to existing album',
    classifierDescription: 'User wants to add a metadata-describable set of photos to an existing album.',
    positiveExamples: Object.freeze([
      'Add my newest 20 photos to Family',
      'Add my Berlin photos from last weekend to the Trips album',
    ]),
    negativeExamples: Object.freeze([
      'Add the good ones to Family',
      'Create a new album from my Berlin photos',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'Target album the user named.' }),
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to add.',
      }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Add photos to existing album',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the source; Gallery owns album lookup, duplicate-safe add, and plan creation.',
    }),
  }),
  Object.freeze({
    kind: 'move_photos_between_albums',
    flow: 'hybrid',
    title: 'Move photos between albums',
    classifierDescription:
      'User wants to MOVE a metadata-describable set of photos out of one album and into another (remove from album A, add to album B) in a single step. Requires both a source album ("from X") and a destination album ("to Y").',
    positiveExamples: Object.freeze([
      'Move my newest 20 photos from Drafts to Keepers',
      'Move my 2024 photos from the Trips album to the Italy album',
      'Move my Berlin photos from Drafts to Berlin Weekend',
    ]),
    negativeExamples: Object.freeze([
      'Add my newest 20 photos to Keepers',
      'Remove my newest 20 photos from Drafts',
      'Move the best ones from Drafts to Keepers',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to move.' }),
      fromAlbumRef: Object.freeze({ type: 'string', required: true, description: 'The album to move photos out of.' }),
      toAlbumRef: Object.freeze({ type: 'string', required: true, description: 'The album to move photos into.' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Move photos between albums',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the source + both albums; Gallery owns the compound album.removeAssets + album.addAssets plan (requires both from and to; same-album declines).',
    }),
  }),
  Object.freeze({
    kind: 'remove_photos_from_album',
    flow: 'hybrid',
    title: 'Remove photos from album',
    classifierDescription:
      'User wants to remove a metadata-describable set of photos from an existing album (the inverse of adding) — not a member removal, an out-of-favorites, or a tag removal.',
    positiveExamples: Object.freeze([
      'Remove my newest 20 photos from Family',
      'Take my newest 20 photos out of the Trips album',
      'Remove my 2024 photos from the Italy album',
    ]),
    negativeExamples: Object.freeze([
      'Remove the Travel tag from my newest 20',
      'Remove Bob from the Family space',
      'Add my newest 20 photos to Family',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'The album to remove photos from.' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to remove.' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Remove photos from album',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the album and source; Gallery owns the album.removeAssets plan from the handle (never an empty removal).',
    }),
  }),
  Object.freeze({
    kind: 'manage_space_assets',
    flow: 'hybrid',
    title: 'Add or remove photos in a space',
    classifierDescription:
      'User wants to add or remove a metadata-describable set of PHOTOS in a shared space (not members). Requires both a "space" target and a photo source.',
    positiveExamples: Object.freeze([
      'Add my newest 20 photos to the Family space',
      'Remove my screenshots from the Family space',
      'Put my 2024 photos into the Trips space',
    ]),
    negativeExamples: Object.freeze([
      'Add Alex to the Family space',
      'Add my newest 20 photos to Family',
      'Add my newest 20 photos to the Trips album',
    ]),
    slots: Object.freeze({
      action: Object.freeze({ type: 'string', required: true, description: 'add or remove.' }),
      spaceRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the space.' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos.' }),
    }),
    requiredReadTools: Object.freeze(['listSpaces', 'resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAddAssetsToSpaceFromSearch',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Add/remove photos in a space',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the space and source; Gallery owns the space add (from-search) / remove (space.removeAssets) plan from the handle. Durable space disambiguation: ambiguous space gets a storable candidate list.',
    }),
  }),
  Object.freeze({
    kind: 'archive_assets',
    flow: 'hybrid',
    title: 'Archive or unarchive photos',
    classifierDescription:
      'User wants to archive or unarchive a metadata-describable set of photos (recency/date/type bound) or a named entity (people, place, tag, camera, rating, favorites).',
    positiveExamples: Object.freeze([
      'Archive my newest 50 photos',
      'Unarchive my last 10 photos',
      'Move my 2024 videos out of the archive',
      'Archive my Berlin photos',
    ]),
    negativeExamples: Object.freeze([
      'Archive the best photos from last weekend',
      'Archive the Family album',
      'Add my newest 20 photos to Family',
    ]),
    slots: Object.freeze({
      archived: Object.freeze({
        type: 'boolean',
        required: false,
        description: 'true to archive, false to unarchive (default archive).',
      }),
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to (un)archive.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Archive assets',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a recency/date/type source; Gallery owns the batch archive plan from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'cleanup_duplicates',
    flow: 'hybrid',
    title: 'Clean up duplicate photos',
    classifierDescription:
      'User wants to find and remove near-duplicate photos, keeping the best of each group (reversible Trash).',
    positiveExamples: Object.freeze([
      'Clean up my duplicate photos',
      'Find and remove duplicates',
      'Trash duplicate photos',
      'Dedupe my library',
    ]),
    negativeExamples: Object.freeze([
      'Trash my newest 20 photos',
      'Delete the Family album',
      'Find my best photos',
    ]),
    slots: Object.freeze({}),
    requiredReadTools: Object.freeze(['listDuplicateGroups']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Duplicate cleanup',
      tier: 'Solid now',
      flow: 'Hybrid',
    }),
  }),
  Object.freeze({
    kind: 'visual_cleanup',
    flow: 'hybrid',
    title: 'Visual cleanup',
    classifierDescription:
      'User wants to trash a bounded set of objectively low-quality photos using precomputed quality scores: blurry/out-of-focus, dark/underexposed, or low-quality photos. This is not plain trash, duplicate cleanup, or subjective taste such as ugly/best/good photos.',
    positiveExamples: Object.freeze([
      'Trash my blurry photos from last week',
      'Delete dark photos from my recent uploads',
      'Clean up low-quality photos from last month',
    ]),
    negativeExamples: Object.freeze([
      'Trash my newest 20 photos',
      'Trash duplicate photos',
      'Delete the ugly ones',
      'Find my best photos',
    ]),
    slots: Object.freeze({
      qualityMetric: Object.freeze({
        type: 'string',
        required: true,
        description: 'Quality metric to filter by: sharpness, brightness, or quality.',
      }),
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata-bounded source after removing the quality adjective.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets', 'curateSelection']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Visual cleanup',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a bounded source, derives a quality-filtered handle, and Gallery owns the reviewable asset.trash plan from that handle.',
    }),
  }),
  Object.freeze({
    kind: 'trash_assets',
    flow: 'hybrid',
    title: 'Trash photos (recoverable)',
    classifierDescription:
      'User wants to move a metadata-describable set of photos to the recoverable Trash (trash/delete/bin a recency/date/type or named-entity source). Reversible; album/space deletion, duplicate cleanup, objective quality cleanup, and subjective sources are out of scope.',
    positiveExamples: Object.freeze([
      'Trash my newest 20 photos',
      'Delete my 2024 screenshots',
      'Move my newest 50 photos to the trash',
      'Bin my videos from last weekend',
    ]),
    negativeExamples: Object.freeze([
      'Delete the Family album',
      'Remove my newest 20 from the Italy album',
      'Remove the Travel tag from my newest 20',
      'Trash my blurry photos',
      'Trash the best ones',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to trash.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Trash photos',
      tier: 'Solid now',
      flow: 'Hybrid',
    }),
  }),
  Object.freeze({
    kind: 'share_assets',
    flow: 'hybrid',
    title: 'Share photos as a link',
    classifierDescription:
      'User wants to create an outward-facing share link for a metadata-describable set of photos. Optional: expiry ("expires in N days"), password ("with password X"), or "hide metadata". OUTWARD-FACING / High risk / propose-only — the createSharedLinks write-scope defaults false in every preset so no link is ever created during tests or evals.',
    positiveExamples: Object.freeze([
      'share these photos as a link',
      'create a share link for my newest 20',
      'make a shareable link for these, expires in 7 days',
      'share my newest 10 with password hunter2',
    ]),
    negativeExamples: Object.freeze([
      'trash my newest 20 photos',
      'archive my newest 50 photos',
      'share the album',
      'add my newest 20 photos to Family',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to share.',
      }),
      expiryDays: Object.freeze({
        type: 'number',
        required: false,
        description: 'How many days until the link expires (e.g. 7 for "expires in 7 days").',
      }),
      password: Object.freeze({
        type: 'string',
        required: false,
        description: 'Optional link password.',
      }),
      showMetadata: Object.freeze({
        type: 'boolean',
        required: false,
        description: 'false to hide EXIF/location metadata on the share page (default: show).',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Share links',
      tier: 'Solid now',
      workflowOrBoundary:
        '`share_assets` resolves a bounded source and proposes a shareLink.create op (High risk; outward-facing; createSharedLinks write-scope defaults false in every preset — propose-only path; no link is ever created in tests or evals).',
    }),
  }),
  Object.freeze({
    kind: 'share_album',
    flow: 'hybrid',
    title: 'Share album as a link',
    classifierDescription:
      'User wants to create an outward-facing share link for a NAMED ALBUM (not for individual photos). The prompt must reference a specific album by name and contain the word "album". OUTWARD-FACING / High risk / propose-only — the createSharedLinks write-scope defaults false in every preset so no link is ever created during tests or evals.',
    positiveExamples: Object.freeze([
      'share the Family album as a link',
      'create a public share link for the Italy album',
      'make a shareable link for the Trips album',
      'generate a share link for the Family album, expires in 7 days',
    ]),
    negativeExamples: Object.freeze([
      'share these photos as a link',
      'create a share link for my newest 20',
      'share my newest 10 with password hunter2',
      'trash my newest 20 photos',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({
        type: 'string',
        required: true,
        description: 'How the user referred to the album (e.g. "Family album" or "Trips").',
      }),
      expiryDays: Object.freeze({
        type: 'number',
        required: false,
        description: 'How many days until the link expires.',
      }),
      password: Object.freeze({
        type: 'string',
        required: false,
        description: 'Optional link password.',
      }),
      showMetadata: Object.freeze({
        type: 'boolean',
        required: false,
        description: 'false to hide EXIF/location metadata on the share page (default: show).',
      }),
    }),
    requiredReadTools: Object.freeze(['listAlbums']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Album share links',
      tier: 'Solid now',
      workflowOrBoundary:
        '`share_album` resolves a named album and proposes a shareLink.createAlbum op (High risk; outward-facing; createSharedLinks write-scope defaults false in every preset — propose-only path; no link is ever created in tests or evals).',
    }),
  }),
  Object.freeze({
    kind: 'restore_assets',
    flow: 'hybrid',
    title: 'Restore photos from Trash',
    classifierDescription:
      'User wants to restore (untrash/recover/bring back) a metadata-describable set of photos from the Trash back to their library. The source is always resolved within the Trash. Reversible; non-destructive; album/space deletion and subjective sources are out of scope.',
    positiveExamples: Object.freeze([
      'Restore my newest 20 from trash',
      'Recover the photos I just trashed',
      'Get my photos back from the trash',
      'Untrash these photos',
    ]),
    negativeExamples: Object.freeze([
      'Trash my newest 20 photos',
      'Delete my 2024 screenshots',
      'Remove the Travel tag from my newest 20',
      'Archive my newest 20',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the trashed photos to restore.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Restore from trash',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a bounded trashed-asset source (isTrashed:true injected automatically); Gallery owns the Low-risk, reversible asset.restore plan.',
    }),
  }),
  Object.freeze({
    kind: 'favorite_assets',
    flow: 'hybrid',
    title: 'Favorite or unfavorite photos',
    classifierDescription: 'User wants to favorite or unfavorite a metadata-describable set of photos or a named entity (people, place, tag, camera, rating, favorites).',
    positiveExamples: Object.freeze([
      'Favorite my newest 10 photos',
      'Unfavorite my last 5 photos',
      'Like my newest 20 photos',
      'Favorite my 5-star photos',
    ]),
    negativeExamples: Object.freeze([
      'Favorite the best 3 photos from last weekend',
      'Favorite the Family album',
      'Add the good ones to Family',
    ]),
    slots: Object.freeze({
      favorite: Object.freeze({
        type: 'boolean',
        required: false,
        description: 'true to favorite, false to unfavorite (default favorite).',
      }),
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to (un)favorite.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Mark favorites',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a recency/date/type source; Gallery owns the batch favorite plan from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'tag_assets',
    flow: 'hybrid',
    title: 'Tag photos (add)',
    classifierDescription:
      'User wants to add a tag to a metadata-describable set of photos (add-only; no tag removal) or a named entity (people, place, tag, camera, rating, favorites).',
    positiveExamples: Object.freeze([
      'Tag my newest 20 photos as Travel',
      'Add the tag Spring Break to my newest 50 photos',
      'Add the Travel tag to my last 10 photos',
      'Tag photos of Alex as Family',
    ]),
    negativeExamples: Object.freeze([
      'Remove the Travel tag from my newest 20',
      'Tag the best ones as Travel',
      'Add my newest 20 photos to the Travel album',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to tag.',
      }),
      tagName: Object.freeze({ type: 'string', required: true, description: 'Tag name to add.' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Add or remove tags',
      tier: 'Solid now',
      workflowOrBoundary: 'Add-only; Pi resolves the source; Gallery owns the batch tag-add plan from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'untag_assets',
    flow: 'hybrid',
    title: 'Untag photos (remove)',
    classifierDescription:
      'User wants to remove an existing tag from a metadata-describable set of photos or a named entity (remove-only; the add arm is tag_assets).',
    positiveExamples: Object.freeze([
      'Remove the Travel tag from my newest 20',
      'Remove tag Spring Break from my last 50 photos',
      'Untag my newest 20 as Travel',
      'Untag the Berlin photos from Work',
    ]),
    negativeExamples: Object.freeze([
      'Add the Travel tag to my newest 20',
      'Remove my newest 20 from the Italy album',
      'Remove Bob from the Family space',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to untag.',
      }),
      tagName: Object.freeze({
        type: 'string',
        required: false,
        description: 'Tag name to remove (optional for untag phrasing; run asks if missing).',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Add or remove tags',
      tier: 'Solid now',
      flow: 'Hybrid',
    }),
  }),
  Object.freeze({
    kind: 'update_asset_metadata',
    flow: 'hybrid',
    title: 'Edit photo metadata',
    classifierDescription:
      'User wants to edit metadata (description/caption, star rating, capture date, time zone, or GPS location — by place name or explicit lat+lng) on a metadata-describable set of LOOSE photos — not an album or a space.',
    positiveExamples: Object.freeze([
      'Set the description on my newest 20 photos to Berlin weekend',
      'Rate my newest 12 photos five stars',
      'Set the timezone on my newest 20 photos to Europe/Berlin',
      'Set the location on my newest 20 to Paris',
    ]),
    negativeExamples: Object.freeze([
      'Set the description on the Family album to Summer 2026',
      'Set the description on the Trips space to Our adventures',
      'Set Paris as the album cover',
    ]),
    slots: Object.freeze({
      field: Object.freeze({ type: 'string', required: true, description: 'description, rating, timeZone, location, or date.' }),
      value: Object.freeze({ type: 'string', required: false, description: 'New value (text, 1-5 or clear for rating, IANA zone, ISO date).' }),
      placeName: Object.freeze({ type: 'string', required: false, description: 'Place name for a location edit (resolved to lat/lng via resolveLocation).' }),
      latitude: Object.freeze({ type: 'number', required: false, description: 'Latitude for a location edit (with longitude).' }),
      longitude: Object.freeze({ type: 'number', required: false, description: 'Longitude for a location edit (with latitude).' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to edit.' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets', 'resolveLocation']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Batch asset metadata edits',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a loose-asset source and the field/value; Gallery owns the batch metadata-update plan from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'rotate_assets',
    flow: 'hybrid',
    title: 'Rotate photos',
    classifierDescription:
      'User wants to rotate a metadata-describable set of photos by an EXPLICIT angle (90, 180, or 270 degrees, clockwise or counterclockwise).',
    positiveExamples: Object.freeze([
      'Rotate my newest 20 photos 90 clockwise',
      'Flip my newest 5 photos upside down',
      'Rotate my 2024 photos 180',
    ]),
    negativeExamples: Object.freeze([
      'Rotate the sideways photos clockwise',
      'Rotate the best ones 90 clockwise',
      'Rotate my newest 20 photos 45 clockwise',
    ]),
    slots: Object.freeze({
      angle: Object.freeze({ type: 'number', required: true, description: 'Rotation angle: 90, 180, or 270.' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to rotate.' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Rotate assets',
      tier: 'Solid now',
      workflowOrBoundary: 'Pi resolves the source + explicit angle; Gallery owns the batch rotate plan from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'crop_assets',
    flow: 'hybrid',
    title: 'Crop photos (explicit geometry)',
    classifierDescription:
      'User wants to crop a photo to EXPLICIT pixel geometry (x, y, width, height supplied in the prompt). Comma form "crop this photo to 100,100,800,600" or labeled form "crop to x=N y=N w=N h=N". No geometry → asks for x/y/width/height; never guesses coordinates.',
    positiveExamples: Object.freeze([
      'crop this photo to 100,100,800,600',
      'crop to x=10 y=20 w=300 h=400',
      'crop my newest photo to x=0 y=0 width=1920 height=1080',
    ]),
    negativeExamples: Object.freeze([
      'crop this photo',
      'crop my newest 20 photos',
      'rotate my newest 20 photos 90 clockwise',
    ]),
    slots: Object.freeze({
      x: Object.freeze({ type: 'number', required: true, description: 'Left edge of the crop rectangle (pixels, >= 0).' }),
      y: Object.freeze({ type: 'number', required: true, description: 'Top edge of the crop rectangle (pixels, >= 0).' }),
      width: Object.freeze({ type: 'number', required: true, description: 'Width of the crop rectangle (pixels, >= 1).' }),
      height: Object.freeze({ type: 'number', required: true, description: 'Height of the crop rectangle (pixels, >= 1).' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photo to crop.' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Crop assets',
      tier: 'Solid now',
      workflowOrBoundary: 'Pi resolves the source + explicit geometry (x/y/width/height); Gallery owns the batch asset.crop plan from the handle. No-geometry → asks for coordinates; never guesses.',
    }),
  }),
  Object.freeze({
    kind: 'adjust_assets',
    flow: 'hybrid',
    title: 'Adjust photo look (brightness/contrast/saturation/auto-enhance)',
    classifierDescription:
      'User wants to adjust the look of a metadata-describable set of photos — brightness, contrast, saturation (named levels), or a one-click auto-enhance. NOT crop/rotate/flip.',
    positiveExamples: Object.freeze([
      'Brighten my last 10 photos',
      'Make my Berlin photos pop',
      'Auto-enhance my newest 5',
    ]),
    negativeExamples: Object.freeze([
      'Rotate the sideways photos',
      'Make these look amazing',
      'Crop my newest photo',
    ]),
    slots: Object.freeze({
      params: Object.freeze({
        type: 'object',
        required: true,
        description: 'AdjustParameters: brightness/contrast/saturation level or autoEnhance.',
      }),
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to adjust.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Adjust assets (tonal)',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the source + tonal adjustment params; Gallery owns the batch asset.adjust plan from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'flip_assets',
    flow: 'hybrid',
    title: 'Flip photos (mirror H/V)',
    classifierDescription:
      "User wants to flip/mirror a metadata-describable set of photos horizontally or vertically. NOT rotate (degrees) or 'upside down' (that is a 180 rotation).",
    positiveExamples: Object.freeze([
      'Flip my newest 5 photos horizontally',
      'Mirror these',
      'Flip these vertically',
    ]),
    negativeExamples: Object.freeze([
      'Rotate these 90',
      'Flip my photos upside down',
      'Crop this',
    ]),
    slots: Object.freeze({
      axis: Object.freeze({
        type: 'string',
        required: false,
        description: 'horizontal (default) or vertical.',
      }),
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to flip.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Flip assets (mirror H/V)',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the source + flip axis (horizontal default); Gallery owns the batch asset.flip plan from the handle. "Upside down" deferred to rotate_assets (180°).',
    }),
  }),
  Object.freeze({
    kind: 'stack_assets',
    flow: 'hybrid',
    title: 'Stack photos',
    classifierDescription:
      'User wants to stack (group into a stack) a metadata-describable set of photos. The server automatically selects the stack cover using: favorite > highest rating > newest > id. Requires at least two photos — fewer asks the user to broaden the selection.',
    positiveExamples: Object.freeze([
      'stack my newest 10 photos',
      'group my photos from 2024 into a stack',
      'stack my Berlin photos',
    ]),
    negativeExamples: Object.freeze([
      'stack the best ones',
      'group my photos by date',
      'unstack my newest 10 photos',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to stack.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Stack photos',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a bounded source (≥2 required); Gallery owns the batch stack plan from the handle. Cover rule: favorite > highest rating > newest > id.',
    }),
  }),
  Object.freeze({
    kind: 'unstack_assets',
    flow: 'hybrid',
    title: 'Unstack photos',
    classifierDescription:
      'User wants to unstack (dissolve a stack of) a metadata-describable set of photos. Assets in no stack are silently skipped; no minimum count required.',
    positiveExamples: Object.freeze([
      'unstack my newest 10 photos',
      'un-stack my Berlin photos',
      'ungroup my photos from 2024',
    ]),
    negativeExamples: Object.freeze([
      'unstack the best ones',
      'stack my newest 10 photos',
      'archive my newest 10 photos',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to unstack.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Unstack photos',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a bounded source; Gallery owns the batch unstack plan from the handle. Assets not in a stack are silently skipped.',
    }),
  }),
  Object.freeze({
    kind: 'rename_or_describe_space',
    flow: 'strict',
    title: 'Rename or describe space',
    classifierDescription:
      'User wants to rename a shared space and/or change its description, leaving members and assets unchanged.',
    positiveExamples: Object.freeze([
      'Rename the Family space to Family 2026',
      'Set the description on the Trips space to Our adventures',
      'Change the description on my Family space',
    ]),
    negativeExamples: Object.freeze([
      'Rename the Family album to Family 2026',
      'Add Alex to the Family space',
      'Make Alex an editor in Family',
    ]),
    slots: Object.freeze({
      spaceRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the space.' }),
      newName: Object.freeze({ type: 'string', required: false, description: 'New space name, if renaming.' }),
      description: Object.freeze({ type: 'string', required: false, description: 'New description, if setting one.' }),
    }),
    requiredReadTools: Object.freeze(['listSpaces']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Update space details',
      tier: 'Solid now',
      workflowOrBoundary: 'Direct space-detail update plan; preserve unspecified fields. Durable space disambiguation: ambiguous space gets a storable candidate list.',
    }),
  }),
  Object.freeze({
    kind: 'rename_person',
    flow: 'hybrid',
    title: 'Rename a person',
    classifierDescription:
      'User wants to rename a person in their People view (change the displayed name). Requires both the current name/reference and a new name. Declines when the ref contains a container noun (album/space).',
    positiveExamples: Object.freeze([
      'Rename Alejandra to Karina',
      'rename alex to alexander',
      'Change this person\'s name to Bob',
    ]),
    negativeExamples: Object.freeze([
      'Rename the Family album to Family 2026',
      'Rename the Trips space to Adventures',
      'Hide Alex',
    ]),
    slots: Object.freeze({
      personRef: Object.freeze({ type: 'string', required: true, description: 'Current person name or reference.' }),
      newName: Object.freeze({ type: 'string', required: true, description: 'New name to assign to the person.' }),
    }),
    requiredReadTools: Object.freeze(['searchPeople']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Rename person',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the person via searchPeople (durable disambiguation); Gallery owns the person.update plan with { name } payload.',
    }),
  }),
  Object.freeze({
    kind: 'set_person_birthdate',
    flow: 'hybrid',
    title: "Set a person's birthday",
    classifierDescription:
      "User wants to record a person's date of birth / birthday / birthdate. Accepts ISO dates (1990-05-01) and natural English dates (\"May 1 1990\", \"1st May 1990\"). Future dates are rejected.",
    positiveExamples: Object.freeze([
      "set Alex's birthday to 1990-05-01",
      "set Alex's birthdate to May 1 1990",
      "set Alex's date of birth to 1st May 1990",
    ]),
    negativeExamples: Object.freeze([
      'Rename Alex to Alexander',
      'Hide Alex',
      "set Alex's birthday",
    ]),
    slots: Object.freeze({
      personRef: Object.freeze({ type: 'string', required: true, description: 'Person name or reference.' }),
      dateStr: Object.freeze({ type: 'string', required: true, description: 'Birth date string (ISO or natural English).' }),
    }),
    requiredReadTools: Object.freeze(['searchPeople']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Set person birthday',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the person via searchPeople (durable disambiguation) and parses the date; Gallery owns the person.update plan with { birthDate } payload. Future dates and unparseable strings are rejected with needsInput.',
    }),
  }),
  Object.freeze({
    kind: 'lock_assets',
    flow: 'hybrid',
    title: 'Move photos to the Locked folder',
    classifierDescription:
      'User wants to move a metadata-describable set of photos (recency/date/type bound) or a named entity into the Locked (private) folder: "lock my passport scans", "move my 2024 receipts to the locked folder", "put these in my private folder", "hide my newest 20 in the locked folder". One-directional (lock only, never unlock). Plain "hide <person>" with no folder cue (hide_person), archive, and trash are out of scope.',
    positiveExamples: Object.freeze([
      'Lock my passport scans',
      'Move my 2024 receipts to the locked folder',
      'Put these in my private folder',
      'Hide my newest 20 in the locked folder',
    ]),
    negativeExamples: Object.freeze([
      'Hide Alex',
      'Archive my newest 50 photos',
      'Trash my newest 20 photos',
      'Lock the best ones',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos to move to the Locked folder.',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Move photos to the Locked folder',
      tier: 'Solid now',
      workflowOrBoundary:
        "Pi resolves a bounded source; Gallery owns the batch asset.setVisibility (visibility: 'locked') plan from the handle. Lock only — no unlock. Subjective sources and bare \"hide <person>\" decline; lockAssets write-scope required.",
    }),
  }),
  Object.freeze({
    kind: 'hide_person',
    flow: 'hybrid',
    title: 'Hide or unhide a person',
    classifierDescription:
      'User wants to hide a person from the People view (isHidden:true) or unhide/show a previously hidden person (isHidden:false). "hide <name>" hides; "unhide/show/un-hide <name>" unhides. For unhide, hidden people are included in the search. Declines when the ref contains a container noun (album/space).',
    positiveExamples: Object.freeze([
      'hide Alex',
      'hide Alex from my People list',
      'unhide Alex',
      'show Alex',
      'un-hide Alex',
    ]),
    negativeExamples: Object.freeze([
      'hide the Family album',
      'rename Alex to Bob',
      'archive my newest 20 photos',
    ]),
    slots: Object.freeze({
      personRef: Object.freeze({ type: 'string', required: true, description: 'Person name or reference.' }),
      verb: Object.freeze({ type: 'string', required: true, description: '"hide" or "unhide".' }),
    }),
    requiredReadTools: Object.freeze(['searchPeople']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Hide/unhide person',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the person via searchPeople (includeHidden:true for unhide); Gallery owns the person.update plan with { isHidden } payload. Durable disambiguation: ambiguous person gets a storable candidate list.',
    }),
  }),
  Object.freeze({
    kind: 'merge_people',
    flow: 'hybrid',
    title: 'Merge two people',
    classifierDescription:
      'User wants to merge two people in their People view — reassigning the source person\'s faces to the kept person, then deleting the source. HIGH RISK: irreversible. Accepts "merge A into B" (keep=B) or "merge A and B" (keep=last-named, B).',
    positiveExamples: Object.freeze([
      'Merge Alejandra into Karina',
      'Merge Alex into Alexander',
      'Merge Alex and Karina',
    ]),
    negativeExamples: Object.freeze([
      'Merge duplicate photos',
      'Merge the Summer and Spring albums',
    ]),
    slots: Object.freeze({
      sourceRef: Object.freeze({ type: 'string', required: true, description: 'Person to merge FROM (will be deleted).' }),
      keepRef: Object.freeze({ type: 'string', required: true, description: 'Person to merge INTO (will be kept).' }),
    }),
    requiredReadTools: Object.freeze(['searchPeople']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Merge people',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves both people via searchPeople (two-stage durable disambiguation: source then keep); Gallery owns the person.merge plan (High risk, irreversible — faces reassigned, source deleted). Same-person guard declines self-merge. managePeople write-scope required.',
    }),
  }),
  Object.freeze({
    kind: 'manage_album_access',
    flow: 'strict',
    title: 'Share an album with users',
    classifierDescription:
      'User wants to share an album with one or more Gallery users (add or remove access), optionally with a role (editor/viewer). Distinct from sharing as a public link (share_album) and from managing a space\'s member list (manage_space_members).',
    positiveExamples: Object.freeze([
      'Share the Family album with Alex',
      'Give Alex edit access to the Beach album',
      'Add Sam to the Trips album as a viewer',
      'Remove Bob from the Family album',
    ]),
    negativeExamples: Object.freeze([
      'Share the Family album as a link',
      'Add Alex to the Family space',
      'Add my newest 20 photos to the Family album',
      'Share my newest 20 photos as a link',
    ]),
    slots: Object.freeze({
      action: Object.freeze({ type: 'string', required: true, description: 'add or remove.' }),
      memberQueries: Object.freeze({
        type: 'array',
        required: true,
        description: 'User names or emails to add or remove.',
      }),
      albumRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the album.' }),
      role: Object.freeze({
        type: 'string',
        required: false,
        description: 'editor or viewer (default viewer on add).',
      }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'readAlbum', 'searchUsers']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Share an album with people',
      tier: 'Solid now',
      workflowOrBoundary:
        'Resolve album + users (durable two-stage disambiguation); guard owner/already-member; propose album.addUsers or album.removeUsers plan. shareAlbums write-scope required.',
    }),
  }),
  Object.freeze({
    kind: 'change_album_member_role',
    flow: 'strict',
    title: "Change an album member's role",
    classifierDescription:
      "User wants to change an existing album member's role to editor or viewer. The prompt MUST mention the word 'album'. Declines 'space' targets (those belong to change_member_role).",
    positiveExamples: Object.freeze([
      'Make Alex an editor on the Family album',
      "Change Bob's role to viewer in the Family album",
      'Make Sam a viewer on the Beach album',
    ]),
    negativeExamples: Object.freeze([
      'Make Alex an editor in the Family space',
      'Add Alex to the Family album',
      'Share the Family album with Alex',
    ]),
    slots: Object.freeze({
      memberQuery: Object.freeze({ type: 'string', required: true, description: 'The member name or email.' }),
      role: Object.freeze({ type: 'string', required: true, description: 'editor or viewer.' }),
      albumRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the album (trailing "album" word stripped).' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'readAlbum', 'searchUsers']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Change an album member\'s role',
      tier: 'Solid now',
      workflowOrBoundary:
        'Resolve album + user (durable two-stage disambiguation); guard owner/no-op/non-member; propose album.updateUserRole plan. Requires "album" in the prompt (declines space targets).',
    }),
  }),
  Object.freeze({
    kind: 'manage_space_members',
    flow: 'strict',
    title: 'Add or remove space members',
    classifierDescription: 'User wants to add or remove members of a shared space, optionally with a role.',
    positiveExamples: Object.freeze([
      'Add Alex to the Family space as editor',
      'Add Sam and Jo to the Trips space',
      'Remove Bob from the Family space',
    ]),
    negativeExamples: Object.freeze([
      'Add my newest 20 photos to the Family space',
      'Make Alex an editor in Family',
      'Rename the Family space to Family 2026',
    ]),
    slots: Object.freeze({
      action: Object.freeze({ type: 'string', required: true, description: 'add or remove.' }),
      memberQueries: Object.freeze({
        type: 'array',
        required: true,
        description: 'Member names or emails to add or remove.',
      }),
      spaceRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the space.' }),
      role: Object.freeze({
        type: 'string',
        required: false,
        description: 'editor or viewer (default viewer on add).',
      }),
    }),
    requiredReadTools: Object.freeze(['listSpaces', 'readSpace', 'searchUsers']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Add or remove space members',
      tier: 'Solid now',
      workflowOrBoundary: 'Resolve members; guard owner/self/last-owner removal; propose the membership plan. Durable two-stage disambiguation: ambiguous space then ambiguous user each get a storable candidate list.',
    }),
  }),
  Object.freeze({
    kind: 'change_member_role',
    flow: 'strict',
    title: "Change a space member's role",
    classifierDescription: "User wants to change a shared-space member's role to editor or viewer.",
    positiveExamples: Object.freeze([
      'Make Alex an editor in the Family space',
      "Change Bob's role to viewer in Trips",
      'Make Sam a viewer in Family',
    ]),
    negativeExamples: Object.freeze([
      'Add Alex to the Family space',
      'Remove Bob from the Family space',
      'Rename the Family space to Family 2026',
    ]),
    slots: Object.freeze({
      memberQuery: Object.freeze({ type: 'string', required: true, description: 'The member name or email.' }),
      role: Object.freeze({ type: 'string', required: true, description: 'editor or viewer.' }),
      spaceRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the space.' }),
    }),
    requiredReadTools: Object.freeze(['listSpaces', 'readSpace', 'searchUsers']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Change space member roles',
      tier: 'Solid now',
      workflowOrBoundary: 'Resolve the member; guard owner/self/no-op; propose the role-change plan. Durable two-stage disambiguation: ambiguous space then ambiguous user each get a storable candidate list.',
    }),
  }),
  Object.freeze({
    kind: 'create_album_from_source',
    flow: 'hybrid',
    title: 'Create album from a source',
    classifierDescription:
      'User wants a NEW album built from a metadata-describable set of photos (recency, date, type, or a named entity like people/tag/camera/rating/favorites), not a recent trip, vacation, or getaway.',
    positiveExamples: Object.freeze([
      'Make an album of my newest 50 photos',
      'Create an album from my 2024 photos called Best of 2024',
      'Build an album of my newest 100 photos',
      'Make an album of my Sony photos',
    ]),
    negativeExamples: Object.freeze([
      'Create an album for my recent trip to USA',
      'Add my newest 20 photos to Family',
      'Make an album of the best photos',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({
        type: 'string',
        required: true,
        description: 'Metadata description of the photos for the new album.',
      }),
      albumName: Object.freeze({
        type: 'string',
        required: false,
        description: 'Album name (defaults to New Album).',
      }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Create album from a source',
      tier: 'Solid now',
      workflowOrBoundary: 'Pi resolves a recency/date/type source; Gallery owns album creation from the handle.',
    }),
  }),
  Object.freeze({
    kind: 'create_space_from_source',
    flow: 'hybrid',
    title: 'Create space from a source',
    classifierDescription:
      'User wants a NEW shared space built from a metadata-describable set of photos — not a new album, not an existing-space photo add, and not a member add.',
    positiveExamples: Object.freeze([
      'Make a Family space of my newest 50 photos',
      'Create a shared space from my 2024 photos',
      'Make a space of my newest 20 photos titled South Africa',
    ]),
    negativeExamples: Object.freeze([
      'Make an album of my newest 50 photos',
      'Add my newest 20 photos to the Family space',
      'Rename the Family space to Family 2026',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos for the new space.' }),
      spaceName: Object.freeze({ type: 'string', required: false, description: 'Space name (defaults to New Space).' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeSpaceFromSearch',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Create space from a source',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the source; Gallery owns space creation from the wrapped selection handle (proposeSpaceFromSearch).',
    }),
  }),
]);

const byKind = new Map(WORKFLOW_MANIFEST.map((entry) => [entry.kind, entry]));

export const getWorkflowManifestEntry = (kind) => byKind.get(kind);
export const listWorkflowKinds = () => WORKFLOW_MANIFEST.map((entry) => entry.kind);
