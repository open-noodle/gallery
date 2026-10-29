# Cleanup contract fixtures

Recorded real-server traffic for Library Cleanup on mobile (`specs/2026-10-29-mobile-library-cleanup-design.md`,
"Testing approach"). Each file is one request the app sends and the response the real server gave.

- **Written and checked by** `e2e/src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts`. In CI it replays every
  file here, in file order, against a freshly seeded server and fails on any difference. To re-record after a
  deliberate server change, run it with `CLEANUP_CONTRACT_RECORD=1` against an e2e stack built from your branch, then
  review the diff:

  ```bash
  cd e2e && CLEANUP_CONTRACT_RECORD=1 npx vitest --run src/specs/server/api/gallery-cleanup-contract.e2e-spec.ts
  ```

  A new fixture is a new entry in that spec's `fixtureCases`, recorded the same way.

- **Served by** the strict loopback server in the mobile tests (`mobile/test/gallery/cleanup/cleanup_contract_server.dart`),
  which answers only requests that match a fixture.

## It is a script

Search fixtures are independent questions. These are not: a commit trashes photos, a restore brings them back, a
finished day turns reviewed. The fixtures are one script, in the order the app sends the requests
(`mobile/test/gallery/cleanup/cleanup_core_contract_test.dart` walks it), and the file names carry the order
(`010-…`, `020-…`): the recorder sends them in that order, the replay too, and a fixture's response is the state the
earlier ones left. The spec fails if the script is not in name order.

So two files may hold the same request with different responses (`020-rewind-815-years` and
`040-rewind-815-years-resumed`; the three in-spaces lookups). The mobile stand-in serves matching fixtures in file
order, **each once**: a request that has no unserved fixture left fails the test, like a request that matches none.

| Files        | What the app does                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `010`, `011` | The support probe: the calendar. `011` is the same request on a Gallery server without Library Cleanup (404)         |
| `020`–`022`  | Opens the rewind of 15 August: the years, then each year                                                             |
| `030`–`032`  | Apply and stop: the in-spaces lookup, one commit with no `completeMonthDay`, the trash undo                          |
| `040`–`042`  | Reopens the day: the photos decided before are `kept: true`                                                          |
| `050`–`053`  | Keep the rest and finish: lookups (declined, then confirmed), one commit with `completeMonthDay`, the calendar again |
| `060`–`063`  | Blurry, 4 photos a page: the first three pages open, the fourth as ten cards remain                                  |
| `070`–`073`  | Applies Blurry marks, undoes the trash, then changes the filters                                                     |

## File format

```jsonc
{
  "description": "…",
  "responseView": "no-cleanup",       // optional: the response as another server would give it (see below)
  "request": {
    "method": "POST",
    "path": "/api/cleanup/commit",    // includes the /api prefix the app's base URL carries
    "query": { "key": "value" },      // optional; a repeated key is an array of its values, in order
    "body": { … },                    // optional; the JSON body exactly as sent
    "headers": { "x-gallery-app": "cleanup-contract" } // informational, not matched
  },
  "response": { "status": 200, "body": { … } },
  "ids": { "<uuid>": "asset:q1" }     // legend: what each UUID in the file stands for
}
```

Keys are sorted at every level, and files end with a newline, so a re-record only shows real changes.

### Ids and volatile values

Real ids change on every seed, so every UUID is replaced by a stable fake UUID derived from the entity's seed label
(`asset:q1`, `asset:blurry-03`, `space:family`, `user:me`). The `ids` legend names them; an id the seed does not name
fails the recording. A queue `cursor` and `nextCursor` are base64url JSON that holds an asset id: the id inside is
replaced the same way, so the app can hand the cursor it received back unchanged.

Values the server sets on its own are fixed, keeping their JSON type so the generated Dart client still decodes them:
`createdAt`, `updatedAt` and `reviewedAt` become `2000-01-01T00:00:00.000Z`; `thumbhash` becomes its own key name.
Seeded values (taken dates, places, sizes, sharpness) are real.

### The seeded library

- 15 August: two photos in 2022 (`p1`, `p2`) and three in 2020 (`q1`, `q2`, `q3`); `q1` is also in a shared space.
- 24 December 2021 (`x1`): reviewed before the script starts, so the calendar has a reviewed day. The streak is the
  server's own count from the review time, so it is 1 for a run that does not cross midnight.
- Eleven blurry photos (`blurry-01`, the newest, to `blurry-11`) and two sharp but dark ones (`dark-1`, `dark-2`).
- The calendar request carries `tz=Europe/Lisbon`, the zone the mobile test reports as the device's.

### Fallback views

`responseView: "no-cleanup"` (`011`) is a Gallery server from before Library Cleanup. The recorder sends the request to a
route this server does not have and shows Nest's 404 under the path the app asked for. The mobile tests serve it alone
(`include:`), since it records the same request as `010`.

## Matching rule (for the mobile stand-in server)

A request matches a fixture when all of these hold:

1. **Method** is equal.
2. **Path** is equal, without the query string.
3. **Query**: the request's query string parsed into `key → [values in order]` equals the fixture's `query` with a
   scalar read as a one-element list. Keys are unordered; a key present on one side only is a mismatch. No `query`
   means no query string.
4. **Body**: the request body parsed as JSON deep-equals the fixture's `body`. Object key order does not matter; array
   order does; `null` and an absent key are different. No `body` means no request body.
5. **Not served yet**: a fixture answers once.

Headers and auth are not matched.

## Limits of the recording stack

The e2e stack runs without machine learning, so only the facts the seed writes (`asset_quality`, sizes, places) are
real; the quality job's own output is replaced by the seed. Burst, screenshot, space hog and duplicate queues arrive
with the slices that use them.
