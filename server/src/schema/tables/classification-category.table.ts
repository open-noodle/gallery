import {
  Column,
  CreateDateColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';

@Table('classification_category')
@UpdatedAtTrigger('classification_category_updatedAt')
@Unique({ columns: ['name'] })
export class ClassificationCategoryTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column()
  name!: string;

  @Column({ type: 'real', default: 0.28 })
  similarity!: Generated<number>;

  @Column({ type: 'character varying', default: 'tag' })
  action!: Generated<string>;

  @Column({ type: 'boolean', default: true })
  enabled!: Generated<boolean>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
