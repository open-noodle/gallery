import { Column, ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';

@Table({ name: 'pet_search' })
@Index({
  name: 'pet_index',
  using: 'hnsw',
  expression: `embedding vector_cosine_ops`,
  with: 'ef_construction = 300, m = 16',
})
export class PetSearchTable {
  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', primary: true })
  faceId!: string;

  @Column({ type: 'vector', length: 512, synchronize: false })
  embedding!: string;

  /**
   * Species label from the detector, captured at embed time. The queue-all and nightly recognition
   * paths carry no label in their job data, so without this a person created from those paths got
   * `species: null` (F8). Nullable — rows written before migration 1785200000000 have none.
   */
  @Column({ type: 'text', nullable: true })
  species!: string | null;
}
