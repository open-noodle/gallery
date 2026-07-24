import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const TaskConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether the task is enabled'),
  })
  .meta({ id: 'TaskConfig' });

const ModelConfigSchema = TaskConfigSchema.extend({
  modelName: z.string().min(1).describe('Name of the model to use'),
});

export const CLIPConfigSchema = ModelConfigSchema.extend({
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0)
    .max(2)
    .describe('Maximum cosine distance for smart search results. 0 = disabled.'),
}).meta({ id: 'CLIPConfig' });

export const DuplicateDetectionConfigSchema = TaskConfigSchema.extend({
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.001)
    .max(0.1)
    .describe('Maximum distance threshold for duplicate detection'),
}).meta({ id: 'DuplicateDetectionConfig' });

export const FaceSuggestionConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether face suggestions are enabled'),
    maxDistance: z
      .number()
      .meta({ format: 'double' })
      .min(0.1)
      .max(2)
      .describe('Maximum embedding distance for a face to be surfaced as a suggestion on a named person'),
  })
  .meta({ id: 'FaceSuggestionConfig' });

export const FacialRecognitionConfigSchema = ModelConfigSchema.extend({
  minScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for face detection'),
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(2)
    .describe('Maximum distance threshold for face recognition'),
  minFaces: z.int().min(1).describe('Minimum number of faces required for recognition'),
  suggestions: FaceSuggestionConfigSchema,
}).meta({ id: 'FacialRecognitionConfig' });

export const PetDetectionConfigSchema = ModelConfigSchema.extend({
  minScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for pet detection'),
}).meta({ id: 'PetDetectionConfig' });

export const PetRecognitionConfigSchema = ModelConfigSchema.extend({
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(2)
    .describe('Maximum distance threshold for pet recognition'),
  minFaces: z.int().min(1).describe('Minimum number of faces required for recognition'),
}).meta({ id: 'PetRecognitionConfig' });

export const OcrConfigSchema = ModelConfigSchema.extend({
  maxResolution: z.int().min(1).describe('Maximum resolution for OCR processing'),
  minDetectionScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for text detection'),
  minRecognitionScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for text recognition'),
}).meta({ id: 'OcrConfig' });

export class CLIPConfig extends createZodDto(CLIPConfigSchema) {}
