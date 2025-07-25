import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

// Match table schema
@Entity()
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  player1: string

  @Column()
  player2: string

  @Column()
  entryFee: number

  @Column({ default: 'pending' })
  status: string

  @CreateDateColumn()
  createdAt: Date
} 