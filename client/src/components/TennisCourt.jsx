import React from 'react';

const TennisCourt = ({ type, children }) => {
  const isClay = type === 'Clay';
  const courtColor = isClay ? 'var(--clay-court)' : 'var(--hard-court)';
  const lineColor = 'rgba(255, 255, 255, 0.8)';
  
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flex: 1, minHeight: '200px' }}>
      {/* Background SVG for the court lines */}
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 400 200" 
        preserveAspectRatio="none" 
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 0 }}
      >
        {/* Court Area */}
        <rect x="0" y="0" width="400" height="200" fill={courtColor} />
        
        {/* Outer Lines (Doubles sidelines & Baselines) */}
        <rect x="20" y="20" width="360" height="160" fill="none" stroke={lineColor} strokeWidth="2" />
        
        {/* Singles Lines */}
        <rect x="20" y="35" width="360" height="130" fill="none" stroke={lineColor} strokeWidth="2" />
        
        {/* Service Lines (Horizontal view: vertical lines in SVG) */}
        <line x1="110" y1="35" x2="110" y2="165" stroke={lineColor} strokeWidth="2" />
        <line x1="290" y1="35" x2="290" y2="165" stroke={lineColor} strokeWidth="2" />
        
        {/* Center Service Line (Horizontal view: horizontal line in SVG) */}
        <line x1="110" y1="100" x2="290" y2="100" stroke={lineColor} strokeWidth="2" />
        
        {/* Center Marks */}
        <line x1="20" y1="100" x2="25" y2="100" stroke={lineColor} strokeWidth="2" />
        <line x1="375" y1="100" x2="380" y2="100" stroke={lineColor} strokeWidth="2" />
        
        {/* Net */}
        <line x1="200" y1="15" x2="200" y2="185" stroke="white" strokeWidth="4" strokeDasharray="4,2" />
      </svg>
      
      {/* Content Overlay (Players) */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex' }}>
        {children}
      </div>
    </div>
  );
};

export default TennisCourt;
