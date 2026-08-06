import { createZodDto } from 'nestjs-zod';
import { AgentChoiceRefSchema } from 'src/dtos/agent-asset-source.dto';
import { AgentMessageRole } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_CONTENT_BYTES = 32_768;
const text = z.string().trim().min(1).max(8000);
const label = z.string().trim().min(1).max(500).optional();
const clarificationLabel = z.string().trim().min(1).max(500);
const clarificationKinds = ['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel'] as const;
const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const AgentMessageRoleSchema = z.enum(AgentMessageRole).meta({ id: 'AgentMessageRole' });

const AgentMessageTextBlockSchema = z
  .strictObject({
    type: z.literal('text').meta({ id: 'AgentMessageTextBlockType' }),
    text,
  })
  .meta({ id: 'AgentMessageTextBlock' });

const AgentMessageToolCallBlockSchema = z
  .strictObject({
    type: z.literal('tool-call').meta({ id: 'AgentMessageToolCallBlockType' }),
    toolCallId: z.uuidv4(),
    summary: label,
  })
  .meta({ id: 'AgentMessageToolCallBlock' });

const AgentMessageAssetBlockSchema = z
  .strictObject({
    type: z.literal('asset').meta({ id: 'AgentMessageAssetBlockType' }),
    assetId: z.uuidv4(),
    label,
  })
  .meta({ id: 'AgentMessageAssetBlock' });

const AgentMessagePlanBlockSchema = z
  .strictObject({
    type: z.literal('plan').meta({ id: 'AgentMessagePlanBlockType' }),
    planId: z.uuidv4(),
    label,
  })
  .meta({ id: 'AgentMessagePlanBlock' });

const AgentMessageClarificationChoiceSchema = z
  .strictObject({
    choiceRef: AgentChoiceRefSchema,
    label: clarificationLabel,
    description: clarificationLabel.optional(),
    thumbnailAssetId: z.uuidv4().nullable().optional(),
  })
  .meta({ id: 'AgentMessageClarificationChoice' });

const AgentMessageClarificationBlockSchema = z
  .strictObject({
    type: z.literal('clarification').meta({ id: 'AgentMessageClarificationBlockType' }),
    kind: z.enum(clarificationKinds),
    query: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(1000),
    textFallback: z.string().trim().min(1).max(1000),
    choices: z.array(AgentMessageClarificationChoiceSchema).min(1).max(10),
  })
  .refine((block) => block.choices.every((choice) => choice.choiceRef.startsWith(`choice:${block.kind}:`)), {
    path: ['choices'],
    message: 'choiceRef kind must match clarification kind',
  })
  .meta({ id: 'AgentMessageClarificationBlock' });

const AgentMessageBlockSchema = z
  .discriminatedUnion('type', [
    AgentMessageTextBlockSchema,
    AgentMessageToolCallBlockSchema,
    AgentMessageAssetBlockSchema,
    AgentMessagePlanBlockSchema,
    AgentMessageClarificationBlockSchema,
  ])
  .meta({ id: 'AgentMessageBlock' });

const AgentMessageContentSchema = z
  .object({
    blocks: z.array(AgentMessageBlockSchema).min(1).max(100),
  })
  .refine((value) => jsonByteLength(value) <= MAX_CONTENT_BYTES, {
    message: 'content must be 32 KiB or less',
  })
  .meta({ id: 'AgentMessageContent' });

const AgentUserMessageContentSchema = z
  .object({
    blocks: z.array(AgentMessageTextBlockSchema).min(1).max(100),
  })
  .refine((value) => jsonByteLength(value) <= MAX_CONTENT_BYTES, {
    message: 'content must be 32 KiB or less',
  })
  .meta({ id: 'AgentUserMessageContent' });

const AgentMessageCreateSchema = z
  .object({
    content: AgentUserMessageContentSchema,
  })
  .meta({ id: 'AgentMessageCreateDto' });

const AgentMessageResponseSchema = z
  .object({
    id: z.uuidv4(),
    sessionId: z.uuidv4(),
    role: AgentMessageRoleSchema,
    content: AgentMessageContentSchema,
    providerMessageId: z.string().nullable(),
    toolCallId: z.uuidv4().nullable(),
    createdAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentMessageResponseDto' });

export class AgentMessageCreateDto extends createZodDto(AgentMessageCreateSchema) {}
export class AgentMessageResponseDto extends createZodDto(AgentMessageResponseSchema) {}
