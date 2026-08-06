import { createZodDto } from 'nestjs-zod';
import { AgentProviderType } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const label = z.string().trim().min(1).max(120);
const secret = z.string().min(1);
const model = z.string().trim().min(1);
const models = z.array(model);

const AgentProviderCredentialCreateSchema = z
  .object({
    providerType: z.enum(AgentProviderType),
    label,
    secret,
    baseUrl: z.url().optional(),
    models: models.optional(),
    defaultModel: model.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.providerType === AgentProviderType.OpenAICompatible && !value.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'baseUrl is required for openai-compatible providers',
      });
    }
  })
  .meta({ id: 'AgentProviderCredentialCreateDto' });

const AgentProviderCredentialUpdateSchema = z
  .object({
    providerType: z.enum(AgentProviderType).optional(),
    label: label.optional(),
    secret: secret.optional(),
    baseUrl: z.url().nullable().optional(),
    models: models.optional(),
    defaultModel: model.nullable().optional(),
  })
  .meta({ id: 'AgentProviderCredentialUpdateDto' });

const AgentProviderCredentialResponseSchema = z
  .object({
    id: z.uuidv4(),
    providerType: z.enum(AgentProviderType),
    label,
    baseUrl: z.url().nullable(),
    models,
    defaultModel: model.nullable(),
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
    lastUsedAt: isoDatetimeToDate.nullable(),
  })
  .meta({ id: 'AgentProviderCredentialResponseDto' });

export class AgentProviderCredentialCreateDto extends createZodDto(AgentProviderCredentialCreateSchema) {}
export class AgentProviderCredentialUpdateDto extends createZodDto(AgentProviderCredentialUpdateSchema) {}
export class AgentProviderCredentialResponseDto extends createZodDto(AgentProviderCredentialResponseSchema) {}
