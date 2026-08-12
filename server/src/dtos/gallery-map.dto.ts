import { createZodDto } from 'nestjs-zod';
import { boundedTextFilter, isoDatetimeToDate, stringToBool } from 'src/validation';
import z from 'zod';

export enum MapMediaType {
  Image = 'IMAGE',
  Video = 'VIDEO',
}

const MapMediaTypeSchema = z.enum(MapMediaType).meta({ id: 'MapMediaType' });

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ScopedPersonTokenSchema = z
  .string()
  .regex(new RegExp(`^(?:${UUID_PATTERN}|person:${UUID_PATTERN}|space-person:${UUID_PATTERN})$`))
  .describe('Legacy person ID or scoped identity filter token');

const uuidArrayQuery = z
  .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.uuidv4()))
  .optional();

const scopedPersonTokenArrayQuery = z
  .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(ScopedPersonTokenSchema))
  .optional();

const FilteredMapMarkerSchema = z
  .object({
    personIds: scopedPersonTokenArrayQuery.describe('Filter by person IDs'),
    tagIds: uuidArrayQuery.describe('Filter by tag IDs'),
    spaceId: z.uuidv4().optional().describe('Scope to a shared space'),
    make: z.string().optional().describe('Camera make'),
    model: z.string().optional().describe('Camera model'),
    rating: z.coerce.number().min(1).max(5).optional().describe('Minimum star rating'),
    type: MapMediaTypeSchema.optional().describe('Filter by media type'),
    takenAfter: isoDatetimeToDate.optional().describe('Filter assets taken after this date'),
    takenBefore: isoDatetimeToDate.optional().describe('Filter assets taken before this date'),
    isFavorite: stringToBool.optional().describe('Filter by favorite status'),
    isNotInAlbum: stringToBool.optional().describe('Filter assets not in any album'),
    isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
    originalFileName: boundedTextFilter()
      .optional()
      .describe('Filter by original filename (substring, case/accent-insensitive)'),
    description: boundedTextFilter()
      .optional()
      .describe('Filter by asset description (substring, case/accent-insensitive)'),
    ocr: boundedTextFilter().optional().describe('Filter by OCR text content (substring, case/accent-insensitive)'),
    city: z.string().optional().describe('Filter by city'),
    country: z.string().optional().describe('Filter by country'),
    lensModel: z.string().optional().describe('Camera lens model'),
    state: z.string().optional().describe('Filter by state/province'),
    ownerId: z
      .uuidv4()
      .optional()
      .describe('Filter by asset owner (contributor). Narrows within the current scope; never widens it.'),
    albumId: z.uuidv4().optional().describe('Filter by album'),
    withSharedSpaces: stringToBool.optional().describe('Include shared space assets'),
  })
  .meta({ id: 'FilteredMapMarkerDto' });

export class FilteredMapMarkerDto extends createZodDto(FilteredMapMarkerSchema) {}
