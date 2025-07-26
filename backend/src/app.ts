import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import matchRoutes from './routes/matchRoutes'
import guessRoutes from './routes/guessRoutes'
import { AppDataSource } from './db'
import "reflect-metadata";

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// Initialize database connection
AppDataSource.initialize()
  .then(() => {
    console.log('Database connected successfully')
  })
  .catch((error) => {
    console.error('Database connection failed:', error)
  })

// API routes
app.use('/api/match', matchRoutes)
app.use('/api/guess', guessRoutes)

export default app 