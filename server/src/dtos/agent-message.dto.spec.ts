import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AgentMessageRole } from 'src/enum';
import { factory } from 'test/small.factory';
import z from 'zod';

type AgentMessageCreateInput = z.input<typeof AgentMessageCreateDto.schema>;

const parseCreate = (input: AgentMessageCreateInput) => AgentMessageCreateDto.schema.safeParse(input);

const expectIssue = (
  result: { success: boolean; error?: z.ZodError },
  path: Array<string | number>,
  message: string,
) => {
  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path,
        message: expect.stringContaining(message),
      }),
    ]),
  );
};

const makeResponse = (overrides: Partial<AgentMessageResponseDto> = {}): AgentMessageResponseDto => ({
  id: factory.uuid(),
  sessionId: factory.uuid(),
  role: AgentMessageRole.Assistant,
  content: { blocks: [{ type: 'text', text: 'I can help with that.' }] },
  providerMessageId: null,
  toolCallId: null,
  createdAt: new Date('2026-05-14T12:00:00.000Z'),
  ...overrides,
});

describe('AgentMessage DTOs', () => {
  describe(AgentMessageCreateDto.name, () => {
    it('accepts text blocks and trims text', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'text', text: '  Organize my photos.  ' }] } });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content.blocks).toEqual([{ type: 'text', text: 'Organize my photos.' }]);
      }
    });

    it('rejects empty block lists', () => {
      const result = parseCreate({ content: { blocks: [] } });

      expectIssue(result, ['content', 'blocks'], 'Too small');
    });

    it('rejects more than 100 blocks', () => {
      const result = parseCreate({
        content: {
          blocks: Array.from({ length: 101 }, () => ({ type: 'text', text: 'hello' })),
        },
      });

      expectIssue(result, ['content', 'blocks'], 'Too big');
    });

    it('rejects blank text after trim', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'text', text: '   ' }] } });

      expectIssue(result, ['content', 'blocks', 0, 'text'], 'Too small');
    });

    it('rejects text blocks above 8,000 characters', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'text', text: 'x'.repeat(8001) }] } });

      expectIssue(result, ['content', 'blocks', 0, 'text'], 'Too big');
    });

    it('rejects full content JSON above 32 KiB', () => {
      const result = parseCreate({
        content: {
          blocks: Array.from({ length: 5 }, (_, index) => ({
            type: 'text',
            text: `${index}-${'x'.repeat(8000)}`,
          })),
        },
      });

      expectIssue(result, ['content'], 'content must be 32 KiB or less');
    });

    it('rejects unknown block types', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'html', html: '<b>no</b>' }] } as never });

      expectIssue(result, ['content', 'blocks', 0, 'type'], 'Invalid input');
    });

    it.each([
      { type: 'asset', assetId: factory.uuid() },
      { type: 'tool-call', toolCallId: factory.uuid() },
      { type: 'plan', planId: factory.uuid() },
      {
        type: 'clarification',
        kind: 'person',
        query: 'Pierre',
        summary: 'I found two people named Pierre.',
        textFallback: 'Which Pierre should I use?',
        choices: [{ choiceRef: 'choice:person:abcDEF1234567890', label: 'Pierre', thumbnailAssetId: null }],
      },
    ])('rejects $type blocks from the public create DTO', (block) => {
      const result = parseCreate({ content: { blocks: [block] } as never });

      expectIssue(result, ['content', 'blocks', 0, 'type'], 'Invalid input');
    });
  });

  describe(AgentMessageResponseDto.name, () => {
    it('encodes persisted structured response blocks', () => {
      const toolCallId = factory.uuid();
      const result = AgentMessageResponseDto.schema.safeEncode(
        makeResponse({
          content: {
            blocks: [
              { type: 'text', text: 'Working on it.' },
              { type: 'tool-call', toolCallId, summary: 'Read matching assets.' },
              { type: 'asset', assetId: factory.uuid(), label: 'IMG_0001.jpg' },
              { type: 'plan', planId: factory.uuid(), label: 'Portugal album plan' },
            ],
          },
          providerMessageId: 'provider-message-1',
          toolCallId,
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.createdAt).toBe('2026-05-14T12:00:00.000Z');
      }
    });

    it('encodes persisted clarification response blocks with safe choice refs and optional thumbnails', () => {
      const result = AgentMessageResponseDto.schema.safeEncode(
        makeResponse({
          content: {
            blocks: [
              {
                type: 'clarification',
                kind: 'person',
                query: 'Pierre',
                summary: 'I found two people named Pierre.',
                textFallback: 'Which Pierre should I use?',
                choices: [
                  {
                    choiceRef: 'choice:person:abcDEF1234567890',
                    label: 'Pierre M.',
                    description: '12 matching photos',
                    thumbnailAssetId: factory.uuid(),
                  },
                  {
                    choiceRef: 'choice:person:defABC1234567890',
                    label: 'Pierre',
                    thumbnailAssetId: null,
                  },
                ],
              },
            ],
          },
        }),
      );

      expect(result.success).toBe(true);
    });

    it.each([
      { block: { type: 'text', text: 'Hello.', id: factory.uuid() }, path: ['content', 'blocks', 0] },
      {
        block: { type: 'tool-call', toolCallId: factory.uuid(), summary: 'Read matching assets.', id: factory.uuid() },
        path: ['content', 'blocks', 0],
      },
      {
        block: { type: 'asset', assetId: factory.uuid(), label: 'IMG_0001.jpg', searchFilter: { rating: 5 } },
        path: ['content', 'blocks', 0],
      },
      {
        block: { type: 'plan', planId: factory.uuid(), label: 'Portugal album plan', rawPlanId: factory.uuid() },
        path: ['content', 'blocks', 0],
      },
    ])('rejects extra keys on persisted legacy $block.type blocks', ({ block, path }) => {
      const result = AgentMessageResponseDto.schema.safeEncode(makeResponse({ content: { blocks: [block] } as never }));

      expectIssue(result, path, 'Unrecognized key');
    });

    it.each([
      {
        choice: { choiceRef: factory.uuid(), label: 'Pierre', thumbnailAssetId: null },
        path: 'choiceRef',
        message: 'choiceRef must use the choice:<kind>:<token> format',
      },
      {
        choice: { choiceRef: `choice:person:${factory.uuid()}`, label: 'Pierre', thumbnailAssetId: null },
        path: 'choiceRef',
        message: 'choiceRef token must not be a UUID',
      },
      {
        choice: { choiceRef: 'choice:person:abcDEF1234567890', id: factory.uuid(), label: 'Pierre' },
        path: undefined,
        message: 'Unrecognized key',
      },
      {
        choice: {
          choiceRef: 'choice:person:abcDEF1234567890',
          label: 'Pierre',
          searchFilter: { personIds: [factory.uuid()] },
        },
        path: undefined,
        message: 'Unrecognized key',
      },
    ])('rejects unsafe persisted clarification choices', ({ choice, path, message }) => {
      const result = AgentMessageResponseDto.schema.safeEncode(
        makeResponse({
          content: {
            blocks: [
              {
                type: 'clarification',
                kind: 'person',
                query: 'Pierre',
                summary: 'I found two people named Pierre.',
                textFallback: 'Which Pierre should I use?',
                choices: [choice],
              },
            ],
          } as never,
        }),
      );

      expectIssue(
        result,
        path === undefined ? ['content', 'blocks', 0, 'choices', 0] : ['content', 'blocks', 0, 'choices', 0, path],
        message,
      );
    });

    it('rejects persisted clarification choices whose choiceRef kind does not match the block kind', () => {
      const result = AgentMessageResponseDto.schema.safeEncode(
        makeResponse({
          content: {
            blocks: [
              {
                type: 'clarification',
                kind: 'person',
                query: 'Pierre',
                summary: 'I found two people named Pierre.',
                textFallback: 'Which Pierre should I use?',
                choices: [{ choiceRef: 'choice:album:abcDEF1234567890', label: 'Pierre', thumbnailAssetId: null }],
              },
            ],
          } as never,
        }),
      );

      expectIssue(result, ['content', 'blocks', 0, 'choices'], 'choiceRef kind must match clarification kind');
    });

    it.each([
      { block: { type: 'tool-call', toolCallId: factory.uuid(), summary: 'x'.repeat(501) }, path: 'summary' },
      { block: { type: 'asset', assetId: factory.uuid(), label: 'x'.repeat(501) }, path: 'label' },
      { block: { type: 'plan', planId: factory.uuid(), label: 'x'.repeat(501) }, path: 'label' },
    ])('bounds optional structured block text fields', ({ block, path }) => {
      const result = AgentMessageResponseDto.schema.safeEncode(makeResponse({ content: { blocks: [block] } as never }));

      expectIssue(result, ['content', 'blocks', 0, path], 'Too big');
    });
  });
});
