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
}
