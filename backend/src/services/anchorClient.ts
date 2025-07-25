// @ts-ignore: If 'socket.io' types are missing, install with npm i --save-dev @types/socket.io
import { Server, Socket } from 'socket.io';

// TODO: Implement real Anchor client logic for initializing a game
export const anchorInitGame = async (gameData: any) => {
  // Call the Anchor program to init the game here
  // Example: await program.rpc.initGame(...)
  // throw new Error('Not implemented');
};

// Setup Socket.IO for real-time updates
export const setupSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    socket.on('joinLobby', (data: any) => {
      // TODO: Implement real matchmaking logic
      // For now, just acknowledge the join (no dummy match)
      socket.emit('lobbyJoined', { status: 'waiting' });
    });
  });
}; 