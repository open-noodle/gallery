import type { StackResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import { assetFactory } from '@test-data/factories/asset-factory';
import { keepThisDeleteOthersPrompt } from './keep-this-delete-others';

const $t = ((key: string, options?: { values?: Record<string, unknown> }) =>
  JSON.stringify({ key, ...options?.values })) as MessageFormatter;

const stack: StackResponseDto = {
  id: 'stack-1',
  primaryAssetId: 'a',
  assets: [assetFactory.build(), assetFactory.build(), assetFactory.build()],
};

describe('keepThisDeleteOthersPrompt', () => {
  it("keeps upstream's prompt outside an album", () => {
    expect(JSON.parse(keepThisDeleteOthersPrompt($t, stack, false))).toEqual({
      key: 'confirm_keep_this_delete_others',
    });
  });

  it('warns inside an album that the others leave the library, counting them', () => {
    expect(JSON.parse(keepThisDeleteOthersPrompt($t, stack, true))).toEqual({
      key: 'confirm_keep_this_delete_others_in_album',
      count: 2,
    });
  });
});
