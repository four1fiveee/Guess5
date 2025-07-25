import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

// Transaction table schema
@Entity()
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  matchId: string

  @Column()
  player: string

  @Column()
  amount: number

  @Column()
  type: string // payout or refund

  @CreateDateColumn()
  createdAt: Date
} 