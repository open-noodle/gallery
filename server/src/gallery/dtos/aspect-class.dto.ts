import z from 'zod';
import { AssetAspectClassSchema } from 'src/enum.js';
import { ASPECT_CLASSES } from 'src/gallery/utils/aspect-class-sql.js';

// The aspectClasses request field (specs/2026-11-06-aspect-ratio-filter-design.md). Leaf module, so the time bucket,
// search and map DTOs can all import it. An empty string is an unknown class (400); an empty list means no filter.
const description = 'Filter by aspect class: an asset matches when it is in any of them';

export const aspectClassesQuery = z
  .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(AssetAspectClassSchema))
  .optional()
  .describe(description);

// POST bodies describe the field as strings, validated as strictly as the enum. The generated Dart client always sends
// an optional enum list, as `[]`, and mobile requests to stock servers must stay byte-identical.
const isAspectClass = (value: string) => (ASPECT_CLASSES as readonly string[]).includes(value);

export const aspectClassesBody = z
  .array(z.string().refine(isAspectClass, 'Unknown aspect class'))
  .optional()
  .describe(`${description}. One of: ${ASPECT_CLASSES.join(', ')}`);
