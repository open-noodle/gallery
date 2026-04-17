import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate, latitudeSchema, longitudeSchema, stringToBool } from 'src/validation';
import z from 'zod';

const MapReverseGeocodeSchema = z
  .object({
    lat: z.coerce.number().meta({ format: 'double' }).pipe(latitudeSchema).describe('Latitude (-90 to 90)'),
    lon: z.coerce.number().meta({ format: 'double' }).pipe(longitudeSchema).describe('Longitude (-180 to 180)'),
  })
  .meta({ id: 'MapReverseGeocodeDto' });

const MapReverseGeocodeResponseSchema = z
  .object({
    city: z.string().nullable().describe('City name'),
    state: z.string().nullable().describe('State/Province name'),
    country: z.string().nullable().describe('Country name'),
  })
  .meta({ id: 'MapReverseGeocodeResponseDto' });

const MapMarkerSchema = z
  .object({
    isArchived: stringToBool.optional().describe('Filter by archived status'),
    isFavorite: stringToBool.optional().describe('Filter by favorite status'),
    fileCreatedAfter: isoDatetimeToDate.optional().describe('Filter assets created after this date'),
    fileCreatedBefore: isoDatetimeToDate.optional().describe('Filter assets created before this date'),
    withPartners: stringToBool.optional().describe('Include partner assets'),
    withSharedAlbums: stringToBool.optional().describe('Include shared album assets'),
  })
  .meta({ id: 'MapMarkerDto' });

const MapMarkerResponseSchema = z
  .object({
    id: z.string().describe('Asset ID'),
    lat: z.number().meta({ format: 'double' }).describe('Latitude'),
    lon: z.number().meta({ format: 'double' }).describe('Longitude'),
    city: z.string().nullable().describe('City name'),
    state: z.string().nullable().describe('State/Province name'),
    country: z.string().nullable().describe('Country name'),
  })
  .meta({ id: 'MapMarkerResponseDto' });

  @ApiProperty({ description: 'Country name' })
  country!: string | null;
}

export class MapMarkerDto {
  @ValidateBoolean({ optional: true, description: 'Filter by archived status' })
  isArchived?: boolean;

  @ValidateBoolean({ optional: true, description: 'Filter by favorite status' })
  isFavorite?: boolean;

  @ValidateDate({ optional: true, description: 'Filter assets created after this date' })
  fileCreatedAfter?: Date;

  @ValidateDate({ optional: true, description: 'Filter assets created before this date' })
  fileCreatedBefore?: Date;

  @ValidateBoolean({ optional: true, description: 'Include partner assets' })
  withPartners?: boolean;

  @ValidateBoolean({ optional: true, description: 'Include shared album assets' })
  withSharedAlbums?: boolean;

  @ValidateBoolean({ optional: true, description: 'Include shared space assets' })
  withSharedSpaces?: boolean;
}

export class MapMarkerResponseDto {
  @ApiProperty({ description: 'Asset ID' })
  id!: string;

  @ApiProperty({ format: 'double', description: 'Latitude' })
  lat!: number;

  @ApiProperty({ format: 'double', description: 'Longitude' })
  lon!: number;

  @ApiProperty({ description: 'City name' })
  city!: string | null;

  @ApiProperty({ description: 'State/Province name' })
  state!: string | null;

  @ApiProperty({ description: 'Country name' })
  country!: string | null;
}
