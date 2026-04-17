export class AlbumNameDto {
  id!: string;
  albumName!: string;
  albumThumbnailAssetId!: string | null;
  assetCount!: number;
  startDate?: string;
  endDate?: string;
  shared!: boolean;
}
