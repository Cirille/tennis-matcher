import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand, CourtArtwork, Icon } from './UI';

export default function Home() {
  const navigate = useNavigate();
  const [clubSlug, setClubSlug] = useState('');
  const handleJoin = event => {
    event.preventDefault();
    if (clubSlug.trim()) navigate(`/${encodeURIComponent(clubSlug.trim().toLowerCase())}`);
  };
  return <div className="home-page"><header className="public-header"><Brand /><Link className="btn btn-secondary" to="/admin">Club staff sign in <Icon name="arrow" /></Link></header>
    <main className="home-hero"><section className="home-copy"><p className="eyebrow"><span className="status-dot" /> MORE TIME FOR THE GAME</p><h1>Good company.<br /><em>Great tennis.</em></h1><p className="home-description">Your club. Your people. Your next match.<br />Check in, find your doubles partners, and get out on court.</p>
      <form className="join-card" onSubmit={handleJoin}><div className="section-heading"><span className="icon-tile"><Icon name="court" size={22} /></span><div><h2>Let’s get you on court.</h2><p>Enter the club ID shared by your organiser.</p></div></div><label htmlFor="club-id">Club ID</label><div className="join-input-row"><input id="club-id" className="form-control" placeholder="e.g. riverside-tennis" autoCapitalize="none" autoCorrect="off" value={clubSlug} onChange={e => setClubSlug(e.target.value)} required /><button className="btn btn-primary" type="submit">Find my club <Icon name="arrow" /></button></div><p className="field-hint">Have a club link? Open it to go straight to check-in.</p></form>
    </section><div className="home-visual"><span className="visual-kicker">THE COURT IS CALLING</span><CourtArtwork /><div className="visual-caption"><span className="caption-star">✳</span><span>A place for every player.<br /><strong>A match worth showing up for.</strong></span></div><span className="visual-side-note">MEET. MATCH. PLAY.</span></div></main>
    <section className="home-steps" aria-label="How it works">{[['01', 'Check in', 'A club PIN. A name. You’re in.'], ['02', 'Find your match', 'Your organiser sets the pairings.'], ['03', 'Make it a good one', 'See your court and enjoy the game.']].map(([number, title, copy]) => <div key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></div>)}</section><footer className="public-footer"><span>Made for the love of the game.</span><Link to="/root">Platform operator <Icon name="arrow" size={14} /></Link></footer>
  </div>;
}
