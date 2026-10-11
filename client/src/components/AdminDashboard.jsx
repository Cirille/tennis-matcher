import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import TennisCourt from './TennisCourt';
import MatchHistory from './MatchHistory';
import StaffPanel from './StaffPanel';
import AcceptAccount from './AcceptAccount';
import { connectToClub } from '../clubConnection';
import { sendAdminCommand } from '../adminCommand';
import { api } from '../api';
import { AuthLayout, Avatar, Brand, Icon } from './UI';

export default function AdminEntry() {
  const [setup] = useState(() => new URLSearchParams(window.location.hash.slice(1)).has('setup'));
  return setup ? <AcceptAccount /> : <AdminDashboard />;
}

function AdminDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem('admin_token') || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const commandLock = useRef(false);
  const selectionPanel = useRef(null);
  const [state, setState] = useState({ courts: [], players: {}, idleQueue: [], pendingApprovals: [], matchHistory: [] });
  const [nameDraft, setNameDraft] = useState(null);
  const [mapDraft, setMapDraft] = useState(null);
  const [pinDraft, setPinDraft] = useState('');
  const [tab, setTab] = useState('session');
  const [selected, setSelected] = useState('');
  const [destination, setDestination] = useState('idle');
  const [archives, setArchives] = useState([]);
  const [archive, setArchive] = useState(null);
  const [display, setDisplay] = useState(false);
  const owner = state.myRole === 'OWNER';
  const locked = !ready || busy;
  const assignmentsLocked = locked || state.gameStarted || state.status !== 'open';

  useEffect(() => {
    if (!selected || !selectionPanel.current) return;
    selectionPanel.current.focus({ preventScroll: true });
    selectionPanel.current.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [selected]);

  const clearLogin = useCallback(() => {
    localStorage.removeItem('admin_token'); localStorage.removeItem('admin_clubId');
    setToken(''); setReady(false); setPassword('');
  }, []);
  useEffect(() => {
    if (!token) return;
    const onError = message => { setError(message); if (message.includes('Unauthorized')) clearLogin(); };
    const onState = updated => setState(updated);
    socket.on('error', onError); socket.on('state_update', onState);
    const cleanup = connectToClub(socket, { clubId: localStorage.getItem('admin_clubId'), role: 'ADMIN', token }, {
      onJoined: () => { setReady(true); setError(''); }, onDisconnected: () => setReady(false), onError
    });
    return () => { cleanup(); socket.off('error', onError); socket.off('state_update', onState); };
  }, [token, clearLogin]);

  const login = async event => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api('/login', null, { method: 'POST', body: { email, password } });
      if (!['ADMIN', 'OWNER'].includes(result.role)) throw new Error('Use a club staff account.');
      localStorage.setItem('admin_token', result.token); localStorage.setItem('admin_clubId', result.clubId);
      setToken(result.token); setPassword(''); setError('');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  const logout = async () => {
    try { await api('/logout', token, { method: 'POST' }); clearLogin(); }
    catch (error) { if (error.status === 401) clearLogin(); else setError('Could not sign out on the server. Reconnect and try again.'); }
  };
  const command = async (action, value) => {
    if (!ready || commandLock.current) return false;
    commandLock.current = true; setBusy(true); setError('');
    try { await sendAdminCommand(socket, state, action, value); return true; }
    catch (error) { setError(error.message); return false; }
    finally { commandLock.current = false; setBusy(false); }
  };
  const loadArchives = async () => {
    try { setArchives((await api('/sessions', token)).sessions); setTab('history'); }
    catch (error) { setError(error.message); }
  };
  const move = async (playerId, target) => {
    const [courtId, side] = target.split(':');
    if (await command('admin_move_player', { playerId, destCourtId: courtId, destSide: side || null })) setSelected('');
  };
  const drop = (event, target) => { event.preventDefault(); const id = event.dataTransfer.getData('playerId'); if (id && !assignmentsLocked) move(id, target); };
  const playerCard = id => {
    const p = state.players[id]; if (!p) return null;
    return <div className={`player-card ${selected === id ? 'selected' : ''}`} key={id} draggable={!assignmentsLocked && !display}
      onDragStart={event => event.dataTransfer.setData('playerId', id)}>
      <button className="player-select" disabled={assignmentsLocked || display} onClick={() => { setSelected(id); setDestination(p.courtId ? `${p.courtId}:${p.side}` : 'idle'); }} aria-label={`Select ${p.name} to move`} aria-pressed={selected === id}>
        <Avatar player={p} /><span className="player-info"><strong>{p.name}</strong><small>{p.available === false ? 'Taking a break' : p.courtId ? `Level ${p.level}` : `Level ${p.level} · ${p.idle_rounds || 0} ${p.idle_rounds === 1 ? 'round' : 'rounds'} waiting`}{p.disconnected ? ' · Offline' : ''}</small></span><Icon name={p.available === false ? 'coffee' : 'chevron'} size={14} />
      </button>
    </div>;
  };
  if (!token) return <AuthLayout title="Welcome back." description="Sign in to bring your next club session to life.">
    <form className="form-stack" onSubmit={login}><label>Email<input className="form-control" type="email" autoComplete="username" placeholder="you@yourclub.com" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input className="form-control" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error-message" role="alert">{error}</p>}<button disabled={busy} className="btn btn-primary btn-block">{busy ? 'Signing in…' : 'Sign in'}<Icon name="arrow" /></button>
    </form><p className="auth-help"><Icon name="shield" /> Need access or a password reset? Ask a club owner for a private setup link.</p>
  </AuthLayout>;

  const people = Object.values(state.players);
  const onCourt = people.filter(p => p.courtId).length;
  const waiting = state.idleQueue.filter(id => state.players[id]?.available !== false).length;
  const roundNumber = state.matchHistory.length + 1;
  const clubId = localStorage.getItem('admin_clubId');
  const title = { session: 'Live session', history: 'Past sessions', settings: 'Club settings', staff: 'Staff & activity' }[tab];
  const sessionLabel = state.status === 'ended' ? 'Session ended' : state.gameStarted ? 'Round in play' : 'Between rounds';
  return <div className={`club-app ${display ? 'display-mode' : ''}`}>
    {!display && <aside className="app-sidebar"><Brand light /><div className="club-switcher"><span className="club-monogram">{state.clubName?.[0] || 'T'}</span><div><strong>{state.clubName || 'Connecting…'}</strong><small>Club {owner ? 'owner' : 'admin'}</small></div></div><p className="nav-caption">CLUBHOUSE</p>
      <nav className="app-nav" aria-label="Club management"><button aria-current={tab === 'session' ? 'page' : undefined} onClick={() => setTab('session')}><Icon name="court" />Live session<span className="nav-live-dot" /></button><button aria-current={tab === 'history' ? 'page' : undefined} onClick={loadArchives}><Icon name="clock" />Past sessions</button>
        {owner && <><button aria-current={tab === 'staff' ? 'page' : undefined} onClick={() => setTab('staff')}><Icon name="people" />Staff & activity</button><button aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><Icon name="settings" />Club settings</button></>}
      </nav><div className="sidebar-bottom"><div className="sidebar-note"><Icon name="court" size={30} /><p>Good matches.<br /><em>Even better company.</em></p></div><button className="sidebar-signout" onClick={logout}><Icon name="logout" />Sign out</button></div>
    </aside>}
    <main className="app-main" id="main-content"><header className="app-topbar"><span className="breadcrumb">Clubhouse <Icon name="chevron" size={13} /> <strong>{display ? 'Court display' : title}</strong></span><div className="toolbar"><span className={ready ? 'connection-good' : 'connection-offline'} role="status"><span className="status-dot" />{ready ? busy ? 'Saving…' : 'Live updates' : 'Reconnecting…'}</span><button className="btn btn-secondary btn-small" onClick={() => setDisplay(value => !value)}><Icon name="screen" />{display ? 'Exit display' : 'Court display'}</button></div></header>
    <div className="app-content"><div className="page-heading"><div><p className="eyebrow">{state.createdAt ? new Date(state.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : 'YOUR CLUBHOUSE'}</p><h1>{display ? state.clubName : title}</h1><p className="muted">{tab === 'session' || display ? 'A little organisation. A great day on court.' : tab === 'staff' ? 'A shared effort, with an account for everyone.' : tab === 'settings' ? 'Make your clubhouse feel like home.' : 'Every round, all in one place.'}</p></div>{(tab === 'session' || display) && <span className={`badge ${state.gameStarted ? 'badge-live' : ''}`}><span className="status-dot" />{sessionLabel}</span>}</div>
    {error && <p role="alert" className="error-message">{error}</p>}
    {!ready && <p className="notice">Changes are paused until your connection is restored.</p>}
    {!display && tab === 'staff' && owner && <StaffPanel token={token} onError={setError} />}
    {!display && tab === 'settings' && owner && <div className="settings-grid"><section className="panel settings-card"><span className="icon-tile"><Icon name="court" /></span><h2>Club details</h2><p className="muted">The name players see when they arrive.</p>
      <form className="form-stack" onSubmit={async e => { e.preventDefault(); if (await command('update_club_name', nameDraft ?? state.clubName)) setNameDraft(null); }}><label>Club name<input className="form-control" maxLength={120} required value={nameDraft ?? state.clubName ?? ''} onChange={e => setNameDraft(e.target.value)} /></label><button disabled={locked} className="btn btn-primary">Save name</button></form></section>
      <section className="panel settings-card"><span className="icon-tile"><Icon name="pin" /></span><h2>Club location</h2><p className="muted">Help verify that players are at the club.</p><form className="form-stack" onSubmit={async e => { e.preventDefault(); if (await command('update_club_location', mapDraft ?? state.clubMapUrl ?? '')) setMapDraft(null); }}><label>Google Maps link<input className="form-control" value={mapDraft ?? state.clubMapUrl ?? ''} onChange={e => setMapDraft(e.target.value)} placeholder="https://www.google.com/maps/@…" /></label><button disabled={locked} className="btn btn-primary">Save location</button></form><p className="field-hint">{state.clubLat != null ? 'Location verification is configured. Clear the link to remove it.' : 'No location set. PIN holders can check in unless approval is required.'}</p></section>
      <section className="panel settings-card"><span className="icon-tile"><Icon name="shield" /></span><h2>Player access</h2><p className="muted">Choose who can join your open session.</p><div className="setting-row"><span><strong>Staff approval</strong><small>Review each player before they join.</small></span><button disabled={locked || state.status !== 'open'} className={`toggle ${state.requireApproval ? 'is-on' : ''}`} role="switch" aria-checked={!!state.requireApproval} aria-label="Require staff approval" onClick={() => command('toggle_require_approval', !state.requireApproval)}><span /></button></div>
      <form className="form-stack" onSubmit={async e => { e.preventDefault(); if (await command('rotate_pin', pinDraft)) setPinDraft(''); }}><label>New player PIN<input className="form-control" inputMode="numeric" pattern="[0-9]{4,12}" type="password" required value={pinDraft} onChange={e => setPinDraft(e.target.value)} placeholder="4–12 digits" /></label><button disabled={locked} className="btn btn-primary">Change PIN</button></form><p className="field-hint">A new PIN clears pending applications. Waiting applicants verify again; admitted players keep their sessions.</p></section></div>}
    {!display && tab === 'history' && <section className="panel section-pad"><div className="section-heading spread"><h2>Session archive</h2><span className="count-pill">{archives.length}</span></div><div className="archive-list">{archives.map(item => <div className="archive-row" key={item.id}><span className="icon-tile"><Icon name="clock" /></span><div className="archive-info"><strong>{new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</strong><small>{new Date(item.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {item.status === 'ended' ? 'Completed session' : 'Current session'}</small></div>
      <div className="toolbar"><button className="btn btn-secondary btn-small" onClick={async () => { try { setArchive(await api(`/sessions/${item.id}`, token)); } catch (error) { setError(error.message); } }}>View rounds<Icon name="arrow" size={14} /></button>
      {owner && item.status === 'ended' && item.id !== state.sessionId && <button className="btn btn-danger btn-small" onClick={async () => { if (!window.confirm('Permanently delete this archived session and its player history?')) return; try { await api(`/sessions/${item.id}`, token, { method: 'DELETE' }); setArchive(null); await loadArchives(); } catch (error) { setError(error.message); } }}>Delete archive</button>}</div>
    </div>)}</div>{!archives.length && <p className="empty-state">Your sessions will appear here as you play.</p>}{archive && <MatchHistory matchHistory={archive.matchHistory} players={{}} />}</section>}
    {(display || tab === 'session') && <>
      {!display && <section className="session-banner"><div className="banner-copy"><p className="eyebrow">{state.status === 'ended' ? 'UNTIL NEXT TIME' : `ROUND ${String(roundNumber).padStart(2, '0')}`}</p><h2>{state.status === 'ended' ? 'That’s a wrap.' : state.gameStarted ? 'The courts are yours.' : 'Ready when you are.'}</h2><p>{state.status === 'ended' ? 'Your rounds are saved. Start fresh for your next club session.' : state.gameStarted ? 'Enjoy the game. End the round when everyone is ready to rotate.' : 'Arrange the pairings, make any adjustments, then start the round.'}</p><div className="toolbar">
        {state.status === 'ended' ? <button disabled={locked} className="btn btn-lime" onClick={() => command('new_session')}><Icon name="plus" />Start new session</button> : <><button disabled={assignmentsLocked} className="btn btn-banner-secondary" onClick={() => command('auto_matchmake')}><Icon name="shuffle" />Arrange matches</button><button disabled={locked} className="btn btn-lime" onClick={() => command('toggle_game', !state.gameStarted)}><Icon name={state.gameStarted ? 'stop' : 'play'} size={16} />{state.gameStarted ? 'End round' : 'Start round'}</button></>}
      </div></div><div className="banner-court" aria-hidden="true"><Icon name="court" size={220} /><span>{String(roundNumber).padStart(2, '0')}</span></div></section>}
      <section className="stats-strip" aria-label="Session overview">{[['people', people.length, 'Checked in', `${onCourt} on court`], ['court', state.courts.length, 'Courts', 'In this session'], ['coffee', waiting, 'Waiting to play', `${state.idleQueue.length - waiting} taking a break`], ['clock', state.matchHistory.length, 'Rounds completed', sessionLabel]].map(([icon, value, label, detail]) => <div className="stat" key={label}><div className="stat-top"><span>{label}</span><Icon name={icon} /></div><strong>{value.toString().padStart(2, '0')}</strong><small>{detail}</small></div>)}</section>
      {!display && <div className="session-utility"><div className="toolbar"><span className={`badge ${state.checkInOpen && state.status === 'open' ? 'badge-live' : ''}`}><span className="status-dot" />Check-in {state.checkInOpen && state.status === 'open' ? 'open' : 'closed'}</span><a className="text-link" href={`/${clubId}`} target="_blank" rel="noreferrer"><Icon name="link" size={15} />Player join page<Icon name="arrow" size={14} /></a></div>{state.status === 'open' && <div className="toolbar"><button disabled={locked} className="text-button" onClick={() => command('set_check_in', !state.checkInOpen)}>{state.checkInOpen ? 'Close check-in' : 'Open check-in'}</button><span className="utility-divider" /><button disabled={assignmentsLocked} className="text-button" onClick={() => { if (window.confirm('End this club session? Players will be signed out and the rounds will be archived.')) command('end_session'); }}>End session</button></div>}</div>}
      {!display && selected && state.players[selected] && <section className="selection-panel" aria-label="Selected player" ref={selectionPanel} tabIndex={-1}><div className="selection-title"><Avatar player={state.players[selected]} /><div><small>SELECTED PLAYER</small><strong>{state.players[selected].name}</strong></div><button className="icon-button" aria-label="Cancel selection" onClick={() => setSelected('')}><Icon name="close" /></button></div><div className="toolbar"><label>Move to<select className="form-control" value={destination} onChange={e => setDestination(e.target.value)}><option value="idle">Waiting list</option>{state.courts.flatMap(c => ['A', 'B'].map(side => <option key={`${c.id}:${side}`} value={`${c.id}:${side}`}>Court {c.number} · Side {side}</option>))}</select></label><button disabled={assignmentsLocked} className="btn btn-primary" onClick={() => move(selected, destination)}>Move player<Icon name="arrow" /></button><button disabled={assignmentsLocked} className="btn btn-secondary" onClick={() => command('set_player_available', { playerId: selected, available: state.players[selected].available === false })}><Icon name="coffee" />{state.players[selected].available === false ? 'Make available' : 'Take a break'}</button><button disabled={assignmentsLocked} className="btn btn-danger" onClick={async () => { if (await command('admin_remove_player', { playerId: selected })) setSelected(''); }}>Remove player</button></div></section>}
      <div className="session-layout"><section className="courts-panel"><div className="section-heading spread"><div><h2>Your courts <span className="count-pill">{state.courts.length}</span></h2>{!display && <p className="muted">{state.gameStarted ? 'Assignments are locked while the round is in play.' : 'Select a player to move them. Drag and drop works too.'}</p>}</div>{!display && <details className="action-menu"><summary className="btn btn-secondary btn-small"><Icon name="plus" />Add court</summary><div className="action-menu-items"><button disabled={assignmentsLocked} onClick={e => { command('add_court', { type: 'Hard' }); e.currentTarget.closest('details').open = false; }}>Hard court</button><button disabled={assignmentsLocked} onClick={e => { command('add_court', { type: 'Clay' }); e.currentTarget.closest('details').open = false; }}>Clay court</button></div></details>}</div>
        <div className="court-grid">{state.courts.map(court => <article className={`court-card ${court.type === 'Clay' ? 'clay' : ''}`} key={court.id}><header><div className="court-title"><span className="court-number">{String(court.number).padStart(2, '0')}</span><div><h3>Court {court.number}</h3><span className="court-type">{court.type} court</span></div></div>{!display && <button disabled={assignmentsLocked} className="icon-button" title={`Remove court ${court.number}`} aria-label={`Remove court ${court.number}`} onClick={() => command('remove_court', { courtId: court.id })}><Icon name="close" size={16} /></button>}</header><TennisCourt type={court.type}>
          {['A', 'B'].map(side => <div className="court-side" key={side} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, `${court.id}:${side}`)}><span className="side-label">SIDE {side}</span>{court[`side${side}`].map(playerCard)}{Array.from({ length: Math.max(0, 2 - court[`side${side}`].length) }, (_, index) => <span className="empty-slot" key={index}><Icon name="plus" size={14} />Open spot</span>)}</div>)}
        </TennisCourt><footer className="court-footer"><span><span className="status-dot" />{state.gameStarted ? 'In play' : state.status === 'ended' ? 'Session ended' : court.sideA.length > 0 && court.sideA.length === court.sideB.length ? 'Ready to play' : 'Waiting for players'}</span><span>{court.sideA.length + court.sideB.length} / 4 players</span></footer></article>)}</div>{!state.courts.length && <div className="panel empty-state"><Icon name="court" size={38} /><h3>A blank court, a fresh start.</h3><p>Add a court, check in your players, then arrange your first round.</p></div>}
      </section><aside className="session-sidebar">
        {!display && state.pendingApprovals.length > 0 && <section className="panel queue-panel approvals-panel"><div className="section-heading spread"><h2>Join requests</h2><span className="count-pill">{state.pendingApprovals.length}</span></div>{state.pendingApprovals.map(request => <div className="approval-card" key={request.id}><div className="section-heading"><Avatar player={request} /><div><strong>{request.name}</strong><small>Level {request.level}{request.distance != null ? ` · ${request.distance} km away` : ''}</small></div></div><div className="toolbar"><button disabled={locked} className="btn btn-primary btn-small" onClick={() => command('admin_approve_player', { requestId: request.id })}><Icon name="check" size={15} />Approve</button><button disabled={locked} className="btn btn-secondary btn-small" onClick={() => command('admin_deny_player', { requestId: request.id })}>Decline</button></div></div>)}</section>}
        <section className="panel queue-panel" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, 'idle')}><div className="section-heading spread"><h2>On the sidelines</h2><span className="count-pill">{state.idleQueue.length}</span></div><p className="muted">A breather before the next match.</p><div className="queue-list">{state.idleQueue.map(playerCard)}{!state.idleQueue.length && <div className="queue-empty"><Icon name="coffee" size={28} /><p>No players waiting.</p></div>}</div>{!display && <p className="queue-tip"><Icon name="people" size={16} />Players waiting longer get priority in the next arrangement.</p>}</section>
      </aside></div><MatchHistory matchHistory={state.matchHistory} players={state.players} />
    </>}
    <footer className="app-footer"><span>Tennis Matcher</span><span>Made for the love of the game.</span></footer></div></main>
  </div>;
}
