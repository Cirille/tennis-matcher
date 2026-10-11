import { Link } from 'react-router-dom';

const paths = {
  arrow: 'M4 12h16m-6-6 6 6-6 6', back: 'M20 12H4m6-6-6 6 6 6',
  court: 'M3 5h18v14H3zM7 5v14M17 5v14M12 5v14M7 12h10',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6', logout: 'M9 4H4v16h5m5-13 5 5-5 5m-6-5h11',
  screen: 'M3 4h18v13H3zM8 21h8m-4-4v4', shuffle: 'M3 5h4l10 14h4m-4-4 4 4-4 4M3 19h4L17 5h4m-4-4 4 4-4 4',
  play: 'm8 4 13 8-13 8z', stop: 'M5 5h14v14H5z', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', check: 'm5 12 4 4L19 6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  chevron: 'm9 5 7 7-7 7', coffee: 'M3 7h13v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM16 8h2a3 3 0 0 1 0 6h-2M7 2v2m5-2v2',
};
export function Icon({ name, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.court} /></svg>;
}
export function Brand({ light = false }) {
  return <Link to="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="Tennis Matcher home"><span className="brand-mark"><Icon name="court" size={25} /></span><span>tennis<span className="brand-thin">matcher</span><span className="brand-dot">.</span></span></Link>;
}
export function Avatar({ player, large = false }) {
  const name = player?.name?.trim() || '?';
  const initial = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const tone = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  return player?.avatar && !player.avatar.endsWith('/avatar.svg')
    ? <img className={`avatar ${large ? 'avatar-large' : ''}`} src={player.avatar} alt="" />
    : <span className={`avatar avatar-tone-${tone} ${large ? 'avatar-large' : ''}`} aria-hidden="true">{initial}</span>;
}
export function CourtArtwork({ className = '' }) {
  return <div className={`court-art ${className}`} aria-hidden="true"><svg viewBox="0 0 480 600" fill="none"><rect width="480" height="600" rx="8" fill="#234e40" /><rect x="52" y="56" width="376" height="488" stroke="#d7e7bd" strokeWidth="2" /><path d="M98 56v488M382 56v488M98 182h284M98 418h284M240 182v236M52 300h376" stroke="#d7e7bd" strokeWidth="2" /><path d="M34 300h412" stroke="#f7f5eb" strokeWidth="5" strokeDasharray="2 3" /><circle cx="321" cy="442" r="22" fill="#d6ed80" /><path d="M303 429c15 1 25 11 30 30m-19-39c-2 16 7 28 23 31" stroke="#f8ffe8" strokeWidth="2" /></svg></div>;
}
export function AuthLayout({ eyebrow = 'CLUBHOUSE ACCESS', title, description, children }) {
  return <main className="auth-page"><aside className="auth-story"><Brand light /><div className="auth-story-copy"><p className="eyebrow">A little less organising.</p><h2>A lot more<br /><em>time on court.</em></h2><p>Bring your club together, one round at a time.</p></div><CourtArtwork /><span className="auth-story-note">Made for the love of the game.</span></aside><section className="auth-main"><Link className="back-link" to="/"><Icon name="back" /> Back to home</Link><div className="auth-card"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="muted intro">{description}</p>}{children}</div><p className="auth-footer">Tennis Matcher · Your next match starts here.</p></section></main>;
}
