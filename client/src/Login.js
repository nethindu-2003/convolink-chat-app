import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import './App.css';
import './Login.css';

function Login({ setToken }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const response = await axios.post('http://localhost:4000/api/login', {
        email,
        password
      });

      const { token, userId, username, avatar, email: userEmail } = response.data;

      localStorage.setItem('token', token);
      localStorage.setItem('userId', userId);
      localStorage.setItem('username', username);
      localStorage.setItem('avatar', avatar);
      localStorage.setItem('email', userEmail);

      setToken(token);
      navigate('/chat');
    } catch (error) {
      alert(error.response?.data?.error || 'Invalid Credentials');
    }
  };

  return (
    <div className="auth-wrapper">
      
      {/* NAVBAR */}
      <header className="auth-navbar">
        <div className="brand">
          <span>ConvoLink</span>
        </div>

        <nav>
          <Link to="/register" className="nav-btn">
            Create Account
          </Link>
        </nav>
      </header>

      {/* MAIN SECTION */}
      <main className="auth-main">
        
        {/* LEFT CONTENT */}
        <section className="auth-info">
          <h1>Modern Distributed Chat Platform</h1>
          <p>
            ConvoLink enables secure, real-time communication
            across distributed systems with high reliability and speed.
          </p>

          <ul className="features">
            <li>Real-time socket communication</li>
            <li>Secure authentication</li>
            <li>Scalable distributed architecture</li>
          </ul>
        </section>

        {/* LOGIN CARD */}
        <section className="auth-card">
          <h2>Sign in to your account</h2>

          <div className="input-group">
            <label>Email address</label>
            <input
              type="email"
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="input-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="primary-btn" onClick={handleLogin}>
            Sign In
          </button>

          <p className="auth-footer">
            Don’t have an account?
            <Link to="/register"> Create one</Link>
          </p>
        </section>

      </main>
    </div>
  );
}

export default Login;
