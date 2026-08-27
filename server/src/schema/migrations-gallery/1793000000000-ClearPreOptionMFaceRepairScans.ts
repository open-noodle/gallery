import { Kysely, sql } from 'kysely';

// `face_repair_scan.persons` is a JSONB snapshot of a completed face-cleanup scan. Its ELEMENT
// SHAPE is not a column, so 1791000000000-RepointFaceReviewToPersonGroup — which renamed the three
// face-review columns for option M — never touched it, while the option-M landing renamed the key
// INSIDE the blob from `personId` to `personGroupId`.
//
// Every reader crosses DB->TS through a cast, so `tsc` cannot see the mismatch. On an instance
// upgrading from v5.4.0 (where face-repair-scan.repository.ts first shipped, declaring
// `personId: string`) the id list binds NULL, the live flagged counts come back empty, the
// `flagged > 0` filter drops every row, and /admin/face-cleanup renders its header and totals with
// ZERO person rows. No error, no log.
//
// Clear the stale scans rather than rewriting them. A rewrite would fix only the key we happened to
// notice and assumes the rest of the persisted shape is unchanged; clearing sidesteps every shape
// question at once. Nothing of value is lost: the admin's persisted "leave it" decisions live in
// face_repair_decline, which has no scanId reference at all (its FKs are asset_face, person_group,
// user), and neither does face_person_verdict. The only cascade is face_repair_scan_flagged_face,
// which is itself a point-in-time snapshot of the same scan. And the resulting state is not novel:
// getLatestScanStatus returns null when there is no scan, which is exactly what a fresh install
// shows — "no scan yet, run one".
//
// The predicate targets only pre-M blobs, so this is precise and safe to re-run: an instance that
// has already re-scanned keeps its fresh scan. jsonb_path_exists is the function form of `@?`
// ("does any array element carry a personId key?"), preferred here because the fork has no jsonpath
// precedent in its migrations and the function form avoids a literal `?`. PG floor is 14; jsonpath
// needs 12.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM "face_repair_scan" WHERE jsonb_path_exists("persons", '$[*].personId')`.execute(db);
}

export async function down(): Promise<void> {
  // Irreversible by design, and harmless: the deleted rows were a derived cache that the console
  // rebuilds on the next scan. Re-creating blobs keyed the pre-M way would only restore the bug.
}
