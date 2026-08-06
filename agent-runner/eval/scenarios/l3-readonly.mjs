// L3 read-only scenarios — run against a live Gallery stack via `--layer L3`.
//
// Two kinds of assertion:
//   - routing (`kind` / `anyKind`): data-independent. Classification happens
//     before any library lookup, so these hold against ANY instance (even an
//     empty dev stack) as long as the runner is wired and classifying.
//   - plan-proposed (`planProposed: true`): data-DEPENDENT. The strict workflow
//     must actually find matching data (a detectable trip, a resolvable album)
//     to propose a plan. These are meant for a real library with "lots of data"
//     (the personal instance) and may legitimately not propose on an empty
//     stack — that's a missing-data signal, not a routing regression.
//   - outcome count (`minOutcomeCount: N`) / turn count (`minTurnsWithOutcome: N`):
//     multi-turn progress. Follow-up specs use this to prove later user messages
//     re-entered the strict workflow instead of only preserving the first turn's
//     routing decision.
//
// L3 activity summaries are scrubbed of slot values, so we never assert exact
// slots here (that's L1's job). `none` is asserted for negatives — the agent
// must NOT fabricate a strict workflow for questions/chatter/unsupported intents.
import config from '../config.mjs';

// Membership/role plan-proposed is asserted only on the local seeded stack (known
// members + a seeded non-owner). Against personal (single user = owner), those
// scenarios assert routing only.
const SEEDED = config.l3.seeded;

