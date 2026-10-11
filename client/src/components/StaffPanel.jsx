import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Avatar, Icon } from './UI';

export default function StaffPanel({ token, onError }) {
  const [staff, setStaff] = useState([]);
  const [entries, setEntries] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [people, audit] = await Promise.all([api('/staff', token), api('/audit', token)]);
    setStaff(people.staff); setEntries(audit.entries);
  }, [token]);
  useEffect(() => { let active = true; refresh().catch(error => { if (active) onError(error.message); }); return () => { active = false; }; }, [refresh, onError]);
  const run = async fn => {
    setBusy(true);
    try { await fn(); await refresh(); } catch (error) { onError(error.message); } finally { setBusy(false); }
  };
  const showLink = result => setLink({ url: `${window.location.origin}/admin#setup=${result.token}`, expiresAt: result.expiresAt });
  const invite = event => {
    event.preventDefault();
    run(async () => { showLink(await api('/staff/invite', token, { method: 'POST', body: { email, role } })); setEmail(''); });
  };
  return <div className="staff-layout"><section className="panel section-pad"><div className="section-heading"><span className="icon-tile"><Icon name="people" /></span><div><h2>Your club team</h2><p className="muted">Individual accounts. One shared clubhouse.</p></div></div>
    <form className="invite-form" onSubmit={invite}><label>Email<input className="form-control" type="email" placeholder="teammate@yourclub.com" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Role<select className="form-control" value={role} onChange={e => setRole(e.target.value)}><option value="ADMIN">Admin</option><option value="OWNER">Owner</option></select></label><button disabled={busy} className="btn btn-primary"><Icon name="plus" />Create invitation</button></form>
    {link && <div className="notice" role="status"><strong>A place on your team.</strong><p>Share this private, single-use link with that staff member. It expires {new Date(link.expiresAt).toLocaleString()}.</p><input aria-label="Private account setup link" readOnly className="form-control" value={link.url} onFocus={e => e.target.select()} /><button className="btn btn-secondary btn-small" onClick={() => setLink(null)}>Hide link</button></div>}
    <div className="staff-list">{staff.map(person => <article className="staff-row" key={person.id}><Avatar player={{ name: person.email }} /><div className="staff-person"><strong>{person.email}</strong><span><span className="role-label">{person.role.toLowerCase()}</span><span className={`staff-status ${person.active ? 'active' : ''}`}><span className="status-dot" />{person.active ? 'Active' : 'Inactive / invited'}</span></span></div><details className="action-menu"><summary className="btn btn-secondary btn-small" aria-label={`Manage ${person.email}`}>Manage<Icon name="settings" size={15} /></summary><div className="action-menu-items"><button disabled={busy} onClick={() => run(async () => showLink(await api(`/staff/${person.id}/reset-link`, token, { method: 'POST' })))}>Reset / invite link</button>{person.active === 1 && <><button disabled={busy} onClick={() => run(() => api(`/staff/${person.id}`, token, { method: 'PATCH', body: { role: person.role === 'OWNER' ? 'ADMIN' : 'OWNER', active: true } }))}>Make {person.role === 'OWNER' ? 'admin' : 'owner'}</button><button disabled={busy} className="danger-text" onClick={() => run(() => api(`/staff/${person.id}`, token, { method: 'PATCH', body: { role: person.role, active: false } }))}>Deactivate</button></>}{!person.active && <button disabled={busy} onClick={() => run(() => api(`/staff/${person.id}`, token, { method: 'PATCH', body: { role: person.role, active: false } }))}>Revoke invitation</button>}</div></details></article>)}</div>
    <div className="staff-roles"><div><Icon name="shield" /><strong>Owners</strong><p>Manage staff, club settings, and sessions.</p></div><div><Icon name="court" /><strong>Admins</strong><p>Manage check-in, courts, and sessions.</p></div></div>
  </section><section className="panel section-pad activity-panel"><div className="section-heading"><span className="icon-tile"><Icon name="clock" /></span><div><h2>Recent activity</h2><p className="muted">Keep up with your team.</p></div></div><ol className="audit-list">{entries.map(entry => <li key={entry.id}><span className="activity-dot" /><div><strong>{entry.action.replaceAll('_', ' ')}</strong><p>{entry.actor || 'Former staff'}</p><time>{new Date(entry.createdAt).toLocaleString()}</time></div></li>)}</ol>{!entries.length && <p className="empty-state">Club activity will appear here.</p>}</section></div>;
}
