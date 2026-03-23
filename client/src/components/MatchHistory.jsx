import React from 'react';

const MatchHistory = ({ matchHistory, players }) => {
  return (
    <div className="mt-4 animate-fade-in" style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid var(--glass-border)', textAlign: 'left' }}>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.5rem', outline: 'none', color: 'var(--accent-tennis)' }}>
          Match History (Total: {matchHistory?.length || 0} Rounds)
        </summary>
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(!matchHistory || matchHistory.length === 0) ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No rounds played yet.</p>
          ) : (
            [...matchHistory].reverse().map((round) => (
              <details key={round.roundNumber} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '0.95rem', outline: 'none' }}>Round {round.roundNumber}</summary>
                <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {round.courts.map(c => (
                    <div key={c.id} style={{ borderLeft: `3px solid ${c.type === 'Clay' ? 'var(--clay-court)' : 'var(--hard-court)'}`, paddingLeft: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Court {c.number} ({c.type})</div>
                      <div style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#aaa' }}>Side A:</span> {c.sideA.map(id => players[id]?.name || 'Unknown').join(', ') || 'Empty'}
                      </div>
                      <div style={{ fontSize: '0.8rem' }}>
                        <span style={{ color: '#aaa' }}>Side B:</span> {c.sideB.map(id => players[id]?.name || 'Unknown').join(', ') || 'Empty'}
                      </div>
                    </div>
                  ))}
                  {round.courts.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No courts used.</div>}
                </div>
              </details>
            ))
          )}
        </div>
      </details>
    </div>
  );
};

export default MatchHistory;
