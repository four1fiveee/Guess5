import { DataSource } from 'typeorm'
import { Match } from '../models/Match'
import { Guess } from '../models/Guess'
import { Transaction } from '../models/Transaction'

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require',
  entities: [Match, Guess, Transaction],
  synchronize: true, // For dev only; use migrations in prod
  logging: false,
  extra: {
    ssl: {
      rejectUnauthorized: false
    }
  }
})

// Initialize database connection
export const initializeDatabase = async () => {
  try {
    await AppDataSource.initialize()
    console.log('✅ Database connected successfully')
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    throw error
  }
} 