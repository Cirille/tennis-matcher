const crypto = require('node:crypto');
const { autoMatchmake } = require('./matchmaker');
const { ensure, object } = require('./validation');

function removeFromCourt(state, playerId) {
  state.idleQueue = state.idleQueue.filter(id => id !== playerId);
  for (const court of state.courts) for (const side of ['sideA', 'sideB']) court[side] = court[side].filter(id => id !== playerId);
  if (state.players[playerId]) Object.assign(state.players[playerId], { courtId: null, side: null });
}

function assertSession(state) {
  const seen = new Set();
  const add = (id, courtId, side) => {
    ensure(Object.hasOwn(state.players, id) && !seen.has(id), 'Invalid player assignment');
    ensure(state.players[id].courtId === courtId && state.players[id].side === side, 'Inconsistent player assignment');
    seen.add(id);
  };
  ensure(state.courts.length <= 32 && Object.keys(state.players).length <= 500, 'Session capacity reached');
  const courts = new Set();
  for (const court of state.courts) {
    ensure(!courts.has(court.id), 'Duplicate court'); courts.add(court.id);
    for (const side of ['A', 'B']) {
      ensure(Array.isArray(court['side' + side]) && court['side' + side].length <= 2, 'Court side is full');
      court['side' + side].forEach(id => add(id, court.id, side));
    }
  }
  state.idleQueue.forEach(id => add(id, null, null));
  ensure(seen.size === Object.keys(state.players).length, 'A player is missing from the court or waiting list');
}

function applyCommand(state, action, value) {
  ensure(state.status === 'open', 'This session has ended. Start a new session.');
  const idle = () => ensure(!state.gameStarted, 'End the current round before changing assignments.');
  const data = () => ensure(object(value), 'Invalid command details');
  switch (action) {
    case 'add_court': {
      idle(); data();
      ensure(['Hard', 'Clay'].includes(value.type), 'Choose a hard or clay court');
      ensure(state.courts.length < 32, 'Maximum 32 courts per session');
      state.courts.push({ id: crypto.randomUUID(), number: Math.max(0, ...state.courts.map(c => c.number)) + 1, type: value.type, sideA: [], sideB: [] });
      break;
    }
    case 'remove_court': {
      idle(); data();
      const court = state.courts.find(c => c.id === value.courtId);
      ensure(court, 'Court no longer exists');
      for (const id of [...court.sideA, ...court.sideB]) { removeFromCourt(state, id); state.idleQueue.push(id); }
      state.courts = state.courts.filter(c => c.id !== court.id);
      break;
    }
    case 'admin_move_player': {
      idle(); data();
      const player = state.players[value.playerId];
      ensure(player && Object.hasOwn(state.players, value.playerId), 'Player no longer exists');
      const dest = value.destCourtId === 'idle' ? null : state.courts.find(c => c.id === value.destCourtId);
      ensure(value.destCourtId === 'idle' || (dest && ['A', 'B'].includes(value.destSide)), 'Invalid destination');
      ensure(!dest || player.available !== false, 'Make this player available before assigning a court');
      ensure(!dest || dest['side' + value.destSide].filter(id => id !== player.id).length < 2, 'Court side is full');
      removeFromCourt(state, player.id);
      if (dest) { dest['side' + value.destSide].push(player.id); player.courtId = dest.id; player.side = value.destSide; }
      else state.idleQueue.push(player.id);
      break;
    }
    case 'auto_matchmake':
      idle();
      state.idleQueue = autoMatchmake(state.courts, state.players, state.idleQueue, state.matchHistory);
      break;
    case 'toggle_game':
      ensure(typeof value === 'boolean', 'Invalid round state');
      ensure(value !== state.gameStarted, value ? 'Round already started' : 'Round already ended', 409, 'CONFLICT');
      if (value) {
        ensure(state.matchHistory.length < 200, 'Start a new session after 200 rounds');
        const occupied = state.courts.filter(c => c.sideA.length || c.sideB.length);
        ensure(occupied.length && occupied.every(c => c.sideA.length === c.sideB.length && [1, 2].includes(c.sideA.length)), 'Fill both sides equally before starting a round');
        state.idleAtStart = state.idleQueue.filter(id => state.players[id].available !== false);
        state.roundId = crypto.randomUUID();
        state.roundStartedAt = new Date().toISOString();
      } else {
        const courts = structuredClone(state.courts.filter(c => c.sideA.length || c.sideB.length));
        const participants = Object.fromEntries(courts.flatMap(c => [...c.sideA, ...c.sideB]).map(id => [id, { name: state.players[id].name }]));
        state.matchHistory.push({ id: state.roundId, roundNumber: state.matchHistory.length + 1, startedAt: state.roundStartedAt, endedAt: new Date().toISOString(), courts, participants });
        for (const id of Object.keys(participants)) state.players[id].idle_rounds = 0;
        for (const id of state.idleAtStart) if (state.players[id]?.available !== false && state.idleQueue.includes(id)) state.players[id].idle_rounds++;
        state.idleAtStart = [];
      }
      state.gameStarted = value;
      break;
    case 'toggle_require_approval':
      ensure(typeof value === 'boolean', 'Invalid approval setting'); state.requireApproval = value; break;
    case 'set_check_in':
      ensure(typeof value === 'boolean', 'Invalid check-in setting'); state.checkInOpen = value; break;
    case 'set_player_available': {
      idle(); data();
      ensure(Object.hasOwn(state.players, value.playerId) && typeof value.available === 'boolean', 'Invalid player availability');
      state.players[value.playerId].available = value.available;
      if (!value.available) { removeFromCourt(state, value.playerId); state.idleQueue.push(value.playerId); }
      break;
    }
    case 'admin_remove_player':
      idle(); data(); ensure(Object.hasOwn(state.players, value.playerId), 'Player no longer exists');
      removeFromCourt(state, value.playerId); delete state.players[value.playerId]; break;
    case 'end_session':
      idle(); state.status = 'ended'; state.checkInOpen = false; state.endedAt = new Date().toISOString();
      state.pendingApprovals = []; break;
    default: ensure(false, 'Unknown command');
  }
  assertSession(state);
}

