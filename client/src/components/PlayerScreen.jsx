import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import TennisCourt from './TennisCourt';

function PlayerScreen() {
  const navigate = useNavigate();
  const [hasJoined, setHasJoined] = useState(false);
  const [playerData, setPlayerData] = useState(null);
  const [isJoining, setIsJoining] = useState(false);

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
      setIsJoining(false);
      setErrorMsg('');
    });
    socket.on('error', (msg) => {
      setErrorMsg(msg);
      setIsJoining(false);
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
    setIsJoining(true);

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
      statusText = `Waiting in the Idle Queue.`;
    } else {
      const court = state.courts.find(c => c.id === currentPlayer.courtId);
      if (court) {
        statusText = `Assigned to Court ${court.number} (${court.type}) - Side ${currentPlayer.side}`;
        courtInfo = court;
      }
    }
  }

  const renderPlayerBadge = (p, isMe = false) => {
    if (!p) return null;
    return (
      <div 
        key={p.id} 
        style={{ 
          background: isMe ? 'rgba(204, 255, 0, 0.9)' : 'rgba(0,0,0,0.6)', 
          color: isMe ? '#000' : '#fff',
          padding: '6px 10px', 
          borderRadius: '20px',
          marginBottom: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          border: isMe ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
          fontSize: '0.85rem',
          fontWeight: isMe ? 'bold' : 'normal'
        }}
      >
        <img src={p.avatar} alt="avatar" width="24" height="24" style={{borderRadius: '50%'}} />
        <div style={{ textShadow: isMe ? 'none' : '1px 1px 2px rgba(0,0,0,0.6)' }}>
          <div>{p.name} {isMe && '(You)'}</div>
        </div>
      </div>
    );
  };

  const renderTeammates = () => {
    if (!courtInfo) return null;
    const currentPlayer = state.players[socket.id];
    if (!currentPlayer) return null;

    const mySideArray = currentPlayer.side === 'A' ? courtInfo.sideA : courtInfo.sideB;
    const otherSideArray = currentPlayer.side === 'A' ? courtInfo.sideB : courtInfo.sideA;

    return (
      <div className="mt-4 animate-fade-in" style={{ borderRadius: '12px', overflow: 'hidden', border: `2px solid ${courtInfo.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)'}` }}>
        <TennisCourt type={courtInfo.type}>
          <div style={{ flex: 1, padding: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.9)', fontWeight: 'bold', marginBottom: '10px' }}>Your Team</div>
            {mySideArray.map(id => renderPlayerBadge(state.players[id], id === socket.id))}
            {mySideArray.length === 0 && <div style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', textShadow: '1px 1px 2px black'}}>Waiting...</div>}
          </div>
          <div style={{ flex: 1, padding: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.9)', fontWeight: 'bold', marginBottom: '10px' }}>Opponents</div>
            {otherSideArray.map(id => renderPlayerBadge(state.players[id]))}
            {otherSideArray.length === 0 && <div style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', textShadow: '1px 1px 2px black'}}>Waiting...</div>}
          </div>
        </TennisCourt>
      </div>
    );
  };

  const renderClubStatus = () => {
    return (
      <div className="mt-4 animate-fade-in" style={{ textAlign: 'left' }}>
        <h4 className="mb-2" style={{color: 'var(--accent-tennis)'}}>Idle Queue ({state.idleQueue.length}):</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px' }}>
          {state.idleQueue.length > 0 ? state.idleQueue.map(id => {
            const p = state.players[id];
            if (!p) return null;
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: id === socket.id ? 'rgba(204, 255, 0, 0.2)' : 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '12px', fontSize: '0.85rem', border: id === socket.id ? '1px solid var(--accent-tennis)' : '1px solid transparent' }}>
                <img src={p.avatar} alt="avatar" width="20" height="20" style={{borderRadius: '50%'}} />
                <span style={{color: id === socket.id ? 'var(--accent-tennis)' : '#fff', fontWeight: id === socket.id ? 'bold' : 'normal'}}>{p.name} {id === socket.id && '(You)'}</span>
              </div>
            );
          }) : <div style={{color: 'var(--text-secondary)', fontSize: '0.85rem'}}>No one is waiting.</div>}
        </div>

        <h4 className="mb-2" style={{color: 'var(--accent-tennis)'}}>Active Courts ({state.courts.length}):</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {state.courts.length > 0 ? state.courts.map(court => (
            <div key={court.id} style={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${court.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)'}` }}>
              <div style={{ background: court.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)', padding: '6px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 'bold' }}>
                Court {court.number} ({court.type})
              </div>
              <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', padding: '10px', gap: '10px' }}>
                <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px', textAlign: 'center' }}>Side A</div>
                  {court.sideA.map(id => {
                    const p = state.players[id];
                    if (!p) return null;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '0.85rem' }}>
                        <img src={p.avatar} alt="avatar" width="18" height="18" style={{borderRadius: '50%'}} />
                        <span>{p.name}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ flex: 1, paddingLeft: '10px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px', textAlign: 'center' }}>Side B</div>
                  {court.sideB.map(id => {
                    const p = state.players[id];
                    if (!p) return null;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '0.85rem' }}>
                        <img src={p.avatar} alt="avatar" width="18" height="18" style={{borderRadius: '50%'}} />
                        <span>{p.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )) : <div style={{color: 'var(--text-secondary)', fontSize: '0.85rem'}}>No active courts.</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', textAlign: 'center', WebkitOverflowScrolling: 'touch', maxHeight: '95vh', overflowY: 'auto' }}>
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
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/')} disabled={isJoining}>Back</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={isJoining}>{isJoining ? 'Joining...' : 'Join Session'}</button>
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

              {courtInfo ? renderTeammates() : renderClubStatus()}
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
