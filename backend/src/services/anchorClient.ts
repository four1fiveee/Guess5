import { Server } from 'socket.io'

// Dummy Anchor client logic for demo
export const anchorInitGame = async () => {
  // Here you would call the Anchor program to init the game
  // For now, just log
  console.log('Anchor: init_game called')
}

// Setup Socket.IO for real-time updates
export const setupSocket = (io: Server) => {
  io.on('connection', (socket) => {
    socket.on('joinLobby', (data) => {
      // For demo, immediately match
      setTimeout(() => {
        socket.emit('matchFound', { matchId: 'dummy-match-id' })
      }, 1000)
    })
  })
} 