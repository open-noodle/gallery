import { SqlBool } from 'kysely';
import { Writable } from 'node:stream';
import type { SyncAck } from 'src/types.js';
import { SyncAssetV1, SyncAssetV2, SyncItem } from 'src/dtos/sync.dto.js';
import { SyncEntityType } from 'src/enum.js';
import { hexOrBufferToBase64 } from 'src/utils/bytes.js';
import { formatSecondsToDuration } from 'src/utils/duration.js';
import { ClientDisconnectedError, waitForDrain } from 'src/utils/response.js';

type Impossible<K extends keyof any> = {
  [P in K]: never;
};

type Exact<T, U extends T = T> = U & Impossible<Exclude<keyof U, keyof T>>;

export const fromAck = (ack: string): SyncAck => {
  const [type, updateId, extraId] = ack.split('|', 3);
  return { type: type as SyncEntityType, updateId, extraId };
};

export const toAck = ({ type, updateId, extraId }: SyncAck) =>
  [type, updateId, extraId].filter((v) => v !== undefined).join('|');

export const mapJsonLine = (object: unknown) => JSON.stringify(object) + '\n';

export type SerializeOptions<T extends keyof SyncItem, D extends SyncItem[T]> = {
  type: T;
  data: Exact<SyncItem[T], D>;
  ids: [string] | [string, string];
  ackType?: SyncEntityType;
};

export const serialize = <T extends keyof SyncItem, D extends SyncItem[T]>({
  type,
  data,
  ids,
  ackType,
}: SerializeOptions<T, D>) =>
  mapJsonLine({ type, data, ack: toAck({ type: ackType ?? type, updateId: ids[0], extraId: ids[1] }) });

// Stream helpers shared by SyncService and the fork's GallerySyncStreams (src/gallery/utils/gallery-sync.streams.ts).
export type CheckpointMap = Partial<Record<SyncEntityType, SyncAck>>;
// #763: isFavorite is SqlBool (boolean | 0 | 1), not boolean, because every asset-payload stream
// now projects it via favoriteExistsFor's eb.exists(...) (sync.repository.ts), whose driver-level
// boolean representation Kysely can't narrow further than SqlBool — same reason
// asset-response.dto.ts's MapAsset.isFavoriteForUser is typed SqlBool. Coerced to a strict
// boolean below, in mapSyncAssetV2, mirroring that DTO's `!!entity.isFavoriteForUser`.
export type AssetLike = Omit<SyncAssetV2, 'checksum' | 'thumbhash' | 'isFavorite'> & {
  checksum: Buffer<ArrayBufferLike>;
  thumbhash: Buffer<ArrayBufferLike> | null;
  isFavorite: SqlBool;
};

export const COMPLETE_ID = 'complete';

export const mapSyncAssetV2 = ({ checksum, thumbhash, isFavorite, ...data }: AssetLike): SyncAssetV2 => ({
  ...data,
  checksum: hexOrBufferToBase64(checksum),
  thumbhash: thumbhash ? hexOrBufferToBase64(thumbhash) : null,
  isFavorite: !!isFavorite,
});

export const mapSyncAssetV1 = (data: AssetLike): SyncAssetV1 => {
  const asset = mapSyncAssetV2(data);

  return {
    ...asset,
    duration: asset.duration === null ? null : formatSecondsToDuration(asset.duration / 1000),
  };
};

export const isEntityBackfillComplete = (createId: string, checkpoint: SyncAck | undefined): boolean =>
  createId === checkpoint?.updateId && checkpoint.extraId === COMPLETE_ID;

export const getStartId = (createId: string, checkpoint: SyncAck | undefined): string | undefined =>
  createId === checkpoint?.updateId ? checkpoint?.extraId : undefined;

export const send = async <T extends keyof SyncItem, D extends SyncItem[T]>(
  response: Writable,
  item: SerializeOptions<T, D>,
) => {
  if (response.destroyed || response.writableEnded) {
    throw new ClientDisconnectedError();
  }

  // indicates back pressure, so we wait for 'drain' event
  if (!response.write(serialize(item))) {
    await waitForDrain(response);
  }
};

export const sendEntityBackfillCompleteAck = async (response: Writable, ackType: SyncEntityType, id: string) => {
  await send(response, { type: SyncEntityType.SyncAckV1, data: {}, ackType, ids: [id, COMPLETE_ID] });
};
