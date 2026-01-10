const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mysql = require('mysql2/promise'); 
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

// Initialize Express App and HTTP Server
const app = express();
const server = http.createServer(app);

// --- 1. MIDDLEWARE ---
// CORS: Allows your React frontend (running on port 3000) to communicate with this backend
app.use(cors()); 
// JSON Parser: Allows the server to understand JSON data sent in POST requests
app.use(express.json()); 

const SECRET_KEY = "my_super_secret_key"; // Secret used to sign JWT tokens (Keep safe in production)

// --- 2. DATABASE CONFIGURATION ---
// We use a 'Pool' instead of a single connection.
// A Pool manages multiple connections at once, which is better for high-traffic apps.
// It automatically reuses connections so the server doesn't have to reconnect for every single user.
const db = mysql.createPool({
    host: 'localhost',      
    port: 3307,             
    user: 'root',           
    password: '2003@Nethindu',   
    database: 'chat_app',   
    waitForConnections: true, // If all connections are busy, wait until one is free
    connectionLimit: 10,      // Maximum 10 active connections at once
    queueLimit: 0             // No limit on how many requests can wait in line
});

// --- 3. ENCRYPTION HELPERS ---
// Messages are encrypted using AES-256-CBC before saving to the database.
// This ensures that even if the database is hacked, the messages remain unreadable.
const ENCRYPTION_KEY = "12345678901234567890123456789012"; // Must be 32 chars
const IV_LENGTH = 16; // Initialization Vector length

function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return iv.toString('hex') + ':' + encrypted.toString('hex'); // Store IV with the encrypted data so we can decrypt it later
}

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

// Initialize Socket.io (Real-time Engine)
const io = new Server(server, {
    cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

// In-Memory Storage for Online Status
let userSockets = new Map();

const broadcastUserStatus = () => {
    const onlineUserIds = Array.from(userSockets.keys());
    io.emit('online_users_update', onlineUserIds);
};

// --- 4. AUTHENTICATION ROUTES ---

// Registration Route
app.post('/api/register', async (req, res) => {
    const { username, email, password, avatar } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "All fields are required" });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userAvatar = avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;

    try {
        // Execute SQL Insert
        const [result] = await db.query(
            "INSERT INTO users (username, email, password, avatar) VALUES (?, ?, ?, ?)",
            [username, email, hashedPassword, userAvatar]
        );
        // 'insertId' contains the ID of the newly created user
        res.json({ message: "User registered successfully", userId: result.insertId });
    } catch (err) {
        // Handle unique constraint violations (e.g., email already exists)
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "Username or Email already exists" });
        res.status(500).json({ error: err.message });
    }
});

// Login Route
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "All fields are required" });

    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = rows[0]; // Get the first match

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Invalid credentials" });
    }

    // Generate a JWT Token for session management
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ 
        message: "Login successful", token, 
        userId: user.id, username: user.username, email: user.email, avatar: user.avatar 
    });
});

// Update Profile Route
app.put('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    const { username, email, avatar } = req.body;
    
    try {
        await db.query("UPDATE users SET username = ?, email = ?, avatar = ? WHERE id = ?", 
            [username, email, avatar, userId]
        );
        res.json({ message: "Profile updated successfully" });
    } catch (err) {
        res.status(400).json({ error: "Update failed." });
    }
});

