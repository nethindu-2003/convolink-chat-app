ConvoLink - Modern Distributed Chat Application
ConvoLink is a robust, real-time messaging platform designed to demonstrate the principles of distributed systems. It features secure authentication, real-time socket communication, and a modern "Glassmorphism" UI. The application supports both private (1-on-1) messaging and multi-user group chats with persistent storage and state tracking.
________________________________________
1. Key Features
•	Real-Time Messaging: Instant message delivery using Socket.io. No page refreshes required.
•	Group Chat: Users can create named groups, add multiple members, and chat in a shared space.
•	Message Status (Read Receipts): Tracks the lifecycle of a message:
o	Sent (✓): Saved to the server database.
o	Delivered (✓✓): Reached the recipient's device.
o	Read (Blue ✓✓): Recipient has opened the chat.
•	Message Management: Users can Edit and Delete their own messages. These changes are broadcasted instantly to all clients.
•	Security:
o	Encryption: Messages are encrypted using AES-256-CBC before being stored in the database.
o	Authentication: Secure Login/Register system using bcrypt for password hashing and JWT (JSON Web Tokens) for session management.
•	Modern UI/UX:
o	Dark Mode: A sleek, professional dark theme with glass-morphism effects.
o	Responsive Design: Fully functional on Desktop (Split View) and Mobile (drawer navigation).
o	Rich Media: Integrated Emoji Picker and Avatar generation (via DiceBear API).
________________________________________
2. Technical Architecture
The system follows a Client-Server architecture typical of distributed web applications.1
Frontend (Client)
•	Framework: React.js
•	State Management: React Hooks (useState, useEffect)2
•	Communication: socket.io-client for real-time events, axios for REST API calls.
•	Routing: react-router-dom for navigating between Auth and Chat pages.
Backend (Server)
•	Runtime: Node.js & Express
•	Real-Time Engine: Socket.io (Uses "Rooms" for group broadcasting).
•	Database: SQLite (Relational DB stored as a file for portability).
•	Security: crypto module for message encryption/decryption.
________________________________________
3. Database Schema
The application uses a normalized relational database structure:
Table	Description
users	Stores user credentials (hashed password), profile info, and avatars.
groups	Stores group metadata (Name, Creator ID, Avatar).
group_members	Linking table that maps Users to Groups (Many-to-Many relationship).
messages	Stores chat history. Includes sender_id, content (encrypted), timestamp, status, and is_edited flags. It links to either a receiver_id (Private) or group_id (Group).
________________________________________
4. How it Works (Data Flow)
1.	Connection: When a user logs in, the React client establishes a persistent WebSocket connection to the Node.js server.
2.	Room Joining: The server identifies which Groups the user belongs to and automatically subscribes their socket to those specific Socket Rooms.
3.	Sending: When User A sends a message:
o	Client emits send_message event.
o	Server encrypts the text and saves it to SQLite.
o	Server identifies the target (User B or Group Room).
o	Server broadcasts the message to the target immediately.
4.	Updates: If User A edits a message, a specific event (message_updated) is fired. The server updates the specific row in the DB and pushes the change to all connected clients in that chat context.
