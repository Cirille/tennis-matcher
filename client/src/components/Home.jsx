import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function Home() {
  const navigate = useNavigate();
  const [clubSlug, setClubSlug] = useState('');

  const handleJoin = (e) => {
    e.preventDefault();
    if (clubSlug.trim()) {
      navigate(`/${clubSlug.trim().toLowerCase()}`);
    }
  };

  return (
    <div className="container animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center' }}>
      <div className="text-center mb-4">
        <h1>🎾 Tennis Matcher Platform</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Welcome to the world's best Multi-Tenant Matchmaking service.</p>
      </div>
      
      <div className="glass-panel text-center" style={{ width: '100%', maxWidth: '400px', marginBottom: '20px' }}>
        <h3>Player Access</h3>
        <p className="mb-4" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Enter your Club ID to join your private session.</p>
        <form onSubmit={handleJoin}>
          <input 
            type="text" 
            className="form-control mb-4" 
            placeholder="e.g. demo-club" 
            value={clubSlug}
            onChange={(e) => setClubSlug(e.target.value)}
            required
          />
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>
            Go to Club Room
          </button>
        </form>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/admin')} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
          Admin Login
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/root')} style={{ padding: '8px 16px', fontSize: '0.9rem', background: 'transparent', border: '1px solid var(--accent-tennis)' }}>
          Super Manager (Root)
        </button>
      </div>
    </div>
  );
}

export default Home;
