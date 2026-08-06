import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const AgentRunnerStatusReasonSchema = z
  .enum(['not-configured', 'healthy', 'unhealthy', 'timeout', 'invalid-response'])
  .describe('Agent runner availability reason')
  .meta({ id: 'AgentRunnerStatusReason' });

const AgentRunnerCapabilitiesSchema = z
  .object({
    protocolVersion: z.string().nullable().describe('Runner protocol version'),
    streaming: z.boolean().describe('Whether the runner can stream events'),
    tools: z.array(z.string()).describe('MCP tool or capability identifiers reported by the runner'),
    models: z.array(z.string()).describe('Model IDs reported by the runner'),
  })
  .meta({ id: 'AgentRunnerCapabilitiesDto' });

const AgentRunnerStatusSchema = z
  .object({
    configured: z.boolean().describe('Whether a runner endpoint is configured'),
    healthy: z.boolean().describe('Whether the configured runner is reachable and healthy'),
    reason: AgentRunnerStatusReasonSchema,
    version: z.string().nullable().describe('Runner version when reported'),
    capabilities: AgentRunnerCapabilitiesSchema.nullable().describe('Normalized runner capabilities'),
    checkedAt: isoDatetimeToDate.describe('When this status was checked'),
  })
  .meta({ id: 'AgentRunnerStatusDto' });

export type AgentRunnerStatusReason = z.infer<typeof AgentRunnerStatusReasonSchema>;
export type AgentRunnerCapabilities = z.infer<typeof AgentRunnerCapabilitiesSchema>;

export class AgentRunnerStatusDto extends createZodDto(AgentRunnerStatusSchema) {}
