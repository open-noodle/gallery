import { Kysely, sql } from 'kysely';

// Disable PostgreSQL JIT for the Gallery application role.
//
// The fork's cross-space People-list aggregates (getAccessiblePeople /
// getAccessiblePeopleStatistics and the space-scoped timeline bucket counts)
// have inflated planner cost estimates — the OR-gated `accessible_faces` CTE
// and COUNT(DISTINCT) push the estimated cost well past `jit_above_cost`
// (default 100000) — yet they execute in well under 300ms on real data.
// With `jit=on` (a PostgreSQL default) these queries get JIT-compiled, and the
// one-time ~2s LLVM initialization per pooled backend then dominates, making
// the People page ~2.7s instead of ~0.7s (and the space timeline ~7x slower).
//
// Live profiling against a large real library (see PR) showed `jit=off` speeds
// the heavy aggregates 3-7x and regresses nothing: every other endpoint —
// including person-filtered search — is an indexed lookup whose cost never
// reaches the JIT threshold, so JIT never engages. Gallery has no genuinely
// analytical (millions-of-rows) query that JIT would benefit, so disabling it
// is a clean win. Applied to the connecting role (CURRENT_USER) so it covers
// every deployment — bundled or external Postgres — regardless of database
// name, and follows the role into whichever database it connects to.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER ROLE CURRENT_USER SET jit = off`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER ROLE CURRENT_USER RESET jit`.execute(db);
}
