import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import matchRoutes from './routes/matchRoutes'
import guessRoutes from './routes/guessRoutes'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// API routes
app.use('/api/match', matchRoutes)
app.use('/api/guess', guessRoutes)

export default app 