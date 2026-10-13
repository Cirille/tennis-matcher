import { useState } from 'react';
import { api } from '../api';
import { AuthLayout, Icon } from './UI';

export default function AcceptAccount() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('setup'));
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async event => {
    event.preventDefault();
    if (password !== repeat) return setMessage('Passwords do not match.');
    setBusy(true);
    try {
      await api('/account/accept', null, { method: 'POST', body: { token, password } });
      window.history.replaceState(null, '', '/admin'); setDone(true); setPassword(''); setRepeat('');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return <AuthLayout eyebrow="YOUR CLUB ACCOUNT" title={done ? 'You’re all set.' : 'Make yourself at home.'} description={done ? 'Your password is saved. Your club is waiting.' : 'Set a password to start managing your club.'}>
    {done ? <a className="btn btn-primary btn-block" href="/admin">Sign in<Icon name="arrow" /></a> : <form className="form-stack" onSubmit={submit}>
      <label>New password<input className="form-control" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /><span className="field-hint">At least 12 characters.</span></label>
      <label>Repeat password<input className="form-control" type="password" autoComplete="new-password" required value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
      {message && <p className="error-message" role="alert">{message}</p>}<button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}<Icon name="arrow" /></button><p className="auth-help"><Icon name="shield" />This private setup link can only be used once.</p>
    </form>}
  </AuthLayout>;
}
