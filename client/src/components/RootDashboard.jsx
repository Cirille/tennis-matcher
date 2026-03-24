import React, { useState, useEffect } from 'react';

function RootDashboard() {
  const [token, setToken] = useState(localStorage.getItem('root_token') || '');
  const [clubs, setClubs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Login Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Create Club Form State
  const [isCreating, setIsCreating] = useState(false);
  const [newClubId, setNewClubId] = useState('');
  const [newClubName, setNewClubName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const API_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

  useEffect(() => {
    if (token) fetchClubs();
  }, [token]);

  const fetchClubs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/root/clubs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClubs(data);
      } else {
        localStorage.removeItem('root_token');
        setToken('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.role === 'ROOT') {
        localStorage.setItem('root_token', data.token);
        setToken(data.token);
        setErrorMsg('');
      } else {
        setErrorMsg(data.error || 'Access denied. Root only.');
      }
    } catch (e) {
      setErrorMsg('Login request failed.');
    }
  };

  const handleCreateClub = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/root/clubs`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          clubId: newClubId,
          clubName: newClubName,
          pin: newPin,
          adminEmail: newAdminEmail,
          adminPassword: newAdminPassword
        })
      });
      const data = await res.json();
      if (res.ok) {
        setNewClubId(''); setNewClubName(''); setNewPin(''); setNewAdminEmail(''); setNewAdminPassword('');
        setErrorMsg('');
        fetchClubs();
      } else {
        setErrorMsg(data.error || 'Failed to create club');
      }
    } catch (e) {
      setErrorMsg('Create club request failed.');
    }
    setIsCreating(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('root_token');
    setToken('');
  };

  if (!token) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <h2>Root Admin Login</h2>
          {errorMsg && <p style={{ color: 'var(--danger)', marginTop: '10px' }}>{errorMsg}</p>}
          <form onSubmit={handleLogin} style={{ marginTop: '20px', textAlign: 'left' }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="form-control" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="form-control" required />
            </div>
            <button type="submit" className="btn btn-primary mt-4" style={{width: '100%'}}>Login</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--accent-tennis)' }}>Super Admin (Root) Dashboard</h1>
        <button onClick={handleLogout} className="btn btn-secondary">Logout</button>
      </div>
      
      {errorMsg && <div className="mb-4" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '10px', borderRadius: '8px' }}>{errorMsg}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
        
        {/* Create Form */}
        <div className="glass-panel" style={{ flex: '1 1 400px' }}>
          <h3>Create New Tennis Club</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Registers a new database tenant and isolated socket room.</p>
          <form onSubmit={handleCreateClub} style={{ textAlign: 'left' }}>
            <div className="form-group">
              <label className="form-label">Club Identifier Slug (e.g. ny-tennis)</label>
              <input type="text" value={newClubId} onChange={e=>setNewClubId(e.target.value)} className="form-control" required placeholder="Used in the URL" />
            </div>
            <div className="form-group">
              <label className="form-label">Public Club Name</label>
              <input type="text" value={newClubName} onChange={e=>setNewClubName(e.target.value)} className="form-control" required placeholder="e.g. New York Tennis Matcher" />
            </div>
            <div className="form-group">
              <label className="form-label">Player Join PIN (e.g. 1234)</label>
              <input type="text" value={newPin} onChange={e=>setNewPin(e.target.value)} className="form-control" required placeholder="Used by players to join via URL" />
            </div>
            <hr style={{ margin: '1rem 0', borderColor: 'rgba(255,255,255,0.1)' }} />
            <div className="form-group">
              <label className="form-label">Admin Login Email</label>
              <input type="email" value={newAdminEmail} onChange={e=>setNewAdminEmail(e.target.value)} className="form-control" required placeholder="manager@nytennis.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Admin Login Password</label>
              <input type="text" value={newAdminPassword} onChange={e=>setNewAdminPassword(e.target.value)} className="form-control" required />
            </div>
            <button type="submit" className="btn btn-primary mt-2" style={{width: '100%'}} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Deploy New Club'}
            </button>
          </form>
        </div>

        {/* Existing Clubs */}
        <div className="glass-panel" style={{ flex: '2 1 500px' }}>
          <h3>Active Hosted Clubs ({clubs.length})</h3>
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {clubs.length === 0 ? <p>No clubs provisioned.</p> : clubs.map(c => (
              <div key={c.id} style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <h4 style={{ color: 'var(--accent-tennis)', margin: 0 }}>{c.name}</h4>
                <div style={{ marginTop: '5px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  <strong>URL:</strong> /{c.id} <br/>
                  <strong>Join PIN:</strong> {c.pin}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default RootDashboard;
