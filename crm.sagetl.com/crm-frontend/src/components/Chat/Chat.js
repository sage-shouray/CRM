import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPaperPlane,
  faBullhorn,
  faUsers,
  faUser,
  faPlus,
  faSearch,
  faSpinner,
  faTimes,
  faCheckDouble,
  faShieldHalved
} from "@fortawesome/free-solid-svg-icons";
import "./Chat.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:4100";

const Chat = () => {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeTab, setActiveTab] = useState("all"); // 'all', 'direct', 'groups', 'global'
  const [selectedChat, setSelectedChat] = useState({ type: "global" }); // { type: 'global' | 'direct' | 'group', targetId, name, role, details }
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Create Group Modal State
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const messagesEndRef = useRef(null);
  const currentUserId = Number(localStorage.getItem("userId") || "0");
  const userRole = (localStorage.getItem("userRole") || "subuser").toLowerCase();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Fetch conversations data (Users and Groups)
  const fetchConversations = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const [usersRes, groupsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/chat/users`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/chat/groups`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      setUsers(usersRes.data || []);
      setGroups(groupsRes.data || []);
    } catch (err) {
      console.error("Error fetching chat conversations:", err);
    }
  }, []);

  // Fetch messages for currently selected chat
  const fetchActiveMessages = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token || !selectedChat) return;

    setIsLoadingMessages(true);
    try {
      let res;
      if (selectedChat.type === "global") {
        res = await axios.get(`${API_BASE_URL}/api/chat/messages/global`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else if (selectedChat.type === "direct") {
        res = await axios.get(`${API_BASE_URL}/api/chat/messages/direct/${selectedChat.targetId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else if (selectedChat.type === "group") {
        res = await axios.get(`${API_BASE_URL}/api/chat/messages/group/${selectedChat.targetId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      setMessages(res?.data || []);
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [selectedChat]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    fetchActiveMessages();
  }, [fetchActiveMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Polling interval for live chat updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchActiveMessages();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchActiveMessages]);

  // Handle Sending Message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageInput.trim() || isSending) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    setIsSending(true);
    const content = messageInput.trim();
    setMessageInput("");

    try {
      let endpoint = "";
      let payload = {};

      if (selectedChat.type === "global") {
        if (userRole !== "admin") {
          alert("Only Administrators can post global announcements.");
          setIsSending(false);
          return;
        }
        endpoint = `${API_BASE_URL}/api/chat/messages/global`;
        payload = { content };
      } else if (selectedChat.type === "direct") {
        endpoint = `${API_BASE_URL}/api/chat/messages/direct`;
        payload = { recipientId: selectedChat.targetId, content };
      } else if (selectedChat.type === "group") {
        endpoint = `${API_BASE_URL}/api/chat/messages/group`;
        payload = { groupId: selectedChat.targetId, content };
      }

      const res = await axios.post(endpoint, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setMessages((prev) => [...prev, res.data]);
    } catch (err) {
      console.error("Error sending message:", err);
      alert("Failed to send message. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  // Handle Create Group Submission
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    setIsCreatingGroup(true);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/chat/groups`,
        {
          name: groupName.trim(),
          description: groupDesc.trim(),
          memberIds: selectedMemberIds
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setGroups((prev) => [res.data, ...prev]);
      setShowGroupModal(false);
      setGroupName("");
      setGroupDesc("");
      setSelectedMemberIds([]);

      // Auto-select newly created group
      setSelectedChat({
        type: "group",
        targetId: res.data.id,
        name: res.data.name,
        details: `${res.data.members.length} Members`
      });
    } catch (err) {
      console.error("Error creating group:", err);
      alert("Failed to create group.");
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const toggleMemberSelection = (id) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((mId) => mId !== id) : [...prev, id]
    );
  };

  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (isoString) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="chat-container">
      {/* Sidebar Conversation Panel */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <div className="sidebar-brand-title">
            <h2>Messages & Chat</h2>
            <button
              className="btn-new-group"
              onClick={() => setShowGroupModal(true)}
              title="Create New Group Chat"
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>Group</span>
            </button>
          </div>

          <div className="chat-search-box">
            <FontAwesomeIcon icon={faSearch} className="search-icon" />
            <input
              type="text"
              placeholder="Search contacts or groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="chat-tabs">
            <button
              className={`chat-tab-btn ${activeTab === "all" ? "active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              All
            </button>
            <button
              className={`chat-tab-btn ${activeTab === "direct" ? "active" : ""}`}
              onClick={() => setActiveTab("direct")}
            >
              Direct
            </button>
            <button
              className={`chat-tab-btn ${activeTab === "groups" ? "active" : ""}`}
              onClick={() => setActiveTab("groups")}
            >
              Groups
            </button>
            <button
              className={`chat-tab-btn ${activeTab === "global" ? "active" : ""}`}
              onClick={() => setActiveTab("global")}
            >
              Global
            </button>
          </div>
        </div>

        <div className="chat-list-container">
          {/* Global Broadcast Channel (Always Visible) */}
          {(activeTab === "all" || activeTab === "global") && (
            <div
              className={`chat-list-item global-item ${selectedChat.type === "global" ? "active" : ""}`}
              onClick={() =>
                setSelectedChat({
                  type: "global",
                  name: "Global Announcements",
                  details: "Official Company Broadcast"
                })
              }
            >
              <div className="chat-avatar global-avatar">
                <FontAwesomeIcon icon={faBullhorn} />
              </div>
              <div className="chat-item-info">
                <div className="item-title-row">
                  <span className="chat-item-name">Global Announcements</span>
                  <span className="global-badge">Broadcast</span>
                </div>
                <span className="chat-item-sub">Visible to all CRM users</span>
              </div>
            </div>
          )}

          {/* Group Chats */}
          {(activeTab === "all" || activeTab === "groups") &&
            filteredGroups.map((g) => (
              <div
                key={`group-${g.id}`}
                className={`chat-list-item ${selectedChat.type === "group" && selectedChat.targetId === g.id ? "active" : ""}`}
                onClick={() =>
                  setSelectedChat({
                    type: "group",
                    targetId: g.id,
                    name: g.name,
                    details: `${g.members?.length || 0} Members`
                  })
                }
              >
                <div className="chat-avatar group-avatar">
                  <FontAwesomeIcon icon={faUsers} />
                </div>
                <div className="chat-item-info">
                  <div className="item-title-row">
                    <span className="chat-item-name">{g.name}</span>
                  </div>
                  <span className="chat-item-sub">
                    {g.description || `${g.members?.length || 0} Members`}
                  </span>
                </div>
              </div>
            ))}

          {/* Direct Contact Users */}
          {(activeTab === "all" || activeTab === "direct") &&
            filteredUsers.map((u) => (
              <div
                key={`user-${u.id}`}
                className={`chat-list-item ${selectedChat.type === "direct" && selectedChat.targetId === u.id ? "active" : ""}`}
                onClick={() =>
                  setSelectedChat({
                    type: "direct",
                    targetId: u.id,
                    name: u.name,
                    role: u.role,
                    details: u.designation || u.role.toUpperCase()
                  })
                }
              >
                <div className="chat-avatar user-avatar">
                  {u.name.substring(0, 2).toUpperCase()}
                </div>
                <div className="chat-item-info">
                  <div className="item-title-row">
                    <span className="chat-item-name">{u.name}</span>
                    <span className={`role-pill role-${u.role}`}>
                      {u.role}
                    </span>
                  </div>
                  <span className="chat-item-sub">{u.email}</span>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Main Message Active Window */}
      <div className="chat-main-window">
        {/* Active Chat Header */}
        <div className="chat-main-header">
          <div className="active-chat-info">
            <div className={`chat-avatar ${selectedChat.type === 'global' ? 'global-avatar' : selectedChat.type === 'group' ? 'group-avatar' : 'user-avatar'}`}>
              {selectedChat.type === 'global' ? (
                <FontAwesomeIcon icon={faBullhorn} />
              ) : selectedChat.type === 'group' ? (
                <FontAwesomeIcon icon={faUsers} />
              ) : (
                (selectedChat.name || "U").substring(0, 2).toUpperCase()
              )}
            </div>
            <div>
              <h3 className="active-chat-title">{selectedChat.name || "Global Announcements"}</h3>
              <p className="active-chat-sub">{selectedChat.details || "Official Broadcast Channel"}</p>
            </div>
          </div>

          {selectedChat.type === "global" && (
            <div className="global-channel-indicator">
              <FontAwesomeIcon icon={faShieldHalved} />
              <span>{userRole === "admin" ? "Admin Broadcast Authorized" : "Read Only for Team Members"}</span>
            </div>
          )}
        </div>

        {/* Message Thread Scroll Area */}
        <div className="chat-messages-area">
          {isLoadingMessages ? (
            <div className="messages-loading">
              <FontAwesomeIcon icon={faSpinner} spin className="spinner-icon" />
              <span>Loading messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="messages-empty">
              <p>No messages in this conversation yet. Start the discussion!</p>
            </div>
          ) : (
            messages.map((m) => {
              const isMine = m.senderId === currentUserId;
              const isGlobal = m.isGlobal;

              if (isGlobal) {
                return (
                  <div key={m.id} className="message-row global-message-row">
                    <div className="global-announcement-card">
                      <div className="global-card-header">
                        <FontAwesomeIcon icon={faBullhorn} />
                        <span>Company Announcement</span>
                        <span className="global-sender-name">by {m.senderName}</span>
                      </div>
                      <p className="global-card-body">{m.content}</p>
                      <span className="global-card-time">{formatTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id} className={`message-row ${isMine ? "sent-row" : "received-row"}`}>
                  <div className={`message-bubble ${isMine ? "sent-bubble" : "received-bubble"}`}>
                    {!isMine && (
                      <div className="message-sender-tag">
                        <span className="sender-name">{m.senderName}</span>
                        {m.senderRole && <span className={`sender-role role-${m.senderRole}`}>{m.senderRole}</span>}
                      </div>
                    )}
                    <p className="message-content">{m.content}</p>
                    <div className="message-footer">
                      <span className="message-time">{formatTime(m.createdAt)}</span>
                      {isMine && <FontAwesomeIcon icon={faCheckDouble} className="read-icon" />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input Bar */}
        <form onSubmit={handleSendMessage} className="chat-input-bar">
          <input
            type="text"
            placeholder={
              selectedChat.type === "global"
                ? userRole === "admin"
                  ? "Broadcast global announcement to all users..."
                  : "Only Administrators can post in Global Announcements"
                : "Type a message..."
            }
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            disabled={selectedChat.type === "global" && userRole !== "admin"}
          />
          <button
            type="submit"
            className="btn-send-message"
            disabled={
              !messageInput.trim() ||
              isSending ||
              (selectedChat.type === "global" && userRole !== "admin")
            }
          >
            {isSending ? (
              <FontAwesomeIcon icon={faSpinner} spin />
            ) : (
              <FontAwesomeIcon icon={faPaperPlane} />
            )}
          </button>
        </form>
      </div>

      {/* Create Group Modal */}
      {showGroupModal && (
        <div className="modal-overlay">
          <div className="create-group-modal">
            <div className="modal-header">
              <h2>Create New Group Chat</h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowGroupModal(false)}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>

            <form onSubmit={handleCreateGroup}>
              <div className="form-group-modal">
                <label htmlFor="groupName">Group Name *</label>
                <input
                  type="text"
                  id="groupName"
                  placeholder="e.g. Sales Team, SAP Project..."
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group-modal">
                <label htmlFor="groupDesc">Description (Optional)</label>
                <input
                  type="text"
                  id="groupDesc"
                  placeholder="Short group description"
                  value={groupDesc}
                  onChange={(e) => setGroupDesc(e.target.value)}
                />
              </div>

              <div className="form-group-modal">
                <label>Select Group Members</label>
                <div className="members-selection-list">
                  {users.map((u) => (
                    <label key={`select-user-${u.id}`} className="member-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(u.id)}
                        onChange={() => toggleMemberSelection(u.id)}
                      />
                      <span className="member-name-text">{u.name} ({u.role})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="modal-actions-row">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowGroupModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit-group"
                  disabled={!groupName.trim() || isCreatingGroup}
                >
                  {isCreatingGroup ? (
                    <FontAwesomeIcon icon={faSpinner} spin />
                  ) : (
                    "Create Group"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
