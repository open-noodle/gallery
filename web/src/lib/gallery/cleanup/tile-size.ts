export type TileSize = 'small' | 'medium' | 'large';
export type SelectQueueName = 'blurry' | 'screenshots';

export const TILE_SIZES: TileSize[] = ['small', 'medium', 'large'];

/** Minimum tile width (px) per size. Medium is the default and is larger than the old 150px. */
export const TILE_MIN_WIDTH: Record<SelectQueueName, Record<TileSize, number>> = {
  blurry: { small: 150, medium: 200, large: 300 },
  screenshots: { small: 160, medium: 220, large: 340 },
};

const isTileSize = (value: unknown): value is TileSize => TILE_SIZES.includes(value as TileSize);

/** The tile size a queue page was last set to, remembered per queue in this browser. */
export const tileSize = (queue: SelectQueueName) => {
  const key = `cleanup.queue.${queue}.tile-size`;
  return {
    get: (): TileSize => {
      try {
        const value = localStorage.getItem(key);
        return isTileSize(value) ? value : 'medium';
      } catch {
        return 'medium';
      }
    },
    set: (size: TileSize): void => {
      try {
        localStorage.setItem(key, size);
      } catch {
        // Not remembered; the page still uses the size for now.
      }
    },
  };
};
