# Workflow Expansion — Slice 24: Router precedence & disambiguation sweep

> A model-free, table-driven regex test locking in cross-workflow routing. The
> LLM-mode recall is covered by the L1 battery (100%, 72/72).

**Goal:** Every workflow's canonical + paraphrase prompts route to exactly one kind
via the regex fast-path; no prompt cross-matches. Already verified by probe — this
slice makes it a permanent regression gate. No guard changes needed (the per-slice
ordering + gates already disambiguate; if a future change regresses, this test
catches it).

**Spec scope:** Slice 24. The colliding prompts are already L1 negatives for the
other workflows (Slices 11/19/23: `neg.space.add-photos`, `neg.tag.removal`,
`neg.archive.subjective`, `neg.createalbum.subjective`).

## TDD — `agent-runner/src/strict-workflows/disambiguation.test.mjs`

Build the **regex-only** registry (`createWorkflowRegistry()` with no classifier →
the regex fallback) and assert `classify(prompt).kind` for the table below. ~35
cross-cutting prompts. Verified routing (probe):

| Prompt                                                    | kind                     |
| --------------------------------------------------------- | ------------------------ |
| create an album for my recent trip to USA                 | create_recent_trip_album |
| make an album for my recent trip                          | create_recent_trip_album |
| make an album of my newest 50 photos                      | create_album_from_source |
| create an album from my 2024 photos called Best of 2024   | create_album_from_source |
| build an album of my newest 100 photos                    | create_album_from_source |
| add my newest 20 photos to Family                         | add_photos_to_album      |
| add my newest 20 photos to the Family space               | add_photos_to_album      |
| add my Berlin photos from last weekend to the Trips album | add_photos_to_album      |
| archive my newest 50 photos                               | archive_assets           |
| unarchive my last 10 photos                               | archive_assets           |
| move my 2024 photos out of the archive                    | archive_assets           |
| favorite my newest 10 photos                              | favorite_assets          |
| unfavorite my last 5 photos                               | favorite_assets          |
| add my newest 20 photos to my favorites                   | favorite_assets          |
| tag my newest 20 photos as Travel                         | tag_assets               |
| add the tag Spring Break to my newest 50 photos           | tag_assets               |
| add the Travel tag to my last 10 photos                   | tag_assets               |
| rename the Family space to Family 2026                    | rename_or_describe_space |
| set the description on the Trips space to Our adventures  | rename_or_describe_space |
| rename the Family album to Family 2026                    | rename_or_describe_album |
| set the description on my Italy album to Summer 2026      | rename_or_describe_album |
| add Alex to the Family space as editor                    | manage_space_members     |
| remove Bob from the Trips space                           | manage_space_members     |
| add Sam and Jo to the Family space                        | manage_space_members     |
| make Alex an editor in Family                             | change_member_role       |
| change Bob's role to viewer in Trips                      | change_member_role       |
| make Sam a viewer in the Family space                     | change_member_role       |
| archive the best ones                                     | none                     |
| favorite the best 3 photos from last weekend              | none                     |
| remove the Travel tag from my newest 20                   | none                     |
| make an album of the best photos                          | none                     |
| how many photos do I have?                                | none                     |
| thanks, that looks great                                  | none                     |

Also assert structurally: **every registered workflow kind appears as the routed
kind for at least one prompt** (so the table covers the whole set) — derive the
registered kinds from `registry.listWorkflows()` and assert the set of non-`none`
expected kinds ⊇ that set.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New `disambiguation.test.mjs` green (no cross-matches); all prior green.

## Commit

`test: add cross-workflow disambiguation sweep (regex precedence) (slice 24)`
