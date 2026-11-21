import { asMutation, executeMutation } from '#lib/queries/client.ts';
import { updateAsset } from '@immich/sdk';

export const takeoutMetadataMutation = () => asMutation(updateAsset, { meta: { error: { toast: false } } });

/** The importer reports item failures itself and must keep its pending journal on a failed write. */
export async function updateTakeoutMetadata(variables: Parameters<typeof updateAsset>[0]): Promise<void> {
  let failure: Error | undefined;
  await executeMutation(takeoutMetadataMutation, [variables], {
    onError: (error) => {
      failure = error;
    },
  });
  // executeMutation normally handles errors through toasts and resolves undefined. Propagate the
  // captured failure here so the importer cannot mistake that undefined for a successful write.
  if (failure) {
    throw failure;
  }
}
