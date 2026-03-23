import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import TennisCourt from './TennisCourt';
import MatchHistory from './MatchHistory';

function AdminDashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState({
    clubName: '',
    courts: [],
    idleQueue: [],
    players: {},
    gameStarted: false,
    clubMapUrl: '',
    clubLat: null,
    clubLng: null
  });

  useEffect(() => {
    socket.on('state_update', setState);
    return () => socket.off('state_update', setState);
  }, []);

  const handleUpdateClubName = (e) => {
    socket.emit('update_club_name', e.target.value);
  };

  const handleAddCourt = (type) => {
    const newCourt = {
      id: `court-${Date.now()}`,
      number: state.courts.length + 1,
      type: type, // 'Hard' or 'Clay'
      sideA: [],
      sideB: []
    };
    socket.emit('update_courts', [...state.courts, newCourt]);
  };

  const handleRemoveCourt = (id) => {
    socket.emit('update_courts', state.courts.filter(c => c.id !== id));
  };

  const handleAutoMatchmake = () => {
    socket.emit('auto_matchmake');
  };

  const handleToggleGame = () => {
    socket.emit('toggle_game', !state.gameStarted);
  };

  // Drag & Drop Handlers
  const onDragStart = (e, playerId, sourceCourtId, sourceSide) => {
    e.dataTransfer.setData('playerId', playerId);
    e.dataTransfer.setData('sourceCourtId', sourceCourtId);
    e.dataTransfer.setData('sourceSide', sourceSide);
  };

  const onDragOver = (e) => {
    e.preventDefault(); // allow drop
  };

  const onDrop = (e, destCourtId, destSide) => {
    e.preventDefault();
    const playerId = e.dataTransfer.getData('playerId');
    const sourceCourtId = e.dataTransfer.getData('sourceCourtId');
    const sourceSide = e.dataTransfer.getData('sourceSide');

    if (playerId) {
      socket.emit('admin_move_player', {
        playerId,
        sourceCourtId,
        sourceSide,
        destCourtId,
        destSide
      });
    }
  };

  // Render player card
  const renderPlayer = (id, sourceCourtId, sourceSide, isCourtSlot = false) => {
    const p = state.players[id];
    if (!p) return null;
    return (
      <div 
        key={p.id} 
        draggable
        onDragStart={(e) => onDragStart(e, p.id, sourceCourtId, sourceSide)}
        style={{ 
          background: p.disconnected ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.5)', 
          opacity: p.disconnected ? 0.6 : 1,
          padding: '8px', 
          borderRadius: '8px',
          marginBottom: isCourtSlot ? '0' : '8px',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          color: '#fff',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <img src={p.avatar} alt="avatar" width="30" height="30" style={{borderRadius: '50%', minWidth: '30px', minHeight: '30px', flexShrink: 0, objectFit: 'cover', filter: p.disconnected ? 'grayscale(100%)' : 'none'}} />
        <div style={{ flex: 1, textShadow: '1px 1px 2px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
          <div style={{fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden'}}>
            {p.name} ({p.gender}){p.disconnected && <span style={{color: '#ff4444', fontSize: '0.75rem', fontWeight: 'bold'}}> [Offline]</span>}
          </div>
          <div style={{fontSize: '0.75rem', color: 'var(--accent-tennis)'}}>Level: {p.level} | Idle: {p.idle_rounds}</div>
        </div>
      </div>
    );
  };

  const renderCourtSlot = (courtId, side, slotIndex, playersArray) => {
    const playerId = playersArray[slotIndex];
    const isDroppable = !playerId;

    return (
      <div 
        style={{ 
          flex: 1, 
          border: isDroppable ? '2px dashed rgba(255,255,255,0.4)' : 'none', 
          borderRadius: '8px', 
          margin: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDroppable ? 'rgba(0,0,0,0.2)' : 'transparent',
          minHeight: '60px',
          padding: isDroppable ? '4px' : '0',
          width: '100%',
          boxSizing: 'border-box'
        }}
        onDragOver={isDroppable ? onDragOver : undefined}
        onDrop={(e) => {
          if (isDroppable) onDrop(e, courtId, side);
        }}
      >
        {playerId ? (
           renderPlayer(playerId, courtId, side, true)
        ) : (
           <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem', fontWeight: 'bold' }}>Drop Here</span>
        )}
      </div>
    );
  };

  return (
    <div className="container animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '1rem', maxWidth: 'none' }}>
      <div className="glass-panel text-center mb-4" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>Home</button>
        </div>
        <div>
          <h2 style={{margin: 0}}>Admin Dashboard</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '1rem', alignItems: 'center' }}>
            <input 
              type="text" 
              className="form-control" 
              value={state.clubName} 
              onChange={handleUpdateClubName} 
              placeholder="Club Name"
              style={{ width: '250px', textAlign: 'center' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative' }}>
              <input 
                type="text" 
                className="form-control" 
                value={state.clubMapUrl || ''} 
                onChange={(e) => socket.emit('update_club_location', e.target.value)} 
                placeholder="Google Maps Link (optional)"
                style={{ width: '250px', textAlign: 'center', borderColor: (state.clubLat && state.clubLng) ? 'var(--accent-tennis)' : 'inherit' }}
                title="Paste a Google Maps link to enforce that players must be physically near the club to join."
              />
              {(state.clubLat && state.clubLng) && (
                <span style={{ color: 'var(--accent-tennis)', fontSize: '1.2rem', position: 'absolute', right: '-30px' }} title={`GPS Set: ${state.clubLat.toFixed(4)}, ${state.clubLng.toFixed(4)}`}>
                  ✓
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-primary" onClick={handleAutoMatchmake}>Auto Matchmake</button>
          <button className={state.gameStarted ? "btn btn-danger" : "btn btn-success"} onClick={handleToggleGame}>
            {state.gameStarted ? '⏹ End Game' : '▶ Start Game'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar: Idle Queue */}
        <div 
          className="glass-panel" 
          style={{ width: '300px', display: 'flex', flexDirection: 'column', padding: '1rem' }}
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, 'idle', null)}
        >
          <h3>Idle Queue ({state.idleQueue.length})</h3>
          <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem'}}>
            Drag players here to remove from courts.
          </p>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {state.idleQueue.map(id => renderPlayer(id, 'idle', null))}
          </div>
        </div>

        {/* Main: Courts */}
        <div className="glass-panel" style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3>Courts ({state.courts.length})</h3>
            <div>
              <button className="btn btn-secondary" style={{ marginRight: '10px' }} onClick={() => handleAddCourt('Hard')}>+ Add Hard Court</button>
              <button className="btn btn-secondary" onClick={() => handleAddCourt('Clay')}>+ Add Clay Court</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            {state.courts.map(court => (
              <div 
                key={court.id} 
                style={{ 
                  flex: '0 0 320px', 
                  width: '320px',
                  border: `2px solid ${court.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)'}`,
                  borderRadius: '12px',
                  background: 'rgba(0,0,0,0.3)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div style={{ 
                  background: court.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)',
                  padding: '8px',
                  textAlign: 'center',
                  fontWeight: 'bold',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}>
                  <span>Court {court.number} ({court.type})</span>
                  <button style={{background: 'none', border:'none', color:'white', cursor:'pointer', fontSize: '1.2rem'}} onClick={() => handleRemoveCourt(court.id)}>×</button>
                </div>
                
                <TennisCourt type={court.type}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 10px 20px 24px', alignItems: 'stretch', justifyContent: 'center', gap: '8px' }}>
                    {renderCourtSlot(court.id, 'A', 0, court.sideA)}
                    {renderCourtSlot(court.id, 'A', 1, court.sideA)}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px 20px 10px', alignItems: 'stretch', justifyContent: 'center', gap: '8px' }}>
                    {renderCourtSlot(court.id, 'B', 0, court.sideB)}
                    {renderCourtSlot(court.id, 'B', 1, court.sideB)}
                  </div>
                </TennisCourt>
              </div>
            ))}
          </div>

          <MatchHistory matchHistory={state.matchHistory} players={state.players} />
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
