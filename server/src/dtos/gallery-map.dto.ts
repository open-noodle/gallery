import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate, stringToBool } from 'src/validation';
import z from 'zod';

export enum MapMediaType {
  Image = 'IMAGE',
  Video = 'VIDEO',
}

const MapMediaTypeSchema = z.enum(MapMediaType).meta({ id: 'MapMediaType' });

const uuidArrayQuery = z
  .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.uuidv4()))
  .optional();

const FilteredMapMarkerSchema = z
  .object({
    personIds: uuidArrayQuery.describe('Filter by person IDs'),
    tagIds: uuidArrayQuery.describe('Filter by tag IDs'),
    spaceId: z.uuidv4().optional().describe('Scope to a shared space'),
    make: z.string().optional().describe('Camera make'),
    model: z.string().optional().describe('Camera model'),
    rating: z.coerce.number().min(1).max(5).optional().describe('Minimum star rating'),
    type: MapMediaTypeSchema.optional().describe('Filter by media type'),
    takenAfter: isoDatetimeToDate.optional().describe('Filter assets taken after this date'),
    takenBefore: isoDatetimeToDate.optional().describe('Filter assets taken before this date'),
    isFavorite: stringToBool.optional().describe('Filter by favorite status'),
    city: z.string().optional().describe('Filter by city'),
    country: z.string().optional().describe('Filter by country'),
    withSharedSpaces: stringToBool.optional().describe('Include shared space assets'),
  })
  .meta({ id: 'FilteredMapMarkerDto' });

export class FilteredMapMarkerDto extends createZodDto(FilteredMapMarkerSchema) {}
