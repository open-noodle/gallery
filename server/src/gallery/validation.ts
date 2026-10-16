import z from 'zod';

/**
 * Maximum length, in Unicode code points, of a free-text substring filter (description / filename /
 * OCR text). Mirrors the web codec's clamp (`TEXT_FILTER_PARAM_MAX_LENGTH` in
 * web/src/lib/utils/filter-url.ts) so a value the client already clamped is never rejected, while a
 * direct API caller cannot push a multi-kilobyte ILIKE pattern into the query.
 */
export const TEXT_FILTER_MAX_CODE_POINTS = 200;

/**
 * Bound a free-text filter to {@link TEXT_FILTER_MAX_CODE_POINTS} **code points** — counted with the
 * spread operator, not `.length`, so the bound matches the web clamp exactly for astral characters
 * (emoji, CJK extensions) rather than rejecting a validly-clamped client value. The caller adds
 * `.optional()` / `.nullable()`. Implemented as a `.refine` (not `.max`) so it stays opaque to
 * OpenAPI schema generation and adds no `maxLength` that would churn the generated SDK.
 */
export const boundedTextFilter = (schema: z.ZodString = z.string()) =>
  schema.refine((value) => [...value].length <= TEXT_FILTER_MAX_CODE_POINTS, {
    error: `Filter must be at most ${TEXT_FILTER_MAX_CODE_POINTS} characters`,
  });

/**
 * Wraps a zod schema so that empty strings are coerced to null before validation.
 * Use when an API accepts "" from a client to mean "clear this nullable field".
 *
 * @example
 * emptyStringToNull(z.string().nullable()).optional()
 */
export function emptyStringToNull<T extends z.ZodType>(schema: T) {
  return z.preprocess((val) => (val === '' ? null : val), schema);
}
