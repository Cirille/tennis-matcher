import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import TennisCourt from './TennisCourt';

function AdminDashboard() {
  const navigate = useNavigate();
  const [state, setState] = useState({
    clubName: '',
    courts: [],
    idleQueue: [],
    players: {},
    isLocked: false
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

  const handleToggleLock = () => {
    socket.emit('toggle_lock', !state.isLocked);
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
  const renderPlayer = (id, sourceCourtId, sourceSide) => {
    const p = state.players[id];
    if (!p) return null;
    return (
      <div 
        key={p.id} 
        draggable
        onDragStart={(e) => onDragStart(e, p.id, sourceCourtId, sourceSide)}
        style={{ 
          background: 'rgba(0,0,0,0.5)', 
          padding: '8px', 
          borderRadius: '8px',
          marginBottom: '8px',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          color: '#fff'
        }}
      >
        <img src={p.avatar} alt="avatar" width="30" height="30" style={{borderRadius: '50%'}} />
        <div style={{ flex: 1, textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
          <div style={{fontWeight: 'bold', fontSize: '0.9rem'}}>{p.name} ({p.gender})</div>
          <div style={{fontSize: '0.8rem', color: 'var(--accent-tennis)'}}>Level: {p.level} | Idle: {p.idle_rounds}</div>
        </div>
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
          <input 
            type="text" 
            className="form-control mt-4" 
            value={state.clubName} 
            onChange={handleUpdateClubName} 
            style={{ width: '250px', textAlign: 'center', display: 'inline-block' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-primary" onClick={handleAutoMatchmake}>Auto Matchmake</button>
          <button className={state.isLocked ? "btn btn-danger" : "btn btn-secondary"} onClick={handleToggleLock}>
            {state.isLocked ? '🔒 Unlock Matches' : '🔓 Lock Matches'}
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
                  flex: '1 1 300px', 
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
                  <div 
                    style={{ flex: 1, padding: '15px' }}
                    onDragOver={onDragOver}
                    onDrop={(e) => onDrop(e, court.id, 'A')}
                  >
                    <div style={{ textAlign: 'center', marginBottom: '10px', color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.9)', fontWeight: 'bold' }}>Side A</div>
                    {court.sideA.map(id => renderPlayer(id, court.id, 'A'))}
                  </div>
                  <div 
                    style={{ flex: 1, padding: '15px' }}
                    onDragOver={onDragOver}
                    onDrop={(e) => onDrop(e, court.id, 'B')}
                  >
                    <div style={{ textAlign: 'center', marginBottom: '10px', color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.9)', fontWeight: 'bold' }}>Side B</div>
                    {court.sideB.map(id => renderPlayer(id, court.id, 'B'))}
                  </div>
                </TennisCourt>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
