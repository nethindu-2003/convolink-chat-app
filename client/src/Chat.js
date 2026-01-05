import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import EmojiPicker from 'emoji-picker-react';
import './Chat.css'; 

function Chat() {
    const navigate = useNavigate();
    const scrollRef = useRef();
    const [socket, setSocket] = useState(null);

    // --- DATA STATES ---
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]); // NEW: Stores list of groups the user is in
    const [messages, setMessages] = useState([]);
    
    // selectedChat now holds object: { type: 'user'|'group', id: ..., name: ..., avatar: ... }
    const [selectedChat, setSelectedChat] = useState(null);
    const [onlineUserIds, setOnlineUserIds] = useState(new Set()); 

    // --- UI STATES ---
    const [newMessage, setNewMessage] = useState("");
    const [showPicker, setShowPicker] = useState(false); // Main chat emoji picker
    const [showProfileModal, setShowProfileModal] = useState(false);
    
    // Edit Message Modal States
    const [showEditMsgModal, setShowEditMsgModal] = useState(false);
    const [msgToEdit, setMsgToEdit] = useState({ id: null, content: "" });
    const [showEditPicker, setShowEditPicker] = useState(false); // Edit modal emoji picker

    // Create Group Modal States (NEW)
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);

    // User Info (Me)
    const myId = localStorage.getItem('userId');
    const [myProfile, setMyProfile] = useState({
        id: localStorage.getItem('userId'),
        username: localStorage.getItem('username'),
        email: localStorage.getItem('email') || "",
        avatar: localStorage.getItem('avatar') || ""
    });

    // 1. CONNECT SOCKET & LOAD INITIAL DATA
    useEffect(() => {
        if (!myId) {
            navigate('/');
            return;
        }

        // Initialize Socket
        const newSocket = io('http://localhost:4000', { query: { userId: myId } });
        setSocket(newSocket);

        // Fetch All Users
        axios.get(`http://localhost:4000/api/users/${myId}`)
            .then(res => setUsers(res.data))
            .catch(err => console.error("Error fetching users:", err));

        // Fetch My Groups (NEW)
        axios.get(`http://localhost:4000/api/groups/user/${myId}`)
            .then(res => setGroups(res.data))
            .catch(err => console.error("Error fetching groups:", err));

        return () => newSocket.close();
    }, [myId, navigate]);

    // 2. SOCKET LISTENERS
    useEffect(() => {
        if (!socket) return;
        
        // A. Listen for incoming messages
        socket.on('receive_message', (data) => {
            // Check if the message belongs to the currently open chat
            const isGroupMsg = data.group_id && selectedChat?.type === 'group' && String(data.group_id) === String(selectedChat.id);
            const isPrivateMsg = !data.group_id && selectedChat?.type === 'user' && (String(data.sender_id) === String(selectedChat.id) || String(data.sender_id) === String(myId));

            if (isGroupMsg || isPrivateMsg) {
                setMessages((prev) => [...prev, data]);
            }
        });

        // B. Listen for new groups & Join Room
        socket.on('group_created', (newGroup) => {
            axios.get(`http://localhost:4000/api/groups/user/${myId}`)
                .then(res => setGroups(res.data));
            
            // FIX: Join the socket room immediately
            if (newGroup && newGroup.id) {
                socket.emit('join_group', newGroup.id);
            }
        });

        // C. Online Status Updates
        socket.on('online_users_update', (onlineIds) => {
            setOnlineUserIds(new Set(onlineIds)); 
        });

        // D. Message Deleted
        socket.on('message_deleted', (deletedMsgId) => {
            setMessages((prev) => prev.filter(msg => String(msg.id) !== String(deletedMsgId)));
        });

        // E. Message Updated
        socket.on('message_updated', (updatedMsg) => {
            setMessages((prev) => prev.map(msg => 
                String(msg.id) === String(updatedMsg.id) 
                    ? { ...msg, content: updatedMsg.content, is_edited: 1 } 
                    : msg
            ));
        });

        // F. Message Read Receipts
        socket.on('messages_read_update', ({ reader_id }) => {
            if (selectedChat?.type === 'user' && String(selectedChat.id) === String(reader_id)) {
                setMessages(prev => prev.map(msg => ({ ...msg, status: 'read' })));
            }
        });

        return () => {
            socket.off('receive_message');
            socket.off('group_created');
            socket.off('online_users_update');
            socket.off('message_deleted');
            socket.off('message_updated');
            socket.off('messages_read_update');
        };
    }, [socket, selectedChat, myId]);

    // 3. AUTO SCROLL
    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // --- HANDLERS ---

    // Select a User for Private Chat
    const handleSelectUser = async (user) => {
        setSelectedChat({ type: 'user', id: user.id, name: user.username, avatar: user.avatar });
        // Fetch private messages
        const res = await axios.get(`http://localhost:4000/api/messages?userId=${myId}&otherId=${user.id}`);
        setMessages(res.data);
        // Mark as read
        socket.emit('mark_read', { sender_id: user.id, receiver_id: myId });
    };

    // Select a Group for Group Chat
    const handleSelectGroup = async (group) => {
        setSelectedChat({ type: 'group', id: group.id, name: group.name, avatar: group.avatar });
        // Fetch group messages
        const res = await axios.get(`http://localhost:4000/api/messages?groupId=${group.id}`);
        setMessages(res.data);
    };

    const handleBackToSidebar = () => {
        setSelectedChat(null);
        setMessages([]);
    };

    // Send Message (Unified for Private & Group)
    const sendMessage = () => {
        if (!newMessage.trim() || !selectedChat) return;

        const msgData = {
            sender_id: myId,
            content: newMessage,
            timestamp: new Date().toISOString(),
            // Determine if sending to Group ID or User ID
            group_id: selectedChat.type === 'group' ? selectedChat.id : null,
            receiver_id: selectedChat.type === 'user' ? selectedChat.id : null,
        };

        socket.emit('send_message', msgData);
        setNewMessage("");
        setShowPicker(false);
    };

    // --- CREATE GROUP LOGIC ---
    const createGroup = async () => {
        if (!newGroupName || selectedGroupMembers.length === 0) {
            return alert("Please enter a group name and select at least one member.");
        }
        
        try {
            await axios.post('http://localhost:4000/api/groups', {
                name: newGroupName,
                creatorId: myId,
                members: selectedGroupMembers
            });
            setShowCreateGroupModal(false);
            setNewGroupName("");
            setSelectedGroupMembers([]);
            // Note: The 'group_created' socket event will automatically refresh the list
        } catch (err) {
            console.error(err);
            alert("Failed to create group");
        }
    };

    const toggleMemberSelection = (uid) => {
        if(selectedGroupMembers.includes(uid)) {
            setSelectedGroupMembers(prev => prev.filter(id => id !== uid));
        } else {
            setSelectedGroupMembers(prev => [...prev, uid]);
        }
    };

    // --- EDIT & DELETE LOGIC ---
    const openEditModal = (msg) => {
        setMsgToEdit({ id: msg.id, content: msg.content });
        setShowEditMsgModal(true);
        setShowEditPicker(false);
    };

    const submitEditMessage = async () => {
        try {
            await axios.put(`http://localhost:4000/api/messages/${msgToEdit.id}`, {
                userId: myId,
                newContent: msgToEdit.content
            });
            setShowEditMsgModal(false); 
        } catch (err) {
            alert("Failed to edit message");
        }
    };

    const deleteMessage = async (msgId) => {
        if(!window.confirm("Delete this message?")) return;
        try {
            await axios.delete(`http://localhost:4000/api/messages/${msgId}`, { data: { userId: myId } });
        } catch (error) {
            alert("Failed to delete.");
        }
    };

    // --- PROFILE UPDATE ---
    const handleUpdateProfile = async () => {
        try {
            await axios.put(`http://localhost:4000/api/users/${myProfile.id}`, {
                username: myProfile.username,
                email: myProfile.email,
                avatar: myProfile.avatar
            });
            localStorage.setItem('username', myProfile.username);
            localStorage.setItem('email', myProfile.email);
            localStorage.setItem('avatar', myProfile.avatar);
            alert("Profile Updated!");
            setShowProfileModal(false);
        } catch (error) {
            alert("Update failed.");
        }
    };

    const handleLogout = () => {
        if (socket) socket.disconnect();
        localStorage.clear();
        window.location.href = '/'; 
    };

    // Emoji Handlers
    const onEmojiClick = (emojiObject) => setNewMessage(prev => prev + emojiObject.emoji);
    const onEditEmojiClick = (emojiObject) => setMsgToEdit(prev => ({ ...prev, content: prev.content + emojiObject.emoji }));

    const formatTime = (isoString) => {
        const date = new Date(isoString);
        return date.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
    };

    const leaveGroup = async () => {
        if (!selectedChat || selectedChat.type !== 'group') return;
        
        if (!window.confirm(`Are you sure you want to leave "${selectedChat.name}"?`)) return;

        try {
            // 1. Call API to remove from DB
            await axios.post('http://localhost:4000/api/groups/leave', {
                groupId: selectedChat.id,
                userId: myId
            });

            // 2. Tell Server to remove my socket connection from that room
            socket.emit('leave_group', selectedChat.id);

            // 3. Update UI: Remove group from the list locally
            setGroups((prev) => prev.filter(g => g.id !== selectedChat.id));
            
            // 4. Close the chat window
            setSelectedChat(null);
            setMessages([]);

        } catch (err) {
            console.error(err);
            alert("Failed to leave group.");
        }
    };

    return (
        <div className="chat-layout">
            
            {/* --- MODAL: CREATE GROUP --- */}
            {showCreateGroupModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Create New Group</h3>
                        <label>Group Name</label>
                        <input 
                            value={newGroupName} 
                            onChange={(e) => setNewGroupName(e.target.value)} 
                            placeholder="e.g. Project Team" 
                        />
                        
                        <label>Select Members</label>
                        <div className="member-select-list">
                            {users.map(u => (
                                <div 
                                    key={u.id} 
                                    className={`member-option ${selectedGroupMembers.includes(u.id) ? 'selected' : ''}`}
                                    onClick={() => toggleMemberSelection(u.id)}
                                >
                                    <img src={u.avatar} alt="" />
                                    <span>{u.username}</span>
                                    {selectedGroupMembers.includes(u.id) && <span className="check">✓</span>}
                                </div>
                            ))}
                        </div>

                        <div className="modal-actions">
                            <button onClick={createGroup}>Create Group</button>
                            <button className="cancel-btn" onClick={() => setShowCreateGroupModal(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL: EDIT PROFILE --- */}
            {showProfileModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Edit Profile</h3>
                        <div className="current-avatar">
                            <img src={myProfile.avatar} alt="Current Avatar" />
                        </div>
                        <label>Username</label>
                        <input value={myProfile.username} onChange={(e) => setMyProfile({...myProfile, username: e.target.value})} />
                        <label>Email</label>
                        <input value={myProfile.email} onChange={(e) => setMyProfile({...myProfile, email: e.target.value})} />
                        <button className="secondary-btn" onClick={() => setMyProfile({...myProfile, avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Date.now()}`})}>
                            Generate New Avatar
                        </button>
                        <div className="modal-actions">
                            <button onClick={handleUpdateProfile}>Save</button>
                            <button className="cancel-btn" onClick={() => setShowProfileModal(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL: EDIT MESSAGE --- */}
            {showEditMsgModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Edit Message</h3>
                        <div className="edit-container-wrapper" style={{position: 'relative'}}>
                            <textarea 
                                className="edit-msg-textarea"
                                value={msgToEdit.content}
                                onChange={(e) => setMsgToEdit({...msgToEdit, content: e.target.value})}
                            />
                            <button className="edit-emoji-btn" onClick={() => setShowEditPicker(!showEditPicker)}>😀</button>
                            {showEditPicker && (
                                <div className="edit-emoji-popover">
                                    <EmojiPicker onEmojiClick={onEditEmojiClick} theme="dark" width="100%" height="300px" />
                                </div>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button onClick={submitEditMessage}>Update</button>
                            <button className="cancel-btn" onClick={() => setShowEditMsgModal(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- SIDEBAR --- */}
            <aside className={`sidebar ${selectedChat ? 'mobile-hidden' : ''}`}>
                <div className="sidebar-header">
                    <div className="my-profile-preview" onClick={() => setShowProfileModal(true)}>
                        <img src={myProfile.avatar} alt="Me" />
                        <div>
                            <h4>{myProfile.username}</h4>
                            <span className="status-text">Active Now</span>
                        </div>
                    </div>
                    {/* New Group Button */}
                    <button onClick={() => setShowCreateGroupModal(true)} className="logout-icon" title="New Group" style={{marginRight:'10px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6'}}>
                        +
                    </button>
                    <button onClick={handleLogout} className="logout-icon" title="Logout">➔</button>
                </div>

                <div className="search-bar">
                    <input type="text" placeholder="Search chats..." />
                </div>

                <div className="user-list">
                    
                    {/* GROUPS SECTION */}
                    {groups.length > 0 && <div className="list-section-title">Groups</div>}
                    {groups.map(g => (
                        <div 
                            key={g.id} 
                            className={`user-item ${selectedChat?.id === g.id && selectedChat.type === 'group' ? 'active' : ''}`} 
                            onClick={() => handleSelectGroup(g)}
                        >
                            <div className="user-avatar-container">
                                <img src={g.avatar} alt="grp" />
                            </div>
                            <div className="user-info">
                                <h4>{g.name}</h4>
                                <p>Group Chat</p>
                            </div>
                        </div>
                    ))}

                    {/* USERS SECTION */}
                    <div className="list-section-title">Direct Messages</div>
                    {users.map(user => {
                        const isOnline = onlineUserIds.has(String(user.id));
                        return (
                            <div 
                                key={user.id} 
                                className={`user-item ${selectedChat?.id === user.id && selectedChat.type === 'user' ? 'active' : ''}`}
                                onClick={() => handleSelectUser(user)}
                            >
                                <div className="user-avatar-container">
                                    <img src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`} alt="avatar" />
                                    <div className={`status-dot ${isOnline ? 'online' : 'offline'}`}></div>
                                </div>
                                <div className="user-info">
                                    <h4>{user.username}</h4>
                                    <p>{isOnline ? 'Online' : 'Offline'}</p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </aside>

            {/* --- CHAT AREA --- */}
            <main className={`chat-area ${!selectedChat ? 'mobile-hidden' : ''}`}>
                {!selectedChat ? (
                    <div className="empty-state">
                        <div className="empty-box">
                            <img src="https://cdni.iconscout.com/illustration/premium/thumb/start-chat-illustration-download-in-svg-png-gif-file-formats--message-chatting-bubble-social-media-pack-network-communication-illustrations-3793618.png" alt="Welcome" />
                            <h2>Welcome, {myProfile.username}!</h2>
                            <p>Select a chat or create a group to start messaging.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <header className="chat-header">
                            <button className="back-btn" onClick={handleBackToSidebar}>←</button>
                            <div className="header-user">
                                <img src={selectedChat.avatar} alt="chat" />
                                <div>
                                    <h3>{selectedChat.name}</h3>
                                    {/* Show "Group Chat" or Online Status based on type */}
                                    {selectedChat.type === 'group' ? (
                                        <span className="status-offline">Group Chat</span>
                                    ) : (
                                        <span className={onlineUserIds.has(String(selectedChat.id)) ? "status-online" : "status-offline"}>
                                            {onlineUserIds.has(String(selectedChat.id)) ? "Online" : "Offline"}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* --- NEW: LEAVE GROUP BUTTON --- */}
                            {selectedChat.type === 'group' && (
                                <button className="leave-btn" onClick={leaveGroup} title="Leave Group">
                                    Exit ➜
                                </button>
                            )}
                        </header>

                        <div className="messages-container">
                            {messages.map((msg, index) => {
                                const isMe = String(msg.sender_id) === String(myId);
                                return (
                                    <div key={index} className={`message-row ${isMe ? 'my-row' : 'friend-row'}`}>
                                        <div className={`message-bubble ${isMe ? 'my-bubble' : 'friend-bubble'}`}>
                                            {/* Show Sender Name in Groups (if not me) */}
                                            {!isMe && selectedChat.type === 'group' && <span className="sender-name">{msg.sender_name || 'User'}</span>}
                                            
                                            <p>{msg.content}</p>
                                            
                                            <div className="message-meta">
                                                <span>{formatTime(msg.timestamp)}</span>
                                                {msg.is_edited === 1 && <span className="edited-tag">(edited)</span>}
                                                {/* Read Receipts (Only for My Private Messages) */}
                                                {isMe && selectedChat.type === 'user' && (
                                                    <span className={`status-tick ${msg.status}`}>
                                                        {msg.status === 'sent' && '✓'}
                                                        {msg.status === 'delivered' && '✓✓'}
                                                        {msg.status === 'read' && '✓✓'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Edit/Delete Actions */}
                                        {isMe && (
                                            <div className="message-actions">
                                                <button onClick={() => openEditModal(msg)} title="Edit">✎</button>
                                                <button onClick={() => deleteMessage(msg.id)} title="Delete" className="del">✕</button>
                                            </div>
                                        )}
                                        <div ref={scrollRef}></div>
                                    </div>
                                )
                            })}
                        </div>

                        <div className="chat-input-area">
                            <div className="chat-input-wrapper"> 
                                {showPicker && (
                                    <div className="emoji-picker-popover">
                                        <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
                                    </div>
                                )}
                                <button className="icon-btn" onClick={() => setShowPicker(!showPicker)}>😀</button>
                                <input 
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Type a message..."
                                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                                />
                                <button className="send-btn" onClick={sendMessage}>➤</button>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

export default Chat;