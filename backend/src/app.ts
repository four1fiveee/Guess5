const express = require('express');
import cors from 'cors'
import dotenv from 'dotenv'
import matchRoutes from './routes/matchRoutes'
import guessRoutes from './routes/guessRoutes'
import { AppDataSource } from './db'
import "reflect-metadata";

dotenv.config()

// Correctly declare dbConnected as a boolean
export let dbConnected: boolean = false;

const app = express()
app.use(cors())
app.use(express.json())

// Initialize database connection with error handling
const initializeDatabase = async () => {
  try {
    if (process.env.DATABASE_URL) {
      await AppDataSource.initialize()
      dbConnected = true;
      console.log('Database connected successfully')
    } else {
      dbConnected = false;
      console.log('No DATABASE_URL provided, running without database')
    }
  } catch (error) {
    dbConnected = false;
    console.error('Database connection failed:', error)
    console.log('Continuing without database connection')
  }
}

// Initialize database
initializeDatabase()

// API routes
app.use('/api/match', matchRoutes)
app.use('/api/guess', guessRoutes)

export default app 