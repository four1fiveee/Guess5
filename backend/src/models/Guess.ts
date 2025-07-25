import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class Guess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  matchId!: string;

  @Column()
  player!: string;

  @Column()
  guess!: string;

  @Column()
  guessNumber!: number;

  @Column()
  timeTaken!: number;

  @CreateDateColumn()
  createdAt!: Date;
} 