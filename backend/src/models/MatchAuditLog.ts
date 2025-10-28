import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Match } from './Match';

@Entity()
export class MatchAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  matchId?: string;

  @Column()
  eventType!: string;

  @Column('jsonb', { nullable: true })
  eventData?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => Match, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId' })
  match?: Match;
}

