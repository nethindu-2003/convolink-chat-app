const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// 1. Middleware
app.use(cors()); // Allow React to talk to this server
app.use(express.json()); // Allow handling JSON data in POST requests

const SECRET_KEY = "my_super_secret_key"; // In production, keep this in a .env file

// 2. Database Setup
const db = new sqlite3.Database('./chat_v2.db');

// --- ENCRYPTION SETTINGS ---
const ENCRYPTION_KEY = "12345678901234567890123456789012"; 
const IV_LENGTH = 16; 

// Helper: Encrypt
function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Helper: Decrypt
function decrypt(text) {
    try {
        let textParts = text.split(':');
        if (textParts.length < 2) return text; 
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) { return text; }
}

// 3. Database Schema Initialization
db.serialize(() => {
    // Users Table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE, 
        password TEXT,
        avatar TEXT
    )`);

    // Groups Table (NEW)
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        created_by INTEGER,
        avatar TEXT
    )`);

    // Group Members Table (NEW)
    // Links users to groups
    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER,
        user_id INTEGER,
        FOREIGN KEY(group_id) REFERENCES groups(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Messages Table (UPDATED)
    // Now includes 'group_id' to support group chats
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER, -- Null if group message
        group_id INTEGER,    -- Null if private message
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_edited INTEGER DEFAULT 0,
        status TEXT DEFAULT 'sent', 
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);
});

const io = new Server(server, {
    cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

// Track online users: Map<UserId, SocketId>
let userSockets = new Map();

const broadcastUserStatus = () => {
    const onlineUserIds = Array.from(userSockets.keys());
    io.emit('online_users_update', onlineUserIds);
};

// --- AUTH ROUTES ---

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password, avatar } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "All fields are required" });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userAvatar = avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;

    const stmt = db.prepare("INSERT INTO users (username, email, password, avatar) VALUES (?, ?, ?, ?)");
    stmt.run(username, email, hashedPassword, userAvatar, function(err) {
        if (err) {
            if(err.message.includes('email')) return res.status(400).json({ error: "Email already exists" });
            return res.status(400).json({ error: "Username already exists" });
        }
        res.json({ message: "User registered successfully" });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: "User not found" });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
            res.json({ 
                message: "Login successful", token, userId: user.id, 
                username: user.username, email: user.email, avatar: user.avatar 
            });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    });
});

// Update Profile
app.put('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    const { username, email, avatar } = req.body;
    const stmt = db.prepare("UPDATE users SET username = ?, email = ?, avatar = ? WHERE id = ?");
    stmt.run(username, email, avatar, userId, function(err) {
        if (err) return res.status(400).json({ error: "Update failed." });
        res.json({ message: "Profile updated successfully" });
    });
});

