// gallery-fork: Library Cleanup (specs/2026-09-23-library-cleanup-design.md)
//
// No imports — schema table decorators (which run at module-load time, before Nest exists)
// and plain repository queries both need this file, so it must stay dependency-free.
//
// The index expression is used verbatim in the index definition and in every calendar/rewind query:
// PostgreSQL only uses an expression index when the query repeats the expression exactly.
export const MONTH_DAY_SQL = `((extract(month from ("localDateTime" at time zone 'UTC')) * 100 + extract(day from ("localDateTime" at time zone 'UTC')))::smallint)`;
export const CLEANUP_MONTH_DAY_INDEX_WHERE = `"deletedAt" IS NULL AND "visibility" IN ('timeline', 'archive') AND "isOffline" = false AND "libraryId" IS NULL`;
