import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';

function PlayerScreen() {
  const navigate = useNavigate();
  const [hasJoined, setHasJoined] = useState(false);
  const [playerData, setPlayerData] = useState(null);
  
  // Form State
  const [name, setName] = useState('');
  const [level, setLevel] = useState('3.0');
  const [gender, setGender] = useState('M');
  
  // App State
  const [state, setState] = useState({
    clubName: 'Tennis Club',
    courts: [],
    idleQueue: [],
    players: {},
    isLocked: false
  });
  
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    socket.on('state_update', setState);
    socket.on('player_joined', (data) => {
      setPlayerData(data);
      setHasJoined(true);
      setErrorMsg('');
    });
    socket.on('error', (msg) => {
      setErrorMsg(msg);
    });

    return () => {
      socket.off('state_update', setState);
      socket.off('player_joined');
      socket.off('error');
    };
  }, []);

  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Name is required');
    // Geo validation mock
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        socket.emit('join_player', {
          name,
          level,
          gender,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      },
      (err) => {
        // Fallback for testing without GPS
        socket.emit('join_player', {
          name, level, gender, lat: 0, lng: 0
        });
      }
    );
  };

  const handleExit = () => {
    // If locked, backend rejects, but we don't want weird UI state
    if (state.isLocked) {
       setErrorMsg("Match is locked, cannot exit.");
       return;
    }
    socket.emit('player_exit');
    setHasJoined(false);
    setPlayerData(null);
    navigate('/');
  };

  // Determine user's current status
  let statusText = "You are in the setup phase.";
  let courtInfo = null;

  if (hasJoined && playerData) {
    // Need to find player in state.players to get latest courtId
    const currentPlayer = state.players[socket.id];
    if (!currentPlayer) {
       // Kicked or left
       statusText = "You have been disconnected.";
    } else if (!currentPlayer.courtId) {
       statusText = `Waiting in the Idle Queue. (Idle Rounds: ${currentPlayer.idle_rounds})`;
    } else {
       const court = state.courts.find(c => c.id === currentPlayer.courtId);
       if (court) {
         statusText = `Assigned to Court ${court.number} (${court.type}) - Side ${currentPlayer.side}`;
         courtInfo = court;
       }
    }
  }

  // Find teammates
  const renderTeammates = () => {
    if (!courtInfo) return null;
    const currentPlayer = state.players[socket.id];
    if (!currentPlayer) return null;

    const mySideArray = currentPlayer.side === 'A' ? courtInfo.sideA : courtInfo.sideB;
    const otherSideArray = currentPlayer.side === 'A' ? courtInfo.sideB : courtInfo.sideA;

    const myTeammates = mySideArray.filter(id => id !== socket.id).map(id => state.players[id]);
    const opponents = otherSideArray.map(id => state.players[id]);

    return (
      <div className="mt-4 animate-fade-in" style={{ textAlign: 'left' }}>
        <h4 className="mb-2" style={{color: 'var(--accent-tennis)'}}>Your Team:</h4>
        {myTeammates.length > 0 ? myTeammates.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <img src={t.avatar} alt="avatar" width="24" height="24" style={{borderRadius: '50%'}} />
            <span>{t.name} (Lvl {t.level})</span>
          </div>
        )) : <div style={{color: 'var(--text-secondary)'}}>No partner yet.</div>}

        <h4 className="mb-2 mt-4" style={{color: 'var(--danger)'}}>Opponents:</h4>
        {opponents.length > 0 ? opponents.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <img src={t.avatar} alt="avatar" width="24" height="24" style={{borderRadius: '50%'}} />
            <span>{t.name} (Lvl {t.level})</span>
          </div>
        )) : <div style={{color: 'var(--text-secondary)'}}>Waiting for opponents...</div>}
      </div>
    );
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', textAlign: 'center' }}>
        <h2 className="mb-4">{state.clubName}</h2>
        {errorMsg && <div className="mb-4 animate-fade-in" style={{ color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px' }}>{errorMsg}</div>}

        {!hasJoined ? (
          <form onSubmit={handleJoin} className="animate-fade-in text-left">
            <div className="form-group">
              <label className="form-label">Player Name</label>
              <input 
                type="text" 
                className="form-control" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                placeholder="Enter your name"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tennis Level</label>
              <select className="form-control" value={level} onChange={(e) => setLevel(e.target.value)}>
                {[1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0].map(l => (
                  <option key={l} value={l.toFixed(1)}>{l.toFixed(1)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Gender</label>
              <select className="form-control" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="mt-4 flex gap-4">
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/')}>Back</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2 }}>Join Session</button>
            </div>
          </form>
        ) : (
          <div className="animate-fade-in">
            {state.players[socket.id] && (
              <img 
                src={state.players[socket.id].avatar} 
                alt="Profile" 
                style={{ width: '80px', height: '80px', borderRadius: '50%', marginBottom: '1rem', border: '2px solid var(--accent-tennis)' }}
              />
            )}
            <h3>Welcome, {state.players[socket.id]?.name}</h3>
            
            <div className="mt-4" style={{ 
              padding: '1rem', 
              background: 'rgba(0,0,0,0.3)', 
              borderRadius: '8px',
              border: '1px solid var(--glass-border)'
            }}>
              <p style={{ fontWeight: '500', fontSize: '1.1rem' }}>{statusText}</p>
              {state.isLocked && <p style={{ color: 'var(--danger)', marginTop: '0.5rem', fontSize: '0.85rem' }}>🔒 Match is currently locked by Admin.</p>}
              
              {renderTeammates()}
            </div>

            <button 
              className="btn btn-danger mt-4" 
              style={{ width: '100%' }} 
              onClick={handleExit}
              disabled={state.isLocked}
            >
              Exit Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerScreen;
