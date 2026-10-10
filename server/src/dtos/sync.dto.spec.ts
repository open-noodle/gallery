import z from 'zod';
import { SyncStreamDto } from 'src/dtos/sync.dto.js';
import { SyncRequestType } from 'src/enum.js';

describe('SyncStreamDto', () => {
  it('should keep known request types', () => {
    const result = SyncStreamDto.schema.safeParse({ types: [SyncRequestType.UsersV1, SyncRequestType.AlbumsV2] });
    expect(result.success).toBe(true);
    expect(result.data?.types).toEqual([SyncRequestType.UsersV1, SyncRequestType.AlbumsV2]);
  });

  it('should drop unknown request types instead of rejecting the request', () => {
    const result = SyncStreamDto.schema.safeParse({
      types: [SyncRequestType.UsersV1, 'AssetsV9', SyncRequestType.AlbumsV2],
      reset: true,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ types: [SyncRequestType.UsersV1, SyncRequestType.AlbumsV2], reset: true });
  });

  it('should still reject a malformed types field', () => {
    expect(SyncStreamDto.schema.safeParse({ types: 'UsersV1' }).success).toBe(false);
    expect(SyncStreamDto.schema.safeParse({}).success).toBe(false);
    expect(SyncStreamDto.schema.safeParse({ types: [SyncRequestType.UsersV1, 42] }).success).toBe(false);
  });

  it('should keep types required in the generated API schema', () => {
    expect(z.toJSONSchema(SyncStreamDto.schema, { io: 'input', unrepresentable: 'any' }).required).toEqual(['types']);
  });
});
