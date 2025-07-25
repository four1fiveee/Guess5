import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  player1!: string;

  @Column()
  player2!: string;

  @Column()
  entryFee!: number;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ nullable: true })
  word?: string;

  @Column({ type: 'simple-json', nullable: true })
  player1Result?: { solved: boolean; numGuesses: number; totalTime: number } | null;

  @Column({ type: 'simple-json', nullable: true })
  player2Result?: { solved: boolean; numGuesses: number; totalTime: number } | null;

  @Column({ nullable: true })
  winner?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
} 