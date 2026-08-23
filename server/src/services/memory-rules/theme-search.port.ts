export interface ThemeSearchAsset {
  id: string;
  localDateTime: Date;
}

export interface ThemeSearchPort {
  /** null when smart search is disabled or the embedding cannot be produced. Never throws. */
  resolveEmbedding(themeKey: string, query: string): Promise<string | null>;
  /** Assets ordered by similarity, best first. */
  searchByEmbedding(params: {
    ownerId: string;
    embedding: string;
    takenAfter: Date;
    takenBefore: Date;
    size: number;
  }): Promise<ThemeSearchAsset[]>;
}
