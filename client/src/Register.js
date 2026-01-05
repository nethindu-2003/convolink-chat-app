import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import './App.css';
import './Register.css';

function Register() {
    const [formData, setFormData] = useState({ username: '', email: '', password: '' });
    const [selectedAvatar, setSelectedAvatar] = useState("");
    const [error, setError] = useState("");
    const navigate = useNavigate();

    // Generate 5 random avatar options
    const avatarOptions = [
        "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
        "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
        "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
        "https://api.dicebear.com/7.x/avataaars/svg?seed=Jack",
        "https://api.dicebear.com/7.x/avataaars/svg?seed=Molly"
    ];

    const handleRegister = async () => {
        // Frontend Validation
        if(!formData.username || !formData.email || !formData.password) {
            setError("All fields are required!");
            return;
        }
        if(!/\S+@\S+\.\S+/.test(formData.email)) {
            setError("Please enter a valid email.");
            return;
        }
        if(formData.password.length < 6) {
            setError("Password must be at least 6 characters.");
            return;
        }

        try {
            await axios.post('http://localhost:4000/api/register', {
                ...formData,
                avatar: selectedAvatar || avatarOptions[0]
            });
            alert('Registration Successful! Please Login.');
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || "Registration failed");
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
                    <Link to="/" className="nav-btn">
                        Sign In
                    </Link>
                </nav>
            </header>

            {/* MAIN SECTION */}
            <main className="auth-main">
                
                {/* LEFT CONTENT (Marketing Text) */}
                <section className="auth-info">
                    <h1>Join the Community</h1>
                    <p>
                        Create your account to start secure, real-time messaging. 
                        Choose your avatar and connect with friends instantly.
                    </p>

                    <ul className="features">
                        <li>Free account creation</li>
                        <li>Customizable profiles</li>
                        <li>Encrypted private messaging</li>
                    </ul>
                </section>

                {/* RIGHT CONTENT (Register Form) */}
                <section className="auth-card">
                    <h2>Create Account</h2>
                    {error && <p className="error-msg">{error}</p>}

                    <div className="input-group">
                        <label>Username</label>
                        <input 
                            type="text" 
                            placeholder="Pick a username" 
                            onChange={(e) => setFormData({...formData, username: e.target.value})} 
                        />
                    </div>

                    <div className="input-group">
                        <label>Email Address</label>
                        <input 
                            type="email" 
                            placeholder="you@example.com" 
                            onChange={(e) => setFormData({...formData, email: e.target.value})} 
                        />
                    </div>

                    <div className="input-group">
                        <label>Password</label>
                        <input 
                            type="password" 
                            placeholder="6+ characters" 
                            onChange={(e) => setFormData({...formData, password: e.target.value})} 
                        />
                    </div>

                    {/* Avatar Selection Section */}
                    <div style={{marginTop: '20px'}}>
                        <label style={{display:'block', marginBottom:'10px', fontWeight:'500'}}>Choose Avatar</label>
                        <div className="avatar-selection">
                            {avatarOptions.map((av, index) => (
                                <img 
                                    key={index} 
                                    src={av} 
                                    alt="avatar"
                                    className={`avatar-option ${selectedAvatar === av ? 'selected' : ''}`}
                                    onClick={() => setSelectedAvatar(av)}
                                />
                            ))}
                        </div>
                    </div>

                    <button className="primary-btn" onClick={handleRegister}>
                        Sign Up
                    </button>

                    <p className="auth-footer">
                        Already have an account? 
                        <Link to="/"> Sign In</Link>
                    </p>
                </section>
            </main>
        </div>
    );
}

export default Register;