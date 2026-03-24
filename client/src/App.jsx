import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import RootDashboard from './components/RootDashboard';
import AdminDashboard from './components/AdminDashboard';
import PlayerScreen from './components/PlayerScreen';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/root" element={<RootDashboard />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/:clubSlug" element={<PlayerScreen />} />
      </Routes>
    </Router>
  );
}

export default App;
