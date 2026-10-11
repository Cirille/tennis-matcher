import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../socket';
import TennisCourt from './TennisCourt';
import MatchHistory from './MatchHistory';
import { connectToClub } from '../clubConnection';
import { readPlayerSession, savePlayerSession, clearPlayerSession } from '../playerSession';
import { getPlayerCoordinates } from '../playerLocation';

import { API_URL } from '../api';
import { Avatar, Brand, Icon } from './UI';

function PlayerScreen() {
  const navigate = useNavigate();
  const { clubSlug } = useParams();
  const [accessToken, setAccessToken] = useState(() => {
    const saved = readPlayerSession(clubSlug);
    return saved?.sessionToken || saved?.joinToken || '';
  });
  const [roomReady, setRoomReady] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const joinAttempt = useRef(0);
  
  const [hasJoined, setHasJoined] = useState(false);
  const [playerData, setPlayerData] = useState(null);
  
  const [pinVerified, setPinVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState('');
  const [removedMessage, setRemovedMessage] = useState('');
  const [gpsFailed, setGpsFailed] = useState(false);
  const [gpsDistance, setGpsDistance] = useState(null);

  // Form State
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [level, setLevel] = useState('5');
  const [gender, setGender] = useState('Other');

  // App State
  const [state, setState] = useState({
    clubName: 'Loading Club...',
    courts: [],
    idleQueue: [],
    players: {},
    gameStarted: false
  });

  useEffect(() => {
    if (!clubSlug) return;
    const controller = new AbortController();

    // 1. Fetch initial public club data (Name)
    const fetchClub = async () => {
      try {
        const res = await fetch(`${API_URL}/api/clubs/${clubSlug}`, { signal: controller.signal });
        const data = await res.json();
        if (res.ok) {
          setState(s => ({ ...s, clubName: data.name, clubMapUrl: data.mapUrl, clubLat: data.lat, clubLng: data.lng }));
        } else {
          setErrorMsg(data.error || 'Club not found.');
        }
      } catch {
        if (!controller.signal.aborted) setErrorMsg('Failed to load club information.');
      }
    };
    fetchClub();
    return () => controller.abort();
  }, [clubSlug]);

  useEffect(() => {
    if (!clubSlug || !accessToken) return;

    // 2. Setup Sockets
    socket.on('state_update', setState);
    
    const onPlayerJoined = (data) => {
      savePlayerSession(clubSlug, { ...readPlayerSession(clubSlug), sessionId: data.id, sessionToken: data.sessionToken });
      setPlayerData(data);
      setPinVerified(true); // they are already in!
      setHasJoined(true);
      setIsJoining(false);
      setAwaitingApproval(false);
      setGpsFailed(false);
      setApprovalMessage('');
      setErrorMsg('');
    };
    
    const onError = (msg) => {
      if (msg && (msg.includes('Session expired') || msg.includes('PIN verification'))) {
        clearPlayerSession(clubSlug);
        setAccessToken('');
        setPinVerified(false);
        setHasJoined(false);
        setPlayerData(null);
        setAwaitingApproval(false);
        setGpsFailed(false);
        setApprovalMessage('');
        setRoomReady(false);
        setState(s => ({ ...s, players: {}, courts: [], idleQueue: [], matchHistory: [] }));
      }
      setErrorMsg(msg);
      setIsJoining(false);
      setAwaitingApproval(false);
    };

    const onGpsFailed = ({ distance }) => {
      setGpsFailed(true);
      setGpsDistance(distance);
      setIsJoining(false);
      setErrorMsg('');
    };

    const onApprovalRequired = ({ message }) => {
      setApprovalMessage(message);
      setIsJoining(false);
      setErrorMsg('');
    };

    const onApprovalDenied = ({ message }) => {
      setAwaitingApproval(false);
      setGpsFailed(false);
      setApprovalMessage('');
      setErrorMsg(message || 'Your request to join has been denied.');
    };

    const onPlayerRemoved = ({ message }) => {
      const joinToken = readPlayerSession(clubSlug)?.joinToken;
      clearPlayerSession(clubSlug);
      if (joinToken) savePlayerSession(clubSlug, { joinToken });
      setAccessToken(joinToken || '');
      setRoomReady(false);
      setConnectionRevision(value => value + 1);
      setHasJoined(false);
      setPinVerified(Boolean(joinToken));
      setPlayerData(null);
      setAwaitingApproval(false);
      setGpsFailed(false);
      setApprovalMessage('');
      setRemovedMessage(message || 'You have been removed by the admin.');
    };

    socket.on('player_joined', onPlayerJoined);
    socket.on('error', onError);
    socket.on('gps_failed', onGpsFailed);
    socket.on('approval_required', onApprovalRequired);
    socket.on('approval_denied', onApprovalDenied);
    socket.on('player_removed', onPlayerRemoved);
    const disconnectClub = connectToClub(socket, () => ({
      clubId: clubSlug, role: 'PLAYER', token: readPlayerSession(clubSlug)?.sessionToken || accessToken
    }), {
      onJoined: () => {
        setRoomReady(true);
        const saved = readPlayerSession(clubSlug);
        if (saved?.sessionId) socket.emit('join_player', { sessionId: saved.sessionId });
      },
      onError,
      onDisconnected: () => {
        setRoomReady(false);
        setAwaitingApproval(false);
        setIsJoining(false);
        joinAttempt.current += 1;
      }
    });

    return () => {
      joinAttempt.current += 1;
      socket.off('state_update', setState);
      disconnectClub();
      socket.off('player_joined', onPlayerJoined);
      socket.off('error', onError);
      socket.off('gps_failed', onGpsFailed);
      socket.off('approval_required', onApprovalRequired);
      socket.off('approval_denied', onApprovalDenied);
      socket.off('player_removed', onPlayerRemoved);
    };
  }, [clubSlug, accessToken, connectionRevision]);

  const handleVerifyPin = async (e) => {
    e.preventDefault();
    setIsVerifying(true);
    try {
      const res = await fetch(`${API_URL}/api/clubs/${clubSlug}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (res.ok && data.joinToken) {
        savePlayerSession(clubSlug, { joinToken: data.joinToken });
        setAccessToken(data.joinToken);
        setPinVerified(true);
        setErrorMsg('');
      } else {
        setErrorMsg(data.error || 'Invalid PIN. Please ask the club admin.');
      }
    } catch {
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

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!roomReady || !socket.connected) return setErrorMsg('Reconnect before joining.');
    if (!name.trim()) return setErrorMsg('Name is required');
    setIsJoining(true);
    setRemovedMessage('');
    setGpsFailed(false);
    setApprovalMessage('');

    const attempt = ++joinAttempt.current;
    const location = state.requireApproval || state.clubLat == null || state.clubLng == null ? {} : await getPlayerCoordinates();
    if (attempt !== joinAttempt.current) return;
    socket.emit('join_player', { name, level, gender, ...location, customAvatar: avatarPreview });
  };

  const handleRequestApproval = () => {
    if (!roomReady || !socket.connected) return setErrorMsg('Reconnect before requesting approval.');
    setAwaitingApproval(true);
    socket.emit('request_approval', { name, level, gender, customAvatar: avatarPreview });
  };

  const handleExit = async () => {
    if (state.gameStarted) {
      setErrorMsg("Game is in progress, cannot exit.");
      return;
    }
    if (!roomReady || !socket.connected) return setErrorMsg('Reconnect before leaving the session.');
    const result = await new Promise(resolve => socket.timeout(7000).emit('player_exit', {}, (err, response) => resolve(err ? { error: 'Could not confirm that you left. Please reconnect and check.' } : response)));
    if (!result?.success) return setErrorMsg(result?.error || 'Could not leave the session.');
    joinAttempt.current += 1;
    clearPlayerSession(clubSlug);
    setAccessToken('');
    setRoomReady(false);
    setHasJoined(false);
    setPinVerified(false);
    setPlayerData(null);
  };

  const currentPlayer = playerData && state.players[playerData.id];
  const courtInfo = currentPlayer?.courtId && state.courts.find(court => court.id === currentPlayer.courtId);
  const badge = id => {
    const player = state.players[id];
    if (!player) return null;
    return <div className={`player-badge ${id === playerData?.id ? 'is-me' : ''}`} key={id}><Avatar player={player} /><span>{player.name}{id === playerData?.id && <small>You</small>}</span></div>;
  };
  const renderCourt = court => <article className={`court-card ${court.type === 'Clay' ? 'clay' : ''}`} key={court.id}><header><div className="court-title"><span className="court-number">{String(court.number).padStart(2, '0')}</span><div><h3>Court {court.number}</h3><span className="court-type">{court.type} court</span></div></div>{court.id === courtInfo?.id && <span className="badge">Your court</span>}</header><TennisCourt type={court.type}>{['A', 'B'].map(side => <div className="court-side" key={side}><span className="side-label">SIDE {side}{court.id === courtInfo?.id && side === currentPlayer?.side ? ' · YOUR TEAM' : ''}</span>{court[`side${side}`].map(badge)}{!court[`side${side}`].length && <span className="empty-slot">Waiting for players</span>}</div>)}</TennisCourt></article>;

  return <div className="player-page"><header className="public-header"><Brand /><span className="player-header-note">See you on court.</span></header><main className={`player-main ${hasJoined ? 'player-joined' : ''}`}>
    <div className="player-club-heading"><span className="icon-tile"><Icon name="court" size={23} /></span><p className="eyebrow">YOUR CLUBHOUSE</p><h1>{state.clubName}</h1>{hasJoined ? <span className={roomReady ? 'connection-good' : 'connection-offline'} role="status"><span className="status-dot" />{roomReady ? 'You’re connected to the session' : 'Reconnecting to your session…'}</span> : <p className="muted">A good match starts with a hello.</p>}</div>
    {errorMsg && <div className="error-message" role="alert">{errorMsg}</div>}{removedMessage && <div className="notice" role="status">{removedMessage}</div>}
    {!hasJoined ? <section className="panel checkin-card">
      {(gpsFailed || approvalMessage) && !awaitingApproval ? <div className="approval-screen"><span className="icon-tile icon-tile-large"><Icon name={gpsFailed ? 'pin' : 'shield'} size={28} /></span><h2>A quick check with your club.</h2><p className="muted">{gpsFailed ? gpsDistance != null ? `You appear to be ${gpsDistance} km from the club. Check-in is available within 2 km.` : 'We couldn’t verify that you’re at the club.' : approvalMessage}</p><p className="muted">Ask a staff member to approve your entry.</p><div className="form-actions"><button className="btn btn-secondary" onClick={() => { setGpsFailed(false); setApprovalMessage(''); }}>Back</button><button className="btn btn-primary" onClick={handleRequestApproval} disabled={!roomReady}>Request approval<Icon name="arrow" /></button></div></div>
      : awaitingApproval ? <div className="approval-screen" role="status"><span className="icon-tile icon-tile-large"><Icon name="clock" size={28} /></span><h2>You’re on the list.</h2><p className="muted">Your request is with the club staff. Keep this page open; we’ll let you in as soon as they approve it.</p><span className="badge"><span className="status-dot" />Waiting for approval</span></div>
      : <><ol className="checkin-steps" aria-label="Check-in progress"><li className={!pinVerified ? 'current' : 'complete'} aria-current={!pinVerified ? 'step' : undefined}><span>{pinVerified ? <Icon name="check" size={14} /> : '1'}</span>Club PIN</li><li className={pinVerified ? 'current' : ''} aria-current={pinVerified ? 'step' : undefined}><span>2</span>Your details</li></ol>
        {!pinVerified ? <><h2>Welcome to the club.</h2><p className="muted">Enter the PIN shared by your organiser to join today’s session.</p><form className="form-stack" onSubmit={handleVerifyPin}><label>Club PIN<input type="text" className="form-control pin-input" value={pin} onChange={e => setPin(e.target.value)} inputMode="numeric" pattern="[0-9]{4,12}" maxLength={12} placeholder="Enter PIN" required autoComplete="off" /></label><button type="submit" className="btn btn-primary btn-block" disabled={isVerifying}>{isVerifying ? 'Checking…' : 'Continue'}<Icon name="arrow" /></button><button type="button" className="text-button" onClick={() => navigate('/')}>Find a different club</button></form><p className="checkin-note"><Icon name="shield" size={16} />Your club’s private session. No account needed.</p></>
        : <><h2>Let’s put a name to your game.</h2><p className="muted">A few details help your organiser find you a match.</p><form className="form-stack" onSubmit={handleJoin}>
          <label>Player name<input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="What should we call you?" maxLength={80} autoComplete="given-name" required /></label>
          <label>Tennis level<select className="form-control" value={level} onChange={e => setLevel(e.target.value)}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(l => <option key={l} value={l}>{l}{l === 1 ? ' — Best' : l === 10 ? ' — Beginner' : ''}</option>)}</select><span className="field-hint">1 is strongest, 10 is beginner. Only staff see your level.</span></label>
          <label>Gender <span className="label-optional">Optional · visible to staff</span><select className="form-control" value={gender} onChange={e => setGender(e.target.value)}><option value="Other">Prefer not to say / other</option><option value="M">Male</option><option value="F">Female</option></select></label>
          <div className="photo-field"><Avatar player={{ name, avatar: avatarPreview }} large /><label>Profile photo <span className="label-optional">Optional</span><input type="file" accept="image/png, image/jpeg, image/gif, image/webp" onChange={handleImageUpload} /><span className="field-hint">Choose an image up to 5 MB.</span></label></div>
          <div className="privacy-note"><p>Your name, photo and court assignment are shared with admitted players and club staff.</p><details><summary>How your details are used</summary><p>Staff can see your level and optional gender. Location checks proximity; exact coordinates are not saved. Archived player details and history are deleted after 90 days. Ask a club owner about earlier deletion.</p></details></div>
          <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setPinVerified(false)}><Icon name="back" />Back</button><button type="submit" className="btn btn-primary" disabled={isJoining || !roomReady}>{isJoining ? 'Joining…' : !roomReady ? 'Connecting…' : 'Join session'}<Icon name="arrow" /></button></div>
        </form></>}
      </>}
    </section> : <>
      {!roomReady && <p className="notice">Reconnecting… Court assignments may have changed. Please wait for live updates.</p>}
      <section className="player-welcome"><div className="section-heading"><Avatar player={currentPlayer || playerData} large /><div><p className="eyebrow">YOU’RE CHECKED IN</p><h2>Hello, {currentPlayer?.name || playerData?.name}.</h2></div></div><div className="player-assignment"><span className="assignment-icon"><Icon name={courtInfo ? 'court' : 'coffee'} size={28} /></span><div><h3>{courtInfo ? `Court ${courtInfo.number} · Side ${currentPlayer.side}` : currentPlayer?.available === false ? 'Enjoy a breather.' : 'Your next match is on its way.'}</h3><p>{courtInfo ? state.gameStarted ? 'The round is in play. Have a great match!' : 'You’re in the line-up. Wait for staff to start the round.' : currentPlayer?.available === false ? 'Ask a staff member when you’re ready to play again.' : 'Your organiser will assign your court. You can stay right here.'}</p></div></div></section>
      {courtInfo ? <section className="player-court-section"><div className="section-heading spread"><h2>Your match</h2><span className="badge">{state.gameStarted ? 'In play' : 'Getting ready'}</span></div>{renderCourt(courtInfo)}</section> : <section className="player-court-section"><div className="section-heading spread"><h2>On the sidelines</h2><span className="count-pill">{state.idleQueue.length}</span></div><div className="player-waiting-list">{state.idleQueue.map(badge)}{!state.idleQueue.length && <p className="muted">No players waiting.</p>}</div><h2 className="section-title">Around the courts</h2><div className="player-courts">{state.courts.map(renderCourt)}{!state.courts.length && <p className="muted">Staff are getting the courts ready.</p>}</div></section>}
      <MatchHistory matchHistory={state.matchHistory} players={state.players} /><div className="player-exit"><button className="btn btn-secondary" onClick={handleExit} disabled={state.gameStarted || !roomReady}><Icon name="logout" />Leave session</button><p className="field-hint">{state.gameStarted ? 'You can leave when the current round ends.' : 'Heading home? Let your organiser know by checking out.'}</p></div>
    </>}
    <p className="player-footer">Meet. Match. Play.</p></main></div>;
}

export default PlayerScreen;
