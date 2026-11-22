// gallery-fork: Aspect ratio filter (specs/2026-11-06-aspect-ratio-filter-design.md)
//
// No imports: schema table decorators (which run at module-load time, before Nest exists) and plain
// repository queries both need this file, so it must stay dependency-free.
//
// The index expression is used in the index definition and in every query: PostgreSQL only uses an
// expression index when the query repeats the expression exactly. Thresholds are fixed, because changing
// them means rebuilding the index.
export const ASPECT_CLASSES = ['landscape', 'square', 'portrait', 'panorama-wide', 'panorama-tall'] as const;

const LONGER_SIDE = `GREATEST("width"::bigint, "height"::bigint)`;
const SHORTER_SIDE = `LEAST("width"::bigint, "height"::bigint)`;

export const ASPECT_CLASS_SQL =
  `(CASE WHEN "width" IS NULL OR "height" IS NULL THEN NULL WHEN "width" <= 0 OR "height" <= 0 THEN NULL ` +
  `WHEN 50 * ${LONGER_SIDE} <= 51 * ${SHORTER_SIDE} THEN 'square' ` +
  `WHEN ${LONGER_SIDE} >= 2 * ${SHORTER_SIDE} THEN CASE WHEN "width" > "height" THEN 'panorama-wide' ELSE 'panorama-tall' END ` +
  `WHEN "width" > "height" THEN 'landscape' ELSE 'portrait' END)`;

export const ASPECT_CLASS_QUALIFIED_SQL = ASPECT_CLASS_SQL.replaceAll('"width"', '"asset"."width"').replaceAll(
  '"height"',
  '"asset"."height"',
);
