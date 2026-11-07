import z from 'zod';
import { AssetAspectClassSchema } from 'src/enum.js';

// The aspectClasses request field (specs/2026-11-06-aspect-ratio-filter-design.md). Leaf module, so the time bucket,
// search and map DTOs can all import it. An empty string is an unknown class (400); an empty list means no filter.
const description = 'Filter by aspect class: an asset matches when it is in any of them';

export const aspectClassesQuery = z
  .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(AssetAspectClassSchema))
  .optional()
  .describe(description);

export const aspectClassesBody = z.array(AssetAspectClassSchema).optional().describe(description);