// Get Users List (excluding self)
app.get('/api/users/:myId', async (req, res) => {
    const myId = req.params.myId;
    try {
        const [rows] = await db.query("SELECT id, username, avatar FROM users WHERE id != ?", [myId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

// --- 5. GROUP MANAGEMENT ROUTES ---

// Create Group Route
// This uses a "Transaction" to ensure data integrity.
// We must insert the Group AND insert the Members. If one fails, we undo everything.
app.post('/api/groups', async (req, res) => {
    const { name, creatorId, members } = req.body;
    const avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${name}`;
    
    // Get a dedicated connection from the pool for the transaction
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction(); // Start Transaction

        // Step 1: Insert the Group
        const [groupResult] = await connection.query(
            "INSERT INTO chat_groups (name, created_by, avatar) VALUES (?, ?, ?)", 
            [name, creatorId, avatar]
        );
        const groupId = groupResult.insertId;

        // Step 2: Prepare Member Data for Bulk Insert
        const allMembers = [creatorId, ...members];
        const memberValues = allMembers.map(uid => [groupId, uid]);

        // Bulk Insert members into linking table
        await connection.query("INSERT INTO group_members (group_id, user_id) VALUES ?", [memberValues]);

        await connection.commit(); // Success! Save changes.

        // Notify online members immediately via Socket
        allMembers.forEach(uid => {
            const sId = userSockets.get(String(uid));
            if(sId) io.to(sId).emit('group_created', { id: groupId, name });
        });

        res.json({ message: "Group created", groupId });
    } catch (err) {
        await connection.rollback(); // Error! Undo changes.
        res.status(500).json({ error: err.message });
    } finally {
        connection.release(); // Return connection to pool
    }
});

// Get User's Groups
app.get('/api/groups/user/:userId', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT g.* FROM chat_groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
        `, [req.params.userId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

// --- 6. MESSAGE ROUTES ---

// Fetch Messages (Supports both Private and Group chats)
app.get('/api/messages', async (req, res) => {
    const { userId, otherId, groupId } = req.query;
    let sql = '';
    let params = [];

    if (groupId) {
        // Group Logic: Join with User table to get Sender Name/Avatar for UI display
        sql = `SELECT m.*, u.username as sender_name, u.avatar as sender_avatar 
               FROM messages m 
               JOIN users u ON m.sender_id = u.id
               WHERE m.group_id = ? ORDER BY timestamp ASC`;
        params = [groupId];
    } else {
        // Private Logic: Fetch messages where (Sender=Me & Receiver=You) OR (Sender=You & Receiver=Me)
        sql = `SELECT * FROM messages 
               WHERE (sender_id = ? AND receiver_id = ?) 
                  OR (sender_id = ? AND receiver_id = ?) 
               ORDER BY timestamp ASC`;
        params = [userId, otherId, otherId, userId];
    }

    try {
        const [rows] = await db.query(sql, params);
        // Decrypt the content of every message before sending to frontend
        const decryptedRows = rows.map(msg => ({ ...msg, content: decrypt(msg.content) }));
        res.json(decryptedRows);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

// Edit Message Route
app.put('/api/messages/:id', async (req, res) => {
    const messageId = req.params.id;
    const { userId, newContent } = req.body;

    try {
        // Verify ownership before editing
        const [rows] = await db.query("SELECT * FROM messages WHERE id = ?", [messageId]);
        const msg = rows[0];

        if (!msg) return res.status(404).json({ error: "Message not found" });
        if (String(msg.sender_id) !== String(userId)) return res.status(403).json({ error: "Unauthorized" });

        const encryptedContent = encrypt(newContent);
        
        // Update DB
        await db.query("UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?", [encryptedContent, messageId]);

        // Real-time Update Broadcast
        const updateData = { id: messageId, content: newContent };
        
        if (msg.group_id) {
            io.to(`group_${msg.group_id}`).emit('message_updated', updateData);
        } else {
            const receiverSocket = userSockets.get(String(msg.receiver_id));
            const senderSocket = userSockets.get(String(msg.sender_id));
            if (receiverSocket) io.to(receiverSocket).emit('message_updated', updateData);
            if (senderSocket) io.to(senderSocket).emit('message_updated', updateData);
        }
        res.json({ message: "Updated successfully" });
    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
});

// Delete Message Route
app.delete('/api/messages/:id', async (req, res) => {
    const messageId = req.params.id;
    const { userId } = req.body; 

    try {
        const [rows] = await db.query("SELECT * FROM messages WHERE id = ?", [messageId]);
        const msg = rows[0];

        if (!msg) return res.status(404).json({ error: "Message not found" });
        if (String(msg.sender_id) !== String(userId)) return res.status(403).json({ error: "Unauthorized" });

        await db.query("DELETE FROM messages WHERE id = ?", [messageId]);

        // Real-time Delete Broadcast
        if (msg.group_id) {
            io.to(`group_${msg.group_id}`).emit('message_deleted', messageId);
        } else {
            const receiverSocket = userSockets.get(String(msg.receiver_id));
            const senderSocket = userSockets.get(String(msg.sender_id));
            if (receiverSocket) io.to(receiverSocket).emit('message_deleted', messageId);
            if (senderSocket) io.to(senderSocket).emit('message_deleted', messageId);
        }
        res.json({ message: "Deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete" });
    }
});

// Leave Group Route
app.post('/api/groups/leave', async (req, res) => {
    const { groupId, userId } = req.body;
    
    try {
        // Remove the member link
        await db.query("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);

        // Cleanup: If the group has 0 members left, delete the group definition
        const [rows] = await db.query("SELECT count(*) as count FROM group_members WHERE group_id = ?", [groupId]);
        if (rows[0].count === 0) {
            await db.query("DELETE FROM chat_groups WHERE id = ?", [groupId]);
        }

        res.json({ message: "Left group successfully" });
    } catch (err) {
        res.status(500).json({ error: "Failed to leave group" });
    }
});

// --- 7. REAL-TIME SOCKET EVENTS ---

io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId;
    if(userId) {
        // Store the user's socket ID so we can send private messages later
        userSockets.set(userId, socket.id);
        console.log(`User ${userId} connected`);
        broadcastUserStatus();

        // Join Group Rooms
        // This ensures the user receives messages sent to any group they belong to
        try {
            const [rows] = await db.query("SELECT group_id FROM group_members WHERE user_id = ?", [userId]);
            rows.forEach(row => socket.join(`group_${row.group_id}`));
        } catch (e) { console.error(e); }
    }

    // Handle Sending Messages
    socket.on('send_message', async (data) => {
        const { sender_id, receiver_id, group_id, content, timestamp } = data;
        const encryptedContent = encrypt(content);

        const mysqlTimestamp = new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
        // Auto-detect status (Sent vs Delivered)
        let initialStatus = 'sent';
        if (!group_id) {
            const receiverSocketId = userSockets.get(String(receiver_id));
            if (receiverSocketId) initialStatus = 'delivered';
        }

        try {
            // Save to MySQL Database
            const [result] = await db.query(
                "INSERT INTO messages (sender_id, receiver_id, group_id, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)",
                [sender_id, receiver_id, group_id, encryptedContent, mysqlTimestamp, initialStatus]
            );
            const [userRows] = await db.query("SELECT username FROM users WHERE id = ?", [sender_id]);
            const senderName = userRows[0]?.username || "User";

            // Construct payload to send to clients (includes the new DB ID)
            const msgData = { 
                id: result.insertId, sender_id, receiver_id, group_id, content, timestamp,
                status: initialStatus, sender_name: senderName
            };

            // Broadcast Logic
            if (group_id) {
                // Send to everyone in the Group Room
                io.to(`group_${group_id}`).emit('receive_message', msgData);
            } else {
                // Send Private Message to Receiver & Sender
                const receiverSocketId = userSockets.get(String(receiver_id));
                const senderSocketId = userSockets.get(String(sender_id));
                if (receiverSocketId) io.to(receiverSocketId).emit('receive_message', msgData); 
                if (senderSocketId) io.to(senderSocketId).emit('receive_message', msgData);
            }
        } catch (err) { console.error("Message send error:", err); }
    });

    // Handle Read Receipts (Double Blue Ticks)
    socket.on('mark_read', async (data) => {
        const { sender_id, receiver_id } = data;
        try {
            // Update all unread messages in DB
            const [result] = await db.query(
                "UPDATE messages SET status = 'read' WHERE sender_id = ? AND receiver_id = ? AND status != 'read'", 
                [sender_id, receiver_id]
            );

            // Notify original sender that their messages were read
            if (result.affectedRows > 0) {
                const senderSocket = userSockets.get(String(sender_id));
                if (senderSocket) io.to(senderSocket).emit('messages_read_update', { reader_id: receiver_id });
            }
        } catch (err) { console.error(err); }
    });

    // Event: User created a group -> They join the room immediately
    socket.on('join_group', (groupId) => {
        socket.join(`group_${groupId}`);
    });

    // Event: User left a group -> Remove them from the room
    socket.on('leave_group', (groupId) => {
        socket.leave(`group_${groupId}`);
    });

    // Cleanup on Disconnect
    socket.on('disconnect', () => {
        if(userId) {
            userSockets.delete(userId);
            console.log(`User ${userId} disconnected`);
            broadcastUserStatus(); 
        }
    });
});

server.listen(4000, () => {
    console.log('Server running on http://localhost:4000');
});