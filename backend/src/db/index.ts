import { DataSource } from 'typeorm'
import { Match } from '../models/Match'
import { Guess } from '../models/Guess'
import { Transaction } from '../models/Transaction'

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Match, Guess, Transaction],
  synchronize: true, // For dev only; use migrations in prod
}) 