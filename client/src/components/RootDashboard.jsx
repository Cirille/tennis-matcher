import React, { useState, useEffect, useCallback } from 'react';

import { API_URL, api } from '../api';
import { AuthLayout, Brand, Icon } from './UI';

function RootDashboard() {
  const [token, setToken] = useState(localStorage.getItem('root_token') || '');
  const [clubs, setClubs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [recoveryLink, setRecoveryLink] = useState('');
  
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

  const fetchClubs = useCallback(async (signal) => {
    const res = await fetch(`${API_URL}/api/root/clubs`, {
      headers: { 'Authorization': `Bearer ${token}` }, signal
    });
    if (res.ok) return res.json();
    const error = new Error('Could not load clubs.');
    error.status = res.status;
    throw error;
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetchClubs(controller.signal).then(setClubs).catch(error => {
      if (controller.signal.aborted) return;
      if (error.status === 401 || error.status === 403) {
        localStorage.removeItem('root_token');
        setToken('');
      } else setErrorMsg(error.message);
    });
    return () => controller.abort();
  }, [token, fetchClubs]);

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
    } catch {
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
        setClubs(await fetchClubs());
      } else {
        setErrorMsg(data.error || 'Failed to create club');
      }
    } catch {
      setErrorMsg('Create club request failed.');
    }
    setIsCreating(false);
  };

  const handleLogout = async () => {
    try {
      await api('/logout', token, { method: 'POST' });
      localStorage.removeItem('root_token'); setToken(''); setRecoveryLink('');
    } catch (error) { setErrorMsg(error.message); }
  };

  if (!token) return <AuthLayout eyebrow="PLATFORM ACCESS" title="The bigger picture." description="Sign in to manage the clubs on Tennis Matcher."><form className="form-stack" onSubmit={handleLogin}><label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="form-control" required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="form-control" required /></label>{errorMsg && <p role="alert" className="error-message">{errorMsg}</p>}<button className="btn btn-primary btn-block" type="submit">Sign in<Icon name="arrow" /></button></form><p className="auth-help"><Icon name="shield" />Platform operators only. Club staff sign in through the clubhouse.</p><a className="text-link" href="/admin">Club staff sign in<Icon name="arrow" /></a></AuthLayout>;
  return <div className="operator-page"><header className="public-header"><Brand /><button onClick={handleLogout} className="btn btn-secondary"><Icon name="logout" />Sign out</button></header><main className="operator-main"><div className="page-heading"><div><p className="eyebrow">PLATFORM OVERVIEW</p><h1>Clubs, in good company.</h1><p className="muted">Create a clubhouse and give its team a place to start.</p></div><span className="badge">{clubs.length} clubs</span></div>{errorMsg && <p role="alert" className="error-message">{errorMsg}</p>}
    <div className="operator-grid"><section className="panel section-pad"><h2>Create a club</h2><p className="muted">Add the club and its first owner. They can invite the rest of their team.</p><form className="form-stack" onSubmit={handleCreateClub}><label>Club ID<input type="text" value={newClubId} onChange={e => setNewClubId(e.target.value)} className="form-control" required placeholder="e.g. riverside-tennis" autoCapitalize="none" /><span className="field-hint">Used in the club’s join link.</span></label><label>Club name<input type="text" value={newClubName} onChange={e => setNewClubName(e.target.value)} className="form-control" required placeholder="e.g. Riverside Tennis Club" /></label><label>Player PIN<input type="text" inputMode="numeric" pattern="[0-9]{4,12}" value={newPin} onChange={e => setNewPin(e.target.value)} className="form-control" required placeholder="4–12 digits" /></label><div className="form-divider"><span>FIRST CLUB OWNER</span></div><label>Owner email<input type="email" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="form-control" required /></label><label>Owner password<input type="password" autoComplete="new-password" minLength={12} value={newAdminPassword} onChange={e => setNewAdminPassword(e.target.value)} className="form-control" required /><span className="field-hint">At least 12 characters.</span></label><button type="submit" className="btn btn-primary btn-block" disabled={isCreating}>{isCreating ? 'Creating…' : 'Create club'}<Icon name="plus" /></button></form></section>
    <section className="panel section-pad"><div className="section-heading spread"><h2>Your clubs</h2><span className="count-pill">{clubs.length}</span></div>{recoveryLink && <div className="notice"><p>Share this private, single-use recovery link with the club owner. It expires in 24 hours.</p><input aria-label="Owner recovery link" className="form-control" readOnly value={recoveryLink} onFocus={e => e.target.select()} /><button className="btn btn-secondary btn-small" onClick={() => setRecoveryLink('')}>Hide link</button></div>}
    <div className="operator-clubs">{!clubs.length ? <div className="empty-state"><Icon name="court" size={32} /><h3>The first club starts here.</h3><p>Create a club to get things going.</p></div> : clubs.map(c => <article className="operator-club" key={c.id}><div className="section-heading"><span className="icon-tile"><Icon name="court" /></span><div><h3>{c.name}</h3><a href={`/${c.id}`} className="text-link">/{c.id}</a></div></div><div className="toolbar spread"><span className="badge">Join PIN: {c.pin}</span><button className="btn btn-secondary btn-small" onClick={async () => { try { const result = await api(`/root/clubs/${c.id}/recovery-link`, token, { method: 'POST' }); setRecoveryLink(`${window.location.origin}/admin#setup=${result.token}`); } catch (error) { setErrorMsg(error.message); } }}><Icon name="shield" size={15} />Owner recovery link</button></div></article>)}</div></section></div>
  </main></div>;
}
export default RootDashboard;