export default [
  // --- routing: the agent reaches the right strict workflow -----------------
  {
    id: 'l3.recall.trip.usa',
    category: 'l3.recall',
    prompt: 'Create an album for my recent trip to USA',
    expect: { kind: 'create_recent_trip_album' },
  },
  {
    id: 'l3.recall.trip.noplace',
    category: 'l3.recall',
    prompt: 'Make an album for my recent trip',
    expect: { kind: 'create_recent_trip_album' },
  },
  {
    id: 'l3.recall.trip.uncommon-verb',
    category: 'l3.recall',
    prompt: 'throw the pics from our Italy getaway into a new album',
    expect: { kind: 'create_recent_trip_album' },
  },
  {
    id: 'l3.recall.rename',
    category: 'l3.recall',
    prompt: 'rename the Family album to Family 2026',
    expect: { kind: 'rename_or_describe_album' },
  },
  {
    // Routing-only: deleteContainers scope is OFF in the VisualOrganizer eval
    // preset, so no planProposed assertion. Classification is pre-lookup and
    // data-independent so the routing assertion holds against any stack.
    id: 'l3.recall.deletealbum',
    category: 'l3.recall',
    prompt: 'delete the Test album',
    expect: { kind: 'delete_album' },
  },
  {
    // Routing-only: deleteContainers scope is OFF in the VisualOrganizer eval
    // preset, so the server would reject the apply — but classification is
    // pre-lookup and data-independent, so the routing assertion holds against
    // any stack. Server enforces owner-level permission (SharedSpaceDelete).
    id: 'l3.recall.deletespace',
    category: 'l3.recall',
    prompt: 'delete the Test space',
    expect: { kind: 'delete_space' },
  },
  {
    id: 'l3.recall.add.newest20',
    category: 'l3.recall',
    prompt: 'add my newest 20 photos to Family',
    expect: { kind: 'add_photos_to_album' },
  },
  {
    // Heavy paraphrase with no trip keyword for the regex fast-path — forces the
    // LIVE model classifier (via=llm), unlike the canonical prompts above.
    id: 'l3.recall.trip.lisbon.llm',
    category: 'l3.recall',
    prompt: 'put together an album from our weekend away in Lisbon',
    expect: { kind: 'create_recent_trip_album' },
  },
  {
    // The describe variant (vs rename) — end-to-end coverage of the describe
    // slot path. Routing happens before any album lookup, so it holds whether or
    // not an "Italy album" exists.
    id: 'l3.recall.describe.italy',
    category: 'l3.recall',
    prompt: 'set the description on my Italy album to Summer 2026 memories',
    expect: { kind: 'rename_or_describe_album' },
  },
  {
    id: 'l3.recall.archive',
    category: 'l3.recall',
    prompt: 'archive my newest 20 photos',
    expect: { kind: 'archive_assets' },
  },
  {
    // Routing-only: lockAssets scope is OFF in the VisualOrganizer eval preset so
    // the plan is blocked at the server level — no planProposed assertion here.
    // Classification happens before any library lookup or scope check, so the
    // routing assertion holds against any stack.
    id: 'l3.recall.lock',
    category: 'l3.recall',
    prompt: 'lock my passport scans',
    expect: { kind: 'lock_assets' },
  },
  {
    // screenshot cleanup routing: the "screenshots" source rides the archive verb
    // (routing is pre-resolution); the source resolves tag-first at run time.
    id: 'l3.recall.screenshots',
    category: 'l3.recall',
    prompt: 'archive my screenshots',
    expect: { kind: 'archive_assets' },
  },
  {
    // verb parity: the same "screenshots" source rides the trash verb → trash_assets
    // (not archive). Confirms the source is verb-agnostic and the bounded
    // (non-"all") phrasing is not declined like the "delete all my screenshots" neg.
    id: 'l3.recall.screenshots.trash',
    category: 'l3.recall',
    prompt: 'trash my screenshots',
    expect: { kind: 'trash_assets' },
  },
  {
    id: 'l3.recall.favorite',
    category: 'l3.recall',
    prompt: 'favorite my newest 10 photos',
    expect: { kind: 'favorite_assets' },
  },
  {
    id: 'l3.recall.tag',
    category: 'l3.recall',
    prompt: 'tag my newest 20 photos as "eval-l3"',
    expect: { kind: 'tag_assets' },
  },
  {
    // untag_assets routing: tag removal reaches the new workflow live (regex
    // fast-path; the literal "tag" token keeps it off remove_photos_from_album).
    id: 'l3.recall.untag',
    category: 'l3.recall',
    prompt: 'remove the "eval-l3" tag from my newest 20',
    expect: { kind: 'untag_assets' },
  },
  {
    // adjust_assets routing: tonal verbs reach the new workflow live (verb-driven,
    // unlike crop's coordinate intent — propose-only, editAssets granted in visual-organizer).
    id: 'l3.recall.adjust.brighten',
    category: 'l3.recall',
    prompt: 'brighten my last 10 photos',
    expect: { kind: 'adjust_assets' },
  },
  {
    id: 'l3.recall.adjust.vivid',
    category: 'l3.recall',
    prompt: 'make my newest 10 photos more vivid',
    expect: { kind: 'adjust_assets' },
  },
  {
    id: 'l3.recall.adjust.autoenhance',
    category: 'l3.recall',
    prompt: 'auto-enhance my newest 5 photos',
    expect: { kind: 'adjust_assets' },
  },
  {
    // flip_assets routing: mirror reaches the new workflow live; "upside down" stays rotate.
    id: 'l3.recall.flip.horizontal',
    category: 'l3.recall',
    prompt: 'flip my newest 5 photos horizontally',
    expect: { kind: 'flip_assets' },
  },
  {
    id: 'l3.recall.flip.mirror',
    category: 'l3.recall',
    prompt: 'mirror my newest 5 photos',
    expect: { kind: 'flip_assets' },
  },
  {
    // recent-upload source: an upload-dated source still verb-routes to archive
    // (the resolver bounds it by createdAfter at run time, not at routing).
    id: 'l3.recall.upload',
    category: 'l3.recall',
    prompt: 'archive everything I uploaded today',
    expect: { kind: 'archive_assets' },
  },
  {
    // trash_assets routing: reversible trash reaches the new workflow live.
    id: 'l3.recall.trash',
    category: 'l3.recall',
    prompt: 'trash my newest 20 photos',
    expect: { kind: 'trash_assets' },
  },
  {
    // restore_assets routing: un-trash reaches the new workflow live (must NOT
    // be stolen by trash_assets — the "from trash"/"restore" verb owns it).
    id: 'l3.recall.restore',
    category: 'l3.recall',
    prompt: 'restore my newest 20 from trash',
    expect: { kind: 'restore_assets' },
  },
  {
    // cleanup_duplicates routing: the duplicate keyword owns it (not trash_assets).
    id: 'l3.recall.duplicates',
    category: 'l3.recall',
    prompt: 'clean up my duplicate photos',
    expect: { kind: 'cleanup_duplicates' },
  },
  {
    id: 'l3.recall.visualcleanup.blurry',
    category: 'l3.recall',
    prompt: 'trash my blurry photos',
    expect: { kind: 'visual_cleanup' },
  },
  {
    id: 'l3.recall.visualcleanup.dark',
    category: 'l3.recall',
    prompt: 'delete dark photos from my recent uploads',
    expect: { kind: 'visual_cleanup' },
  },
  {
    id: 'l3.recall.space.describe',
    category: 'l3.recall',
    prompt: 'set the description on the {space} space to Shared memories',
    expect: { kind: 'rename_or_describe_space' },
  },
  {
    id: 'l3.recall.members.add',
    category: 'l3.recall',
    prompt: 'add {user} to the {space} space as editor',
    expect: { kind: 'manage_space_members' },
  },
  {
    id: 'l3.recall.role',
    category: 'l3.recall',
    prompt: 'make {user} an editor in the {space} space',
    expect: { kind: 'change_member_role' },
  },
  {
    // change_album_member_role routing: requires "album" in the prompt.
    // Holds against any instance (routing happens before any library lookup).
    id: 'l3.recall.albumrole',
    category: 'l3.recall',
    prompt: 'make {user} an editor on the {album} album',
    expect: { kind: 'change_album_member_role' },
  },
  {
    // Plan scenario: role change on an existing album member (propose-only).
    // shareAlbums write-scope required; gated on SEEDED (known album + non-owner member).
    id: 'l3.plan.albumrole',
    category: 'l3.plan',
    prompt: 'make {user} an editor on the {album} album',
    expect: { kind: 'change_album_member_role', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    id: 'l3.recall.createalbum',
    category: 'l3.recall',
    prompt: 'make an album of my newest 20 photos called eval-l3',
    expect: { kind: 'create_album_from_source' },
  },
  {
    id: 'l3.recall.geocode',
    category: 'l3.recall',
    prompt: 'set the location on my newest 20 to Paris',
    expect: { kind: 'update_asset_metadata' },
  },

  // --- share_album: propose-only (NEVER APPLIED) ---------------------------
  // OUTWARD-FACING safety: createSharedLinks write-scope defaults false in every
  // preset (including the L3 VisualOrganizer preset used for eval). The agent
  // can PROPOSE a shareLink.createAlbum plan but CANNOT APPLY it — the server
  // will reject the apply with a write-scope error. The L3 eval is read-only
  // (audit confirms no plan is applied), so no outward-facing link is created.
  // NO planProposed assertion here — createSharedLinks is OFF in the eval
  // preset, so the workflow is propose-blocked; routing-only is all we assert.
  {
    // Routing-only: the share verb + "album" noun routes to share_album.
    // Holds against any instance including an empty dev stack.
    id: 'l3.recall.share-album',
    category: 'l3.recall',
    prompt: 'share the Family album as a link',
    expect: { kind: 'share_album' },
  },

  // --- share_assets: propose-only (NEVER APPLIED) --------------------------
  // OUTWARD-FACING safety: createSharedLinks write-scope defaults false in every
  // preset (including the L3 VisualOrganizer/PowerUser presets). This means the
  // agent can PROPOSE a shareLink.create plan but CANNOT APPLY it — the server
  // will reject the apply with a write-scope error. The L3 eval is read-only
  // (audit confirms no plan is applied), so no outward-facing link is created
  // in any eval run regardless of the routing result.
  {
    // Routing-only: the share verb routes to share_assets (regex fast-path).
    // Holds against any instance including an empty dev stack.
    id: 'l3.recall.share',
    category: 'l3.recall',
    prompt: 'share my newest 20 as a link',
    expect: { kind: 'share_assets' },
  },
  {
    // Plan scenario: recency → shareLink.create plan (PROPOSE-ONLY, NEVER APPLIED).
    // createSharedLinks is NOT granted in any preset, so even if the workflow
    // resolves a non-empty source and reaches proposeAlbumOperations, the apply
    // step would be blocked by the server write-scope guard. The eval runner is
    // read-only and never applies plans — asserting routing only (planProposed
    // is gated on SEEDED to avoid false failures on empty stacks, but even when
    // SEEDED the plan is proposed, never applied).
    id: 'l3.plan.share',
    category: 'l3.plan',
    prompt: 'share my newest 20 photos as a link',
    expect: { kind: 'share_assets', planProposed: SEEDED ? true : undefined },
    // Conservative threshold — data-dependent (needs at least one owned asset).
    threshold: 0.5,
  },

  // --- negatives: must NOT fabricate a strict workflow ----------------------
  {
    id: 'l3.neg.count',
    category: 'l3.negatives',
    prompt: 'how many photos do I have?',
    expect: { kind: 'none' },
  },
  {
    id: 'l3.neg.thanks',
    category: 'l3.negatives',
    prompt: 'thanks, that looks great!',
    expect: { kind: 'none' },
  },
  {
    id: 'l3.neg.favorite',
    category: 'l3.negatives',
    prompt: 'favorite my best shots from last year',
    expect: { kind: 'none' },
  },
  {
    id: 'l3.neg.search',
    category: 'l3.negatives',
    prompt: 'find my Sony photos from May',
    expect: { kind: 'none' },
  },
  {
    id: 'l3.neg.subjective',
    category: 'l3.negatives',
    prompt: 'show me the good ones',
    expect: { kind: 'none' },
  },
  {
    id: 'l3.neg.where',
    category: 'l3.negatives',
    prompt: 'where were these taken?',
    expect: { kind: 'none' },
  },
  {
    // "delete" now maps to the reversible trash workflow (asset.trash). The
    // unbounded "all my screenshots" source is not blindly actioned: the workflow
    // asks for a bounded scope (needs_input) and NEVER applies — the read-only
    // audit at the end of this run confirms no plan was applied in any session.
    id: 'l3.recall.delete-as-trash',
    category: 'l3.recall',
    prompt: 'delete all my screenshots',
    expect: { kind: 'trash_assets' },
  },
  {
    // Subjective archive source — declines (regex) / manifest negative (LLM).
    id: 'l3.neg.archive.subjective',
    category: 'l3.negatives',
    prompt: 'archive the best ones',
    expect: { kind: 'none' },
  },
  {
    // Adding photos to a space now routes to manage_space_assets.
    id: 'l3.recall.space.add-photos',
    category: 'l3.recall',
    prompt: 'add my newest 20 photos to the {space} space',
    expect: { kind: 'manage_space_assets' },
  },
  {
    // manage_space_assets end-to-end: recency → proposeAddAssetsToSpaceFromSearch plan.
    // Data-dependent; threshold 0.5 tolerates variance.
    id: 'l3.plan.space.add',
    category: 'l3.plan',
    prompt: 'add my newest 20 photos to the {space} space',
    expect: { kind: 'manage_space_assets', planProposed: true },
    threshold: 0.5,
  },

  // --- plan-proposed: end-to-end against a real library ---------------------
  // Routes to the trip workflow AND proposes a reviewable plan (never applied).
  // A PLACE-specified trip is the robust plan probe: the no-place form ("my most
  // recent trip") is correctly ambiguous on a many-trip library and the agent
  // returns needs_input rather than guessing (verified live) — so we assert the
  // plan on a place-qualified prompt the library can satisfy unambiguously.
  {
    id: 'l3.plan.trip.usa',
    category: 'l3.plan',
    prompt: 'Create an album for my recent trip to USA',
    expect: { kind: 'create_recent_trip_album', planProposed: true },
    // Needs library data; tolerate variance across repeats.
    threshold: 0.5,
  },
  {
    // rename_or_describe_album end-to-end (describe arm): proposes an album.update
    // setting a description on a REAL album — proposed, never applied. `{album}`
    // resolves read-only to the user's most-populated album. Exercises the
    // describe-slot value capture all the way to a persisted plan.
    id: 'l3.plan.describe.discovered',
    category: 'l3.plan',
    prompt: 'set the description on the {album} album to Favorite memories',
    expect: { kind: 'rename_or_describe_album', planProposed: true },
    threshold: 0.5,
  },
  {
    // add_photos_to_album end-to-end, recency arm: "newest N" resolves via a
    // bounded metadata search (newest-first) into a selection handle and proposes
    // a duplicate-safe album.addAssets — proposed, never applied. `{album}` is a
    // real album. (This is the path the resolveAssetSearchFilters bug broke; it
    // now exercises the Option-1 recency fix end-to-end.)
    id: 'l3.plan.add.recency',
    category: 'l3.plan',
    prompt: 'add my newest 20 photos to {album}',
    expect: { kind: 'add_photos_to_album', planProposed: true },
    threshold: 0.5,
  },
  {
    // update_asset_metadata place-name geocoding end-to-end: "Paris" resolves to
    // coordinates via resolveLocation (forward geocode over geodata_places) and
    // proposes an asset.updateMetadata with the resolved lat/lng over a bounded
    // newest-N selection — proposed, never applied. Data-dependent (needs
    // geodata_places loaded + owned assets); routing-only when unseeded.
    id: 'l3.plan.geocode',
    category: 'l3.plan',
    prompt: 'set the location on my newest 20 to Paris',
    expect: { kind: 'update_asset_metadata', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // archive_assets end-to-end: a recency source resolves to a selection handle
    // and proposes a batch asset.setArchive — proposed, never applied.
    id: 'l3.plan.archive.recency',
    category: 'l3.plan',
    prompt: 'archive my newest 20 photos',
    expect: { kind: 'archive_assets', planProposed: true },
    threshold: 0.5,
  },
  {
    // screenshot cleanup end-to-end: "my screenshots" resolves tag-first to the
    // Screenshots / Auto/Screenshots classification tag and proposes a batch
    // asset.setArchive — proposed, never applied. Data-dependent (needs a
    // Screenshots classification category configured + tagged assets); routing-only
    // when unseeded (the resolver discloses + hands off if untagged).
    id: 'l3.plan.screenshots',
    category: 'l3.plan',
    prompt: 'archive my screenshots',
    expect: { kind: 'archive_assets', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // untag_assets end-to-end: needs a tag that EXISTS on real owned assets to
    // resolve the name->id and propose an asset.removeTag plan. On unseeded
    // personal (no guaranteed "eval-l3" tag) this asserts routing only.
    id: 'l3.plan.untag.tag',
    category: 'l3.plan',
    prompt: 'remove the "eval-l3" tag from my newest 20',
    expect: { kind: 'untag_assets', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // recent-upload end-to-end: "recent uploads" resolves to a createdAfter
    // window (last 30 days) -> a bounded selection -> a reviewable archive plan.
    // Data-dependent (needs assets uploaded recently); routing-only when unseeded.
    id: 'l3.plan.upload.recency',
    category: 'l3.plan',
    prompt: 'archive my recent uploads',
    expect: { kind: 'archive_assets', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // trash_assets end-to-end (PROPOSE-ONLY, never applied): recency resolves to a
    // selection handle and proposes a reversible asset.trash plan. The L3 preset is
    // visual-organizer, which now grants `trashAssets`, so the plan proposes live;
    // the read-only audit must confirm NO plan was applied (nothing is trashed).
    id: 'l3.plan.trash.recency',
    category: 'l3.plan',
    prompt: 'trash my newest 20 photos',
    expect: { kind: 'trash_assets', planProposed: true },
    threshold: 0.5,
  },
  {
    // restore_assets end-to-end (PROPOSE-ONLY, never applied): a trashed-asset
    // source (isTrashed:true injected) resolves to a selection handle and proposes
    // a reversible asset.restore plan. Data-dependent (needs assets in the trash);
    // routing-only when unseeded. The read-only audit must confirm NO plan applied.
    id: 'l3.plan.restore',
    category: 'l3.plan',
    prompt: 'restore my newest 20 from trash',
    expect: { kind: 'restore_assets', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // cleanup_duplicates end-to-end: lists duplicate groups, keeps one per group,
    // proposes an asset.trash over the non-keepers. Data-dependent (needs detected
    // duplicates); routing-only when unseeded. Propose-only, never applied.
    id: 'l3.plan.duplicates',
    category: 'l3.plan',
    prompt: 'clean up my duplicate photos',
    expect: { kind: 'cleanup_duplicates', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    id: 'l3.plan.visualcleanup.blurry',
    category: 'l3.plan',
    prompt: 'trash my blurry photos from last month',
    expect: { kind: 'visual_cleanup', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // favorite_assets end-to-end: recency → batch asset.setFavorite plan.
    id: 'l3.plan.favorite.recency',
    category: 'l3.plan',
    prompt: 'favorite my newest 10 photos',
    expect: { kind: 'favorite_assets', planProposed: true },
    threshold: 0.5,
  },
  {
    // tag_assets end-to-end: recency → batch asset.addTag plan (a distinctive tag
    // name; the plan is proposed only, so no tag is created).
    id: 'l3.plan.tag.recency',
    category: 'l3.plan',
    prompt: 'tag my newest 20 photos as "eval-l3"',
    expect: { kind: 'tag_assets', planProposed: true },
    threshold: 0.5,
  },
  {
    // rename_or_describe_space end-to-end: proposes space.updateDetails setting a
    // description on a discovered {space} — proposed, never applied. Works on any
    // instance that has a space.
    id: 'l3.plan.describe.space',
    category: 'l3.plan',
    prompt: 'set the description on the {space} space to L3 eval note',
    expect: { kind: 'rename_or_describe_space', planProposed: true },
    threshold: 0.5,
  },
  {
    // manage_space_members end-to-end. plan-proposed only on the local seeded stack
    // (a {user} not already in {space}); routing-only on personal (single user).
    id: 'l3.plan.members.add',
    category: 'l3.plan',
    prompt: 'add {user} to the {space} space as editor',
    expect: { kind: 'manage_space_members', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // change_member_role end-to-end. plan-proposed only on the local seeded stack
    // (a {user} who IS a member with a different role); routing-only on personal.
    id: 'l3.plan.role.make',
    category: 'l3.plan',
    prompt: 'make {user} an editor in the {space} space',
    expect: { kind: 'change_member_role', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // create_album_from_source end-to-end: recency → album.create + album.addAssets
    // from the handle — proposed, never applied.
    id: 'l3.plan.createalbum',
    category: 'l3.plan',
    prompt: 'make an album of my newest 20 photos called eval-l3',
    expect: { kind: 'create_album_from_source', planProposed: true },
    threshold: 0.5,
  },

  // --- multi-turn: ask (needs_input) -> supply a place -> plan ---------------
  // Turn 1 is correctly ambiguous: with no place and no single confident trip,
  // the workflow asks for a place/dates rather than guessing (verified live).
  // Turn 2 supplies a concrete place and the workflow proposes a plan. Tests the
  // converse() path — a session recovering from needs_input and planning on the
  // next turn (never applied). (The candidate-selection *resume* path — "the
  // first one" — needs a place with several distinct trips, which is
  // library-specific, so we exercise the robust place-recovery flow instead.)
  {
    id: 'l3.multiturn.trip.recover',
    category: 'l3.multiturn',
    turns: ['Make an album for my recent trip', 'Create an album for my recent trip to USA'],
    expect: { kind: 'create_recent_trip_album', planProposed: true },
    threshold: 0.5,
  },
  {
    // The first turn is intentionally over-broad and should ask for a scope.
    // The second turn supplies the missing recent-upload window.
    // `minTurnsWithOutcome` proves both messages emitted strict workflow outcomes
    // instead of the follow-up falling through to open chat.
    id: 'l3.multiturn.visualcleanup.blurry.upload-window',
    category: 'l3.multiturn',
    turns: ['remove all blurry photos from my library', 'uploaded in the last 6 months'],
    expect: { kind: 'visual_cleanup', minTurnsWithOutcome: 2 },
    threshold: 0.5,
  },
  {
    // Same continuation shape for a different quality metric and a shorter
    // follow-up phrase. This covers the "recent uploads" shorthand that caused
    // repeated search/handle confusion in live sessions.
    id: 'l3.multiturn.visualcleanup.dark.recent-uploads',
    category: 'l3.multiturn',
    turns: ['remove all dark photos from my library', 'recent uploads'],
    expect: { kind: 'visual_cleanup', minTurnsWithOutcome: 2 },
    threshold: 0.5,
  },
  // Note: the space-only disambiguation-resume for rename_or_describe_space and
  // manage_space_assets is intentionally NOT covered by a live L3 multiturn here.
  // A robust L3 resume needs a turn-1 phrasing that is both ambiguous (no concrete
  // space name, to trigger the candidate list) AND routes to the SPACE workflow. On
  // the live model "set the description on one of my shared spaces" / "add my photos
  // to one of my shared spaces" lose to the rename_or_describe_album / add_photos_to_album
  // regexes (the vague "one of my shared spaces" is a weak space signal vs the album
  // verbs). The two-stage manage_space_members / change_member_role multiturn below
  // DO route correctly (the {user}+role tokens are strong space-member signals) and
  // exercise the shared continuation mechanism; the space-only path is fully covered
  // by the L2 unit suites (rename-or-describe-space / manage-space-assets *.test.mjs).
  {
    // Two-stage durable disambiguation (manage_space_members): turn 1 is an
    // ambiguous SPACE reference for a member op; turn 2 ("the first one") re-enters
    // via the persisted space-selection continuation (kind manage_space_members_space)
    // and proceeds to the member step (which may itself ask, when the user is
    // ambiguous, via a second continuation). Routing to manage_space_members always
    // holds; the two-turn re-entry is gated on SEEDED (needs 2+ matching spaces).
    id: 'l3.multiturn.spacepick.members',
    category: 'l3.multiturn',
    turns: ['add {user} to one of my shared spaces as editor', 'the first one'],
    expect: { kind: 'manage_space_members', minTurnsWithOutcome: SEEDED ? 2 : undefined },
    threshold: 0.5,
  },
  {
    // Two-stage durable disambiguation (change_member_role): turn 1 is an ambiguous
    // SPACE reference for a role change; turn 2 picks by ordinal and re-enters via
    // the continuation (kind change_member_role_space). Routing always holds; the
    // re-entry is gated on SEEDED.
    id: 'l3.multiturn.spacepick.role',
    category: 'l3.multiturn',
    turns: ['make {user} an editor in one of my shared spaces', 'the first one'],
    expect: { kind: 'change_member_role', minTurnsWithOutcome: SEEDED ? 2 : undefined },
    threshold: 0.5,
  },

  // --- update_asset_metadata routing + plan-proposed -----------------------
  {
    id: 'l3.recall.metadata.describe',
    category: 'l3.recall',
    prompt: 'set the description on my newest 20 photos to eval-l3',
    expect: { kind: 'update_asset_metadata' },
  },
  {
    id: 'l3.plan.metadata.recency',
    category: 'l3.plan',
    prompt: 'rate my newest 10 photos five stars',
    expect: { kind: 'update_asset_metadata', planProposed: true },
    threshold: 0.5,
  },

  // --- entity-source routing + plan-proposed --------------------------------
  {
    id: 'l3.recall.archive.entity',
    category: 'l3.recall',
    prompt: 'archive my Berlin photos',
    expect: { kind: 'archive_assets' },
  },
  {
    // tag_assets entity-source: resolveAssetSearchFilters → searchAssets handle
    // → addTag plan, proposed never applied. `{album}` discovery token resolves
    // the album entity live.
    id: 'l3.plan.tag.entity',
    category: 'l3.plan',
    prompt: 'tag photos in the {album} album as eval-l3',
    expect: { kind: 'tag_assets', planProposed: true },
    threshold: 0.5,
  },

  // --- move_photos_between_albums routing + plan-proposed -------------------
  {
    // move_photos_between_albums routing: the "move … from … to …" shape reaches
    // the new workflow live (regex fast-path; distinct move verb + mandatory from/to).
    // Uses {album} for the source (from) album and a literal destination.
    // {album2} substitution is NOT supported by the driver (only {album}/{space}/{user}
    // exist) — option (c) from the spec: use {album} + literal "Eval Keepers".
    // Routing is classification-only (pre-lookup), so this holds against any instance
    // even if "Eval Keepers" does not exist.
    id: 'l3.recall.move',
    category: 'l3.recall',
    prompt: 'move my newest 20 photos from {album} to Eval Keepers',
    expect: { kind: 'move_photos_between_albums' },
  },
  {
    // move end-to-end: recency → album.removeAssets + album.addAssets — proposed,
    // never applied. Strongly data-dependent: the destination "Eval Keepers" is a
    // literal that is almost certainly absent on any real instance, so the workflow
    // returns needs_input rather than a plan — planProposed is undefined (not
    // asserted). This scenario validates routing only in practice; planProposed
    // is gated on SEEDED but will remain unset unless "Eval Keepers" exists on the
    // seeded stack. See option (c) in the spec: no {album2} driver substitution
    // available, so end-to-end plan assertion is deferred.
    id: 'l3.plan.move.recency',
    category: 'l3.plan',
    prompt: 'move my newest 20 photos from {album} to Eval Keepers',
    expect: { kind: 'move_photos_between_albums', planProposed: undefined },
    threshold: 0.5,
  },

  // --- remove_photos_from_album routing + plan-proposed ---------------------
  {
    id: 'l3.recall.remove',
    category: 'l3.recall',
    prompt: 'remove my newest 20 photos from {album}',
    expect: { kind: 'remove_photos_from_album' },
  },
  {
    // remove_photos_from_album end-to-end: recency → album.removeAssets plan —
    // proposed, never applied. Strongly data-dependent: the newest-N photos must
    // already BE IN the target album to propose a non-empty removal (the empty-
    // removal safety asks for input otherwise). On an unseeded instance the
    // {album}-discovered album rarely contains the newest-N, so assert routing-only
    // (SEEDED gates the plan-proposed assertion, like the membership scenarios).
    id: 'l3.plan.remove.recency',
    category: 'l3.plan',
    prompt: 'remove my newest 20 photos from {album}',
    expect: { kind: 'remove_photos_from_album', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },

  // --- create_space_from_source routing + plan-proposed --------------------
  {
    id: 'l3.recall.createspace',
    category: 'l3.recall',
    prompt: 'make a Highlights space of my newest 20 photos',
    expect: { kind: 'create_space_from_source' },
  },
  {
    // LOAD-BEARING proof (Open Q3): selectionHandle assetSource expands to
    // space.create + space.addAssets on the real server. Plan is proposed, never
    // applied — no real space is created. threshold 0.5 tolerates library variance.
    id: 'l3.plan.createspace',
    category: 'l3.plan',
    prompt: 'make a space of my newest 20 photos called eval-l3-space',
    expect: { kind: 'create_space_from_source', planProposed: true },
    threshold: 0.5,
  },

  // --- rotate_assets routing + plan-proposed --------------------------------
  {
    id: 'l3.recall.rotate',
    category: 'l3.recall',
    prompt: 'rotate my newest 20 photos 90 clockwise',
    expect: { kind: 'rotate_assets' },
  },
  {
    // rotate_assets end-to-end: recency → batch asset.rotate plan — proposed,
    // never applied. Data-dependent; threshold 0.5 tolerates variance.
    id: 'l3.plan.rotate.recency',
    category: 'l3.plan',
    prompt: 'rotate my newest 20 photos 90 clockwise',
    expect: { kind: 'rotate_assets', planProposed: true },
    threshold: 0.5,
  },

  // --- crop_assets: NO live L3 routing assertion (OQ-F1 limitation) ----------
  // crop_assets is fully verified at L1 (recall.crop.comma-form / .labeled-form /
  // .zero-origin, with x/y/width/height slot fidelity) and L2 (crop-assets.test.mjs,
  // 28 cases), and the server propose seam was fixed so the op CAN be proposed once
  // reached (the deployed schema accepts an asset.crop batch action; see
  // agent-operation.dto.spec.ts "accepts proposeAssetBatch ... crop"). But a raw
  // coordinate-crop prompt ("crop my newest photo to 100,100,800,600") does NOT
  // engage the strict-workflow path through the LIVE LLM-driven agent: the session
  // produces no strict_router_decision (kind=none, via=null) even though
  // registry.classify() returns crop_assets via the regex fast-path in-process.
  // This is the OQ-F1 limitation the spec anticipated ("crop geometry from a
  // natural-language prompt is hard; scope tightly or defer") — coordinate crops
  // are not a natural live-agent intent. No reliable L3 routing assertion exists,
  // so none is made here (the classifier-level routing IS asserted at L1).

  // --- set_album_cover routing + plan-proposed ------------------------------
  {
    id: 'l3.recall.cover',
    category: 'l3.recall',
    prompt: 'set the cover of the {album} album to the first photo',
    expect: { kind: 'set_album_cover' },
  },
  {
    // set_album_cover end-to-end: first photo → album.setCover plan — proposed,
    // never applied. Strongly data-dependent: setting a cover requires the agent to
    // OWN the album, but the {album} discovered by assetCount on an unseeded instance
    // is often a shared/imported album the agent can read (readAlbum returns its
    // assetIds) but not modify (the server rejects the setCover op). The op shape +
    // index resolution are unit/L1-verified and the routing passes live; assert
    // routing-only here (SEEDED gates the plan-proposed assertion, like remove.recency).
    id: 'l3.plan.cover.index',
    category: 'l3.plan',
    prompt: 'set the cover of the {album} album to the first photo',
    expect: { kind: 'set_album_cover', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
  {
    // Subjective cover reference declines at the regex fast-path.
    id: 'l3.neg.cover.subjective',
    category: 'l3.negatives',
    prompt: 'pick a better cover for {album}',
    expect: { kind: 'none' },
  },

  // --- rename_person routing + plan-proposed --------------------------------
  {
    id: 'l3.recall.person.rename',
    category: 'l3.recall',
    prompt: 'Rename Alex to Alexander',
    expect: { kind: 'rename_person' },
  },
  {
    // rename_person end-to-end: searchPeople resolves, person.update plan proposed
    // (never applied). managePeople write-scope is true in VisualOrganizer (the L3
    // eval preset), so proposing is allowed; no live apply (PROPOSE-ONLY at L3).
    // Data-dependent: SEEDED gates plan-proposed (needs a person named "Alex" in the library).
    id: 'l3.plan.person.rename',
    category: 'l3.plan',
    prompt: 'Rename Alex to Alexander',
    expect: { kind: 'rename_person', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },

  // --- set_person_birthdate routing -------------------------------------------
  {
    id: 'l3.recall.person.birthdate',
    category: 'l3.recall',
    prompt: "set Alex's birthday to 1990-05-01",
    expect: { kind: 'set_person_birthdate' },
  },

  // --- hide_person routing ----------------------------------------------------
  {
    id: 'l3.recall.person.hide',
    category: 'l3.recall',
    prompt: 'hide Alex',
    expect: { kind: 'hide_person' },
  },

  // --- merge_people routing + plan-proposed -----------------------------------
  {
    id: 'l3.recall.person.merge',
    category: 'l3.recall',
    prompt: 'merge Alejandra into Karina',
    expect: { kind: 'merge_people' },
  },
  {
    // merge_people end-to-end: searchPeople resolves both, person.merge plan proposed
    // (never applied). managePeople write-scope is true in VisualOrganizer (the L3
    // eval preset), so proposing is allowed; no live apply (PROPOSE-ONLY at L3).
    // LOAD-BEARING audit: merge is IRREVERSIBLE — this scenario confirms the plan
    // was proposed (with High risk) and NEVER applied. Data-dependent: SEEDED gates
    // plan-proposed (needs two resolvable people named "Alejandra" and "Karina").
    id: 'l3.plan.person.merge',
    category: 'l3.plan',
    prompt: 'merge Alejandra into Karina',
    expect: { kind: 'merge_people', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },

  // --- stack_assets routing + plan-proposed ---------------------------------
  {
    id: 'l3.recall.stack',
    category: 'l3.recall',
    prompt: 'stack my newest 5 photos',
    expect: { kind: 'stack_assets' },
  },
  {
    // stack_assets end-to-end: recency source → batch asset.stack plan — PROPOSED
    // (not applied). manageStacks write-scope is true in VisualOrganizer (the L3
    // eval preset), so proposing is allowed; no live apply (PROPOSE-ONLY at L3).
    id: 'l3.plan.stack',
    category: 'l3.plan',
    prompt: 'stack my newest 5 photos',
    expect: { kind: 'stack_assets', planProposed: true },
    threshold: 0.5,
  },

  // --- unstack_assets routing -------------------------------------------------
  // unstack_assets is fully verified at L1/L2. A live unstack routing assertion
  // is omitted because the verb "unstack" is rarely used in live evals and the
  // routing seam is locked by the disambiguation table (unstack_assets entry).
  {
    id: 'l3.recall.unstack',
    category: 'l3.recall',
    prompt: 'unstack my newest 5 photos',
    expect: { kind: 'unstack_assets' },
  },

  // --- manage_album_access routing + plan-proposed --------------------------
  {
    // manage_album_access routing: the "share <album> with <user>" shape reaches
    // the workflow live (regex fast-path; album keyword + with-users gate).
    id: 'l3.recall.albumaccess.add',
    category: 'l3.recall',
    prompt: 'share the {album} album with {user}',
    expect: { kind: 'manage_album_access' },
  },
  {
    // manage_album_access remove routing: "remove <user> from <album>" shape.
    id: 'l3.recall.albumaccess.remove',
    category: 'l3.recall',
    prompt: 'remove {user} from the {album} album',
    expect: { kind: 'manage_album_access' },
  },
  {
    // manage_album_access end-to-end add: shareAlbums is ON in VisualOrganizer
    // (the eval preset) so the full propose path is exercised — proposed, never
    // applied. Data-dependent: {user} must not already have access to {album}.
    // planProposed is gated on SEEDED (needs a {user} not yet in {album}).
    id: 'l3.plan.albumaccess.add',
    category: 'l3.plan',
    prompt: 'share the {album} album with {user} as a viewer',
    expect: { kind: 'manage_album_access', planProposed: SEEDED ? true : undefined },
    threshold: 0.5,
  },
];
