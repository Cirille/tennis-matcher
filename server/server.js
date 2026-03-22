const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 4000;

// Global State Variables
let clubName = 'My Tennis Club';
let isLocked = false;

// Court structure: { id, type (Hard/Clay), number, sideA: [playerIds], sideB: [playerIds] }
let courts = []; 
let players = {}; // Object map by socket.id
let idleQueue = []; // array of playerIds

// Helper: Broadcast state
const broadcastState = () => {
  const adminState = {
    clubName,
    isLocked,
    courts,
    idleQueue,
    players,
  };
  io.emit('state_update', adminState);
};

// Helper: Dicebear Avatar generator
const generateAvatar = (name) => {
  return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name + Date.now())}`;
};

// Helper: GPS Verification
// In a real app we would compute haversine distance. Here we just return true.
const verifyGPS = (lat, lng) => true; 

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send initial state
  socket.emit('state_update', { clubName, isLocked, courts, idleQueue, players });

  // Player joins
  socket.on('join_player', (data) => {
    // Guard against multiple join events from the same socket
    if (players[socket.id]) {
      socket.emit('player_joined', players[socket.id]);
      return;
    }

    if (!verifyGPS(data.lat, data.lng)) {
      socket.emit('error', 'GPS validation failed.');
      return;
    }
    const newPlayer = {
      id: socket.id,
      name: data.name,
      level: Number(data.level),
      gender: data.gender,
      avatar: generateAvatar(data.name),
      idle_rounds: 0,
      courtId: null,
      side: null // 'A' or 'B'
    };
    players[socket.id] = newPlayer;
    if (!idleQueue.includes(socket.id)) {
      idleQueue.push(socket.id);
    }
    
    socket.emit('player_joined', newPlayer);
    broadcastState();
  });

  // Admin updates
  socket.on('update_courts', (newCourts) => {
    courts = newCourts;
    broadcastState();
  });

  socket.on('update_club_name', (name) => {
    clubName = name;
    broadcastState();
  });

  socket.on('toggle_lock', (locked) => {
    isLocked = locked;
    broadcastState();
  });

  // Smart Matchmaking
  socket.on('auto_matchmake', () => {
    // 1. Determine slots
    let availableSlots = courts.length * 4; // Assume max 4 players per court (doubles)

    // 2. Fetch all currently available players (idle + already on courts)
    let allAvailablePlayers = [...idleQueue];
    courts.forEach(c => {
       if (c.sideA) c.sideA.forEach(pid => allAvailablePlayers.push(pid));
       if (c.sideB) c.sideB.forEach(pid => allAvailablePlayers.push(pid));
       c.sideA = [];
       c.sideB = [];
    });

    let playerPool = allAvailablePlayers.map(id => players[id]).filter(Boolean);
    
    // 3. Sort by idle rounds descending
    playerPool.sort((a, b) => b.idle_rounds - a.idle_rounds);

    // 4. Pluck top N based on capacity
    let topN = playerPool.slice(0, availableSlots);
    let leftOver = playerPool.slice(availableSlots);

    // 5. Sort top N by level to group organically
    topN.sort((a, b) => b.level - a.level);

    // 6. Distribute
    let pIdx = 0;
    for (let c of courts) {
      if (!c.sideA) c.sideA = [];
      if (!c.sideB) c.sideB = [];
      
      // Side A
      while(c.sideA.length < 2 && pIdx < topN.length) {
         let p = topN[pIdx++];
         p.courtId = c.id; 
         p.side = 'A';
         c.sideA.push(p.id);
      }
      // Side B
      while(c.sideB.length < 2 && pIdx < topN.length) {
         let p = topN[pIdx++];
         p.courtId = c.id; 
         p.side = 'B';
         c.sideB.push(p.id);
      }
    }

    // Update idle rounds
    topN.forEach(p => p.idle_rounds = 0);
    leftOver.forEach(p => p.idle_rounds += 1);
    
    idleQueue = leftOver.map(p => p.id);

    broadcastState();
  });

  // Drag and Drop overrides
  socket.on('admin_move_player', ({ playerId, sourceCourtId, sourceSide, destCourtId, destSide }) => {
    const player = players[playerId];
    if(!player) return;

    // Remove from source
    if (sourceCourtId === 'idle') {
      idleQueue = idleQueue.filter(id => id !== playerId);
    } else {
      const sCourt = courts.find(c => c.id === sourceCourtId);
      if(sCourt) {
        if(sourceSide === 'A') sCourt.sideA = sCourt.sideA.filter(id => id !== playerId);
        if(sourceSide === 'B') sCourt.sideB = sCourt.sideB.filter(id => id !== playerId);
      }
    }

    // Add to destination
    if (destCourtId === 'idle') {
      player.courtId = null;
      player.side = null;
      idleQueue.push(playerId);
    } else {
      const dCourt = courts.find(c => c.id === destCourtId);
      if(dCourt) {
        player.courtId = destCourtId;
        player.side = destSide;
        if(destSide === 'A') dCourt.sideA.push(playerId);
        if(destSide === 'B') dCourt.sideB.push(playerId);
      }
    }
    broadcastState();
  });

  // Exit
  const leavePlayer = (id) => {
    const player = players[id];
    if (player) {
      if (isLocked) {
         // Prevent leave if locked - although tricky on disconnect, 
         // we just keep them in state to not break visual locked match.
         return; 
      }
      idleQueue = idleQueue.filter(pid => pid !== id);
      if (player.courtId) {
        let court = courts.find(c => c.id === player.courtId);
        if (court) {
           if (court.sideA) court.sideA = court.sideA.filter(pid => pid !== id);
           if (court.sideB) court.sideB = court.sideB.filter(pid => pid !== id);
        }
      }
      delete players[id];
      broadcastState();
    }
  };

  socket.on('player_exit', () => {
    if (isLocked) {
      socket.emit('error', 'Match is locked.');
      return;
    }
    leavePlayer(socket.id);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    leavePlayer(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