function addPlayer(state, profile, socketId) {
  ensure(state.status === 'open' && state.checkInOpen, 'Check-in is closed');
  ensure(Object.keys(state.players).length < 500, 'Session is full');
  const id = crypto.randomUUID();
  const player = { id, name: profile.name.trim(), level: Number(profile.level), gender: profile.gender,
    avatar: profile.customAvatar || profile.avatar || '/avatar.svg', currentSocketId: socketId,
    idle_rounds: 0, courtId: null, side: null, disconnected: false, available: true };
  state.players[id] = player;
  state.idleQueue.push(id);
  return player;
}

function publicState(state, club, admin, admitted) {
  const players = Object.fromEntries(Object.entries(state.players).map(([id, player]) => {
    const { currentSocketId, ...details } = player;
    if (!admin) { delete details.gender; delete details.level; }
    return [id, details];
  }));
  return { sessionId: state.id, revision: state.revision, createdAt: state.createdAt, endedAt: state.endedAt, status: state.status,
    clubName: club.name, clubMapUrl: club.mapUrl, clubLat: club.lat, clubLng: club.lng,
    gameStarted: state.gameStarted, requireApproval: state.requireApproval, checkInOpen: state.checkInOpen,
    courts: admin || admitted ? state.courts : [], players: admin || admitted ? players : {},
    idleQueue: admin || admitted ? state.idleQueue : [], matchHistory: admin || admitted ? state.matchHistory : [],
    pendingApprovals: admin ? state.pendingApprovals.map(({ socketId, ...request }) => request) : [] };
}
module.exports = { applyCommand, assertSession, removeFromCourt, addPlayer, publicState };
