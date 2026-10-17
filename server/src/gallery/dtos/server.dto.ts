import { createZodDto } from 'nestjs-zod';
import z from 'zod';

// Fork server config and feature fields and the fork-only ML health response, merged into src/dtos/server.dto.ts with
// one spread per schema and one re-export.

/** ServerConfigSchema */
export const GalleryServerConfigExtension = {
  availableMemoryTypes: z.array(z.string()).describe('Globally-available memory type keys'),
};

/** ServerFeaturesSchema */
export const GalleryServerFeaturesExtension = {
  smartSearchHasCutoff: z.boolean().describe('Whether smart search has an active relevance cutoff (clip.maxDistance)'),
  peopleStatistics: z.boolean().describe('Whether the people face statistics UI is enabled'),
  // Deliberately plain strings, not the SyncRequestType enum: a client must be able to
  // parse a newer server's list without choking on values its own enum doesn't know yet.
  syncRequestTypes: z
    .array(z.string())
    .optional()
    .describe(
      'Sync stream request types this server accepts. Absent on servers that predate capability signalling; clients fall back to version-based gating.',
    ),
  localTakenRange: z
    .boolean()
    .optional()
    .describe(
      'Whether takenAfter/takenBefore filters compare the local (wall-clock) taken time with an exclusive end. Absent on older servers, which compare the UTC instant with an inclusive end.',
    ),
};

const ServerMlHealthResponseSchema = z
  .object({
    smartSearchHealthy: z
      .boolean()
      .describe('Whether the ML server is currently reachable and healthy for smart search'),
  })
  .meta({ id: 'ServerMlHealthResponseDto' });

export class ServerMlHealthResponseDto extends createZodDto(ServerMlHealthResponseSchema) {}
