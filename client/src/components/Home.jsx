import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';

function Home() {
  const navigate = useNavigate();
  const [clubName, setClubName] = useState('My Tennis Club');

  useEffect(() => {
    const onStateUpdate = (state) => {
      setClubName(state.clubName);
    };
    
    socket.on('state_update', onStateUpdate);
    return () => {
      socket.off('state_update', onStateUpdate);
    };
  }, []);

  return (
    <div className="container animate-fade-in">
      <div className="text-center mb-4">
        <h1>🎾 {clubName} Matcher</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Join a session or manage the courts</p>
      </div>
      
      <div className="flex justify-between gap-4" style={{ maxWidth: '600px', margin: '0 auto', flexWrap: 'wrap' }}>
        <div className="glass-panel text-center" style={{ flex: '1 1 250px' }}>
          <h3>Player</h3>
          <p className="mb-4" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Find your next match and get assigned to a court.</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/player')}>
            Join Session
          </button>
        </div>

        <div className="glass-panel text-center" style={{ flex: '1 1 250px' }}>
          <h3>Admin</h3>
          <p className="mb-4" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Manage courts, trigger matchmaking, and organize players.</p>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => navigate('/admin')}>
            Manage Courts
          </button>
        </div>
      </div>
    </div>
  );
}

export default Home;
