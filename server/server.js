const express = require('express');
const http = require('http');
const https = require('https');
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
let clubMapUrl = '';
let clubLat = null;
let clubLng = null;

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
    clubMapUrl,
    clubLat,
    clubLng
  };
  io.emit('state_update', adminState);
};

// Helper: Dicebear Avatar generator
const generateAvatar = (name) => {
  return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(name + Date.now())}`;
};

// Helper: GPS Distance Calculation (Haversine Formula)
const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI/180);
  const dLon = (lon2 - lon1) * (Math.PI/180); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
};

// Verify if player is within 2 km of the club
const verifyGPS = (lat, lng) => {
  if (clubLat === null || clubLng === null) {
    return true; // Bypass if club location isn't set
  }
  if (!lat || !lng) return false;
  
  const distanceKm = getDistanceFromLatLonInKm(clubLat, clubLng, lat, lng);
  console.log(`Player distance: ${distanceKm.toFixed(2)} km. (${lat},${lng}) vs Club (${clubLat},${clubLng})`);
  return distanceKm <= 2.0; 
};

// URL Parser
const extractLatLng = (urlStr) => {
  const regex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
  const match = urlStr.match(regex);
  if (match) {
    return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  }
  return null;
};

const resolveMapLink = async (urlStr) => {
  try {
    const directCoords = extractLatLng(urlStr);
    if (directCoords) return directCoords;

    return new Promise((resolve) => {
      const isSecure = urlStr.startsWith('https');
      const reqModule = isSecure ? https : http;
      reqModule.get(urlStr, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location;
          const coords = extractLatLng(loc);
          if (coords) return resolve(coords);
        }
        resolve(null);
      }).on('error', (e) => {
        console.error("Link resolve error:", e);
        resolve(null);
      });
    });
  } catch (e) {
    return null;
  }
};

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
      avatar: data.customAvatar || generateAvatar(data.name),
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

  socket.on('update_club_location', async (urlStr) => {
    clubMapUrl = urlStr;
    if (!urlStr || !urlStr.trim()) {
      clubLat = null;
      clubLng = null;
    } else {
      const coords = await resolveMapLink(urlStr);
      if (coords) {
        clubLat = coords.lat;
        clubLng = coords.lng;
        console.log(`Club Location set: ${clubLat}, ${clubLng}`);
      } else {
        socket.emit('error', 'Could not extract valid GPS coordinates from the provided map link.');
        clubLat = null;
        clubLng = null;
      }
    }
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
