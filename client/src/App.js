import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import Chat from './Chat'; // Import the new file
import './App.css';

function App() {
  // Check if user is already logged in (has a token)
  const [token, setToken] = useState(localStorage.getItem('token'));

  return (
    <Router>
      <Routes>
        {/* Route for Login */}
        <Route path="/" element={!token ? <Login setToken={setToken} /> : <Navigate to="/chat" />} />
        
        {/* Route for Register */}
        <Route path="/register" element={<Register />} />
        
        {/* Route for Chat (Protected) */}
        <Route 
          path="/chat" 
          element={token ? <Chat /> : <Navigate to="/" />} 
        />
      </Routes>
    </Router>
  );
}

export default App;