// Get All Users (for creating chats)
app.get('/api/users/:myId', (req, res) => {
    const myId = req.params.myId;
    db.all("SELECT id, username, avatar FROM users WHERE id != ?", [myId], (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

// --- NEW GROUP API ROUTES ---

// 1. Create a New Group
app.post('/api/groups', (req, res) => {
    const { name, creatorId, members } = req.body; // members is an array of user IDs
    
    // Create Group Entry
    db.run("INSERT INTO groups (name, created_by, avatar) VALUES (?, ?, ?)", 
    [name, creatorId, `https://api.dicebear.com/7.x/initials/svg?seed=${name}`], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const groupId = this.lastID;
        
        // Add Members to Group (Creator + Selected Members)
        const allMembers = [creatorId, ...members];
        
        // Create placeholders like (?, ?), (?, ?) for bulk insert
        const placeholders = allMembers.map(() => '(?, ?)').join(',');
        const values = [];
        allMembers.forEach(uid => { values.push(groupId, uid); });

        db.run(`INSERT INTO group_members (group_id, user_id) VALUES ${placeholders}`, values, function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Real-time: Notify all members that they have been added to a new group
            allMembers.forEach(uid => {
                const sId = userSockets.get(String(uid));
                if(sId) io.to(sId).emit('group_created', { id: groupId, name });
            });

            res.json({ message: "Group created", groupId });
        });
    });
});

// 2. Get User's Groups
app.get('/api/groups/user/:userId', (req, res) => {
    db.all(`
        SELECT g.* FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?
    `, [req.params.userId], (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

// --- UNIFIED MESSAGE RETRIEVAL ---
// This handles fetching messages for both Private Chats AND Groups
app.get('/api/messages', (req, res) => {
    const { userId, otherId, groupId } = req.query;

    let sql = '';
    let params = [];

    if (groupId) {
        // Fetch Group Messages (Join with users table to get sender details)
        sql = `SELECT m.*, u.username as sender_name, u.avatar as sender_avatar 
               FROM messages m 
               JOIN users u ON m.sender_id = u.id
               WHERE m.group_id = ? ORDER BY timestamp ASC`;
        params = [groupId];
    } else {
        // Fetch Private Messages
        sql = `SELECT * FROM messages 
               WHERE (sender_id = ? AND receiver_id = ?) 
                  OR (sender_id = ? AND receiver_id = ?) 
               ORDER BY timestamp ASC`;
        params = [userId, otherId, otherId, userId];
    }

    db.all(sql, params, (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        // Decrypt messages before sending to client
        const decryptedRows = rows.map(msg => ({ ...msg, content: decrypt(msg.content) }));
        res.json(decryptedRows);
    });
});

// --- MESSAGE ACTIONS (Edit/Delete) ---

app.put('/api/messages/:id', (req, res) => {
    const messageId = req.params.id;
    const { userId, newContent } = req.body;

    db.get("SELECT * FROM messages WHERE id = ?", [messageId], (err, msg) => {
        if (err || !msg) return res.status(404).json({ error: "Message not found" });
        if (String(msg.sender_id) !== String(userId)) return res.status(403).json({ error: "Unauthorized" });

        const encryptedContent = encrypt(newContent);
        const stmt = db.prepare("UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?");
        stmt.run(encryptedContent, messageId, function(err) {
            if (err) return res.status(500).json({ error: "Update failed" });

            const updateData = { id: messageId, content: newContent };
            
            // Notify appropriate parties
            if (msg.group_id) {
                io.to(`group_${msg.group_id}`).emit('message_updated', updateData);
            } else {
                const receiverSocket = userSockets.get(String(msg.receiver_id));
                const senderSocket = userSockets.get(String(msg.sender_id));
                if (receiverSocket) io.to(receiverSocket).emit('message_updated', updateData);
                if (senderSocket) io.to(senderSocket).emit('message_updated', updateData);
            }
            res.json({ message: "Updated successfully" });
        });
    });
});

app.delete('/api/messages/:id', (req, res) => {
    const messageId = req.params.id;
    const { userId } = req.body; 

    db.get("SELECT * FROM messages WHERE id = ?", [messageId], (err, msg) => {
        if (err || !msg) return res.status(404).json({ error: "Message not found" });
        if (String(msg.sender_id) !== String(userId)) return res.status(403).json({ error: "Unauthorized" });

        db.run("DELETE FROM messages WHERE id = ?", [messageId], function(err) {
            if (err) return res.status(500).json({ error: "Failed to delete" });

            // Notify appropriate parties
            if (msg.group_id) {
                io.to(`group_${msg.group_id}`).emit('message_deleted', messageId);
            } else {
                const receiverSocket = userSockets.get(String(msg.receiver_id));
                const senderSocket = userSockets.get(String(msg.sender_id));
                if (receiverSocket) io.to(receiverSocket).emit('message_deleted', messageId);
                if (senderSocket) io.to(senderSocket).emit('message_deleted', messageId);
            }
            res.json({ message: "Deleted successfully" });
        });
    });
});

// Leave Group
app.post('/api/groups/leave', (req, res) => {
    const { groupId, userId } = req.body;
    
    // Remove user from the group members table
    db.run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId], function(err) {
        if (err) return res.status(500).json({ error: "Failed to leave group" });
        
        // Optional: If group has 0 members, delete the group entirely
        db.get("SELECT count(*) as count FROM group_members WHERE group_id = ?", [groupId], (err, row) => {
            if (!err && row.count === 0) {
                db.run("DELETE FROM groups WHERE id = ?", [groupId]);
            }
        });

        res.json({ message: "Left group successfully" });
    });
});

// --- SOCKET IO LOGIC ---
io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    if(userId) {
        userSockets.set(userId, socket.id);
        console.log(`User ${userId} connected`);
        broadcastUserStatus();

        // ** IMPORTANT: Join all group rooms this user belongs to **
        db.all("SELECT group_id FROM group_members WHERE user_id = ?", [userId], (err, rows) => {
            if(!err && rows) {
                rows.forEach(row => socket.join(`group_${row.group_id}`));
            }
        });
    }

    // --- Unified Message Handler (Group & Private) ---
    socket.on('send_message', (data) => {
        const { sender_id, receiver_id, group_id, content, timestamp } = data;
        const encryptedContent = encrypt(content);

        // Determine if receiver is online (only for private chat status)
        let initialStatus = 'sent';
        if (!group_id) {
            const receiverSocketId = userSockets.get(String(receiver_id));
            if (receiverSocketId) initialStatus = 'delivered';
        }

        const stmt = db.prepare("INSERT INTO messages (sender_id, receiver_id, group_id, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)");
        stmt.run(sender_id, receiver_id, group_id, encryptedContent, timestamp, initialStatus, function(err) {
            if (err) return console.error(err);
            
            const msgData = { 
                id: this.lastID, sender_id, receiver_id, group_id, content, timestamp,
                status: initialStatus 
            };

            if (group_id) {
                // BROADCAST TO GROUP ROOM
                io.to(`group_${group_id}`).emit('receive_message', msgData);
            } else {
                // PRIVATE MESSAGE
                const receiverSocketId = userSockets.get(String(receiver_id));
                const senderSocketId = userSockets.get(String(sender_id));
                if (receiverSocketId) io.to(receiverSocketId).emit('receive_message', msgData); 
                if (senderSocketId) io.to(senderSocketId).emit('receive_message', msgData);
            }
        });
    });

    // Handle "Mark as Read" (Private Chat Only)
    socket.on('mark_read', (data) => {
        const { sender_id, receiver_id } = data;
        const stmt = db.prepare("UPDATE messages SET status = 'read' WHERE sender_id = ? AND receiver_id = ? AND status != 'read'");
        stmt.run(sender_id, receiver_id, function(err) {
            if (!err && this.changes > 0) {
                const senderSocket = userSockets.get(String(sender_id));
                if (senderSocket) io.to(senderSocket).emit('messages_read_update', { reader_id: receiver_id });
            }
        });
    });

    // Real-time update when added to new group
    socket.on('join_group', (groupId) => {
        socket.join(`group_${groupId}`);
    });

    socket.on('disconnect', () => {
        if(userId) {
            userSockets.delete(userId);
            console.log(`User ${userId} disconnected`);
            broadcastUserStatus(); 
        }
    });

    // Handle Leaving a Group Room
    socket.on('leave_group', (groupId) => {
        socket.leave(`group_${groupId}`);
        console.log(`User left group room ${groupId}`);
    });
});

// Start Server
server.listen(4000, () => {
    console.log('Server running on http://localhost:4000');
});