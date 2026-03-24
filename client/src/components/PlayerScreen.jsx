import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../socket';
import TennisCourt from './TennisCourt';
import MatchHistory from './MatchHistory';

function PlayerScreen() {
  const navigate = useNavigate();
  const { clubSlug } = useParams();
  
  const [hasJoined, setHasJoined] = useState(false);
  const [playerData, setPlayerData] = useState(null);
  
  const [pinVerified, setPinVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Form State
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [level, setLevel] = useState('5');
  const [gender, setGender] = useState('M');

  // App State
  const [state, setState] = useState({
    clubName: 'Loading Club...',
    courts: [],
    idleQueue: [],
    players: {},
    gameStarted: false
  });

  const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

  useEffect(() => {
    if (!clubSlug) return;

    // 1. Fetch initial public club data (Name)
    const fetchClub = async () => {
      try {
        const res = await fetch(`${API_URL}/api/clubs/${clubSlug}`);
        const data = await res.json();
        if (res.ok) {
          setState(s => ({ ...s, clubName: data.name }));
        } else {
          setErrorMsg(data.error || 'Club not found.');
        }
      } catch (e) {
        setErrorMsg('Failed to load club information.');
      }
    };
    fetchClub();

    // 2. Setup Sockets
    socket.on('state_update', setState);
    
    socket.on('player_joined', (data) => {
      sessionStorage.setItem('tennis_session_id', data.id);
      setPlayerData(data);
      setPinVerified(true); // they are already in!
      setHasJoined(true);
      setIsJoining(false);
      setErrorMsg('');
    });
    
    socket.on('error', (msg) => {
      if (msg && msg.includes('Session expired')) {
        sessionStorage.removeItem('tennis_session_id');
      }
      setErrorMsg(msg);
      setIsJoining(false);
    });

    const onConnect = () => {
      // Connect to the isolated multi-tenant room immediately to receive broadcasts
      socket.emit('join_club_room', { clubId: clubSlug, role: 'PLAYER' });

      // Attempt auto-rejoin if they refresh the tab
      const sessionId = sessionStorage.getItem('tennis_session_id');
      if (sessionId) {
        socket.emit('join_player', { sessionId });
      }
    };

    socket.on('connect', onConnect);
    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off('state_update', setState);
      socket.off('player_joined');
      socket.off('error');
      socket.off('connect', onConnect);
    };
  }, [clubSlug]);

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    setIsVerifying(true);
    try {
      const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (res.ok) {
        setPinVerified(true);
        setErrorMsg('');
      } else {
        setErrorMsg('Invalid PIN. Please ask the club admin.');
      }
    } catch (e) {
      setErrorMsg('Verification failed.');
    }
    setIsVerifying(false);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) return setErrorMsg('Please upload a valid image file.');
      if (file.size > 5 * 1024 * 1024) return setErrorMsg('Image is too large. Max 5MB.');
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 100; canvas.height = 100;
          const ctx = canvas.getContext('2d');
          const min = Math.min(img.width, img.height);
          const sx = (img.width - min) / 2;
          const sy = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, 100, 100);
          setAvatarPreview(canvas.toDataURL('image/jpeg', 0.8));
          setErrorMsg('');
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Name is required');
    setIsJoining(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        socket.emit('join_player', {
          name, level, gender,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          customAvatar: avatarPreview
        });
      },
      (err) => {
        console.warn("Geolocation failed or denied. Proceeding with dummy coords.", err);
        socket.emit('join_player', {
          name, level, gender, lat: 0, lng: 0, customAvatar: avatarPreview
        });
      }
    );
  };

  const handleExit = () => {
    if (state.gameStarted) {
      setErrorMsg("Game is in progress, cannot exit.");
      return;
    }
    socket.emit('player_exit');
    sessionStorage.removeItem('tennis_session_id');
    setHasJoined(false);
    setPinVerified(false);
    setPlayerData(null);
  };

  let statusText = "You are in the setup phase.";
  let courtInfo = null;

  if (hasJoined && playerData) {
    const currentPlayer = state.players[playerData.id];
    if (!currentPlayer) {
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
        <img src={p.avatar} alt="avatar" width="24" height="24" style={{borderRadius: '50%', minWidth: '24px', minHeight: '24px', flexShrink: 0, objectFit: 'cover'}} />
        <div style={{ textShadow: isMe ? 'none' : '1px 1px 2px rgba(0,0,0,0.6)' }}>
          <div>{p.name} {isMe && '(You)'}</div>
        </div>
      </div>
    );
  };

  const renderTeammates = () => {
    if (!courtInfo) return null;
    const currentPlayer = state.players[playerData.id];
    if (!currentPlayer) return null;

    const mySideArray = currentPlayer.side === 'A' ? courtInfo.sideA : courtInfo.sideB;
    const otherSideArray = currentPlayer.side === 'A' ? courtInfo.sideB : courtInfo.sideA;

    return (
      <div className="mt-4 animate-fade-in" style={{ borderRadius: '12px', overflow: 'hidden', border: `2px solid ${courtInfo.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)'}` }}>
        <TennisCourt type={courtInfo.type}>
          <div style={{ flex: 1, padding: '20px 10px 20px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {mySideArray.map(id => renderPlayerBadge(state.players[id], id === playerData.id))}
            {mySideArray.length === 0 && <div style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', textShadow: '1px 1px 2px black'}}>Waiting...</div>}
          </div>
          <div style={{ flex: 1, padding: '20px 24px 20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: id === playerData.id ? 'rgba(204, 255, 0, 0.2)' : 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '12px', fontSize: '0.85rem', border: id === playerData.id ? '1px solid var(--accent-tennis)' : '1px solid transparent' }}>
                <img src={p.avatar} alt="avatar" width="20" height="20" style={{borderRadius: '50%', minWidth: '20px', minHeight: '20px', flexShrink: 0, objectFit: 'cover'}} />
                <span style={{color: id === playerData.id ? 'var(--accent-tennis)' : '#fff', fontWeight: id === playerData.id ? 'bold' : 'normal'}}>{p.name} {id === playerData.id && '(You)'}</span>
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
                        <img src={p.avatar} alt="avatar" width="18" height="18" style={{borderRadius: '50%', minWidth: '18px', minHeight: '18px', flexShrink: 0, objectFit: 'cover'}} />
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
                        <img src={p.avatar} alt="avatar" width="18" height="18" style={{borderRadius: '50%', minWidth: '18px', minHeight: '18px', flexShrink: 0, objectFit: 'cover'}} />
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
          !pinVerified ? (
            // Kahoot-style Step 1: PIN
            <form onSubmit={handleVerifyPin} className="animate-fade-in text-left">
              <div className="form-group">
                <label className="form-label">Enter Club PIN</label>
                <input
                  type="text"
                  className="form-control"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Ask the Admin for the PIN"
                  required
                />
              </div>
              <div className="mt-4 flex gap-4">
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate('/')}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={isVerifying}>{isVerifying ? 'Checking...' : 'Verify PIN'}</button>
              </div>
            </form>
          ) : (
            // Kahoot-style Step 2: Player Details
            <form onSubmit={handleJoin} className="animate-fade-in text-left">
              <div className="form-group">
                <label className="form-label">Player Name</label>
                <input type="text" className="form-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your name" required />
              </div>
              <div className="form-group">
                <label className="form-label">Tennis Level (1 = Best, 10 = Beginner)</label>
                <select className="form-control" value={level} onChange={(e) => setLevel(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Gender</label>
                <select className="form-control" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="M">Male</option><option value="F">Female</option><option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group" style={{ textAlign: 'center' }}>
                <label className="form-label" style={{ textAlign: 'left' }}>Profile Picture (Optional)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ flexShrink: 0, width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(0,0,0,0.3)', border: '2px solid var(--accent-tennis)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {avatarPreview ? <img src={avatarPreview} alt="preview" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>None</span>}
                  </div>
                  <input type="file" accept="image/png, image/jpeg, image/gif, image/webp" onChange={handleImageUpload} style={{ fontSize: '0.85rem', width: '100%', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="mt-4 flex gap-4">
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPinVerified(false)}>Back</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={isJoining}>{isJoining ? 'Joining...' : 'Enter Session'}</button>
              </div>
            </form>
          )
        ) : (
          <div className="animate-fade-in">
            {state.players[playerData.id] && (
              <img src={state.players[playerData.id].avatar} alt="Profile" style={{ width: '80px', height: '80px', borderRadius: '50%', marginBottom: '1rem', border: '2px solid var(--accent-tennis)' }} />
            )}
            <h3>Welcome, {state.players[playerData.id]?.name}</h3>

            <div className="mt-4" style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <p style={{ fontWeight: '500', fontSize: '1.1rem' }}>{statusText}</p>
              {state.gameStarted && <p style={{ color: 'var(--accent-tennis)', marginTop: '0.5rem', fontSize: '0.85rem' }}>🎾 Game is in progress.</p>}
              {courtInfo ? renderTeammates() : renderClubStatus()}
            </div>

            <MatchHistory matchHistory={state.matchHistory} players={state.players} />

            <button className="btn btn-danger mt-4" style={{ width: '100%' }} onClick={handleExit} disabled={state.gameStarted}>
              Exit Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerScreen;
