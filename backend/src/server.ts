import "reflect-metadata";
import app from './app';
import { createServer } from 'http'
import { Server } from 'socket.io'
import { setupSocket } from './services/anchorClient'

const PORT = process.env.PORT || 4000

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*' }
})

// Setup Socket.IO for real-time updates
setupSocket(io)

httpServer.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`)
}) 