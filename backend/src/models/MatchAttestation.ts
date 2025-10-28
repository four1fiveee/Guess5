import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Match } from './Match';

@Entity()
export class MatchAttestation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  matchId!: string;

  @Column('jsonb')
  attestationJson!: any;

  @Column({ unique: true })
  attestationHash!: string;

  @Column({ default: false })
  signedByKms!: boolean;

  @Column({ nullable: true })
  kmsSignature?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => Match, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId' })
  match?: Match;
}

