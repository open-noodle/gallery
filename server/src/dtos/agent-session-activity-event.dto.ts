import { createZodDto } from 'nestjs-zod';
import {
  AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
} from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_COUNT = 10_000;
const safeSummary = z.string().trim().min(1).max(240);
const AgentSessionActivityEventKindSchema = z
  .enum(AgentSessionActivityEventKind)
  .or(z.string().transform(() => AgentSessionActivityEventKind.Unknown))
  .meta({ id: 'AgentSessionActivityEventKind' });
const AgentSessionActivityEventStatusSchema = z
  .enum(AgentSessionActivityEventStatus)
  .meta({ id: 'AgentSessionActivityEventStatus' });
const AgentSessionActivityEventSourceSchema = z
  .enum(AgentSessionActivityEventSource)
  .meta({ id: 'AgentSessionActivityEventSource' });

const AgentSessionActivityEventCountsSchema = z
  .strictObject({
    total: z.number().int().min(0).max(MAX_COUNT).optional(),
    applied: z.number().int().min(0).max(MAX_COUNT).optional(),
    skipped: z.number().int().min(0).max(MAX_COUNT).optional(),
    failed: z.number().int().min(0).max(MAX_COUNT).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'counts must include at least one count' })
  .meta({ id: 'AgentSessionActivityEventCounts' });

const AgentSessionActivityEventCreateSchema = z
  .strictObject({
    kind: AgentSessionActivityEventKindSchema,
    status: AgentSessionActivityEventStatusSchema,
    source: AgentSessionActivityEventSourceSchema,
    summary: safeSummary.nullable().optional(),
    counts: AgentSessionActivityEventCountsSchema.nullable().optional(),
  })
  .transform((value) => ({
    ...value,
    summary: value.summary ?? null,
    counts: value.counts ?? null,
  }))
  .meta({ id: 'AgentSessionActivityEventCreateDto' });

const AgentSessionActivityEventResponseSchema = z
  .object({
    id: z.uuidv4(),
    sessionId: z.uuidv4(),
    kind: z.enum(AgentSessionActivityEventKind),
    status: AgentSessionActivityEventStatusSchema,
    source: AgentSessionActivityEventSourceSchema,
    summary: safeSummary.nullable(),
    counts: AgentSessionActivityEventCountsSchema.nullable(),
    createdAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentSessionActivityEventResponseDto' });

export class AgentSessionActivityEventCreateDto extends createZodDto(AgentSessionActivityEventCreateSchema) {}
export class AgentSessionActivityEventResponseDto extends createZodDto(AgentSessionActivityEventResponseSchema) {}
