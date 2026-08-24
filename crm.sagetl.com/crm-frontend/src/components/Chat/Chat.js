import React, { useState, useEffect, useRef, useCallback } from "react";
import { ROLES, normalizeRole, canManageUsers } from "../../roles";
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
  faCheck,
  faShieldHalved,
  faPaperclip,
  faImage,
  faFile,
  faFilePdf,
  faFileExcel,
  faDownload,
  faChevronDown
} from "@fortawesome/free-solid-svg-icons";
import { io } from "socket.io-client";
import "./Chat.css";

import { API_BASE_URL } from "../../config";

const Chat = () => {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeTab, setActiveTab] = useState("all"); // 'all', 'direct', 'groups', 'global'
  const [selectedChat, setSelectedChat] = useState({ type: "global" }); // { type: 'global' | 'direct' | 'group', targetId, name, role, details }
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState(""); // Search inside current chat
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Real-time states
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [typingUsers, setTypingUsers] = useState({}); // key: user_ID or group_ID -> typing message
  const [unread, setUnread] = useState({ direct: {}, group: {}, global: 0 }); // unread counts per conversation

  // Attachment Menu
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const fileInputRef = useRef(null);
  const [previewFile, setPreviewFile] = useState(null); // { name, type, size, data }
  const [lightboxImage, setLightboxImage] = useState(null);

  // Create Group Modal State
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const usersRef = useRef(users);
  const typingTimeoutRef = useRef(null);

  const currentUserId = Number(sessionStorage.getItem("userId") || "0");
  const userRole = normalizeRole(sessionStorage.getItem("userRole")) || ROLES.EXECUTIVE;

  // Keep users ref updated for socket operations
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Fetch conversations data (Users and Groups)
  const fetchConversations = useCallback(async () => {
    const token = sessionStorage.getItem("token");
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
    const token = sessionStorage.getItem("token");
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

  // Pull authoritative unread counts from the backend and refresh the nav badge.
  const fetchUnread = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/chat/unread`);
      setUnread({
        direct: res.data?.direct || {},
        group: res.data?.group || {},
        global: res.data?.global || 0,
      });
      window.dispatchEvent(new Event("chat:unread-changed"));
    } catch (err) {
      // Silent — badges simply won't update.
    }
  }, []);

  // Mark current chat messages as read
  const markChatAsRead = useCallback(async () => {
    const token = sessionStorage.getItem("token");
    if (!token || !selectedChat) return;

    try {
      let targetId = selectedChat.targetId;
      if (selectedChat.type === "global") targetId = "global";
      if (!targetId && selectedChat.type !== "global") return;

      // Optimistically clear this conversation's badge immediately.
      setUnread((prev) => {
        const next = { direct: { ...prev.direct }, group: { ...prev.group }, global: prev.global };
        if (selectedChat.type === "direct") delete next.direct[selectedChat.targetId];
        else if (selectedChat.type === "group") delete next.group[selectedChat.targetId];
        else if (selectedChat.type === "global") next.global = 0;
        return next;
      });

      await axios.post(
        `${API_BASE_URL}/api/chat/messages/read`,
        { type: selectedChat.type, targetId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchUnread();
    } catch (err) {
      console.error("Error marking messages as read:", err);
    }
  }, [selectedChat, fetchUnread]);

  // Initial fetch
  useEffect(() => {
    fetchConversations();
    fetchUnread();
  }, [fetchConversations, fetchUnread]);

  useEffect(() => {
    fetchActiveMessages();
  }, [fetchActiveMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Mark read on tab open
  useEffect(() => {
    markChatAsRead();
  }, [selectedChat, markChatAsRead]);

  // Socket Connection and Event Binding
  useEffect(() => {
    const socket = io(API_BASE_URL);
    socketRef.current = socket;

    socket.emit("register", currentUserId);

    socket.on("online_users_list", (userIds) => {
      setOnlineUserIds(userIds.map(Number));
    });

    socket.on("user_status", ({ userId, status }) => {
      const uId = Number(userId);
      setOnlineUserIds((prev) => {
        if (status === "online") {
          return prev.includes(uId) ? prev : [...prev, uId];
        } else {
          return prev.filter((id) => id !== uId);
        }
      });
    });

    socket.on("user_typing", ({ senderId, isTyping, groupId, type }) => {
      const uId = Number(senderId);
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (type === "direct") {
          const key = `user_${uId}`;
          if (isTyping) {
            next[key] = true;
          } else {
            delete next[key];
          }
        } else if (type === "group" && groupId) {
          const key = `group_${groupId}`;
          const senderUser = usersRef.current.find((u) => u.id === uId);
          const senderName = senderUser ? senderUser.name : "Someone";
          if (isTyping) {
            next[key] = `${senderName} is typing...`;
          } else {
            delete next[key];
          }
        }
        return next;
      });
    });

    socket.on("new_message", (message) => {
      setSelectedChat((currentChat) => {
        const isCurrent =
          (message.type === "global" && currentChat.type === "global") ||
          (message.type === "direct" &&
            currentChat.type === "direct" &&
            (message.senderId === currentChat.targetId || message.recipientId === currentChat.targetId)) ||
          (message.type === "group" && currentChat.type === "group" && message.groupId === currentChat.targetId);

        if (isCurrent) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });

          // Mark message as read immediately if it's from the other person
          if (message.senderId !== currentUserId) {
            axios.post(
              `${API_BASE_URL}/api/chat/messages/read`,
              {
                type: message.type,
                targetId: message.type === "direct" ? message.senderId : message.groupId
              },
              { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } }
            ).catch(err => console.error("Error auto-reading message:", err));
          }
        } else if (message.senderId !== currentUserId) {
          // Not the active chat — bump the unread badge for that conversation.
          setUnread((prev) => {
            const next = { direct: { ...prev.direct }, group: { ...prev.group }, global: prev.global };
            if (message.type === "direct") {
              next.direct[message.senderId] = (next.direct[message.senderId] || 0) + 1;
            } else if (message.type === "group") {
              next.group[message.groupId] = (next.group[message.groupId] || 0) + 1;
            } else if (message.type === "global") {
              next.global = (next.global || 0) + 1;
            }
            return next;
          });
          window.dispatchEvent(new Event("chat:unread-changed"));
        }

        fetchConversations();
        return currentChat;
      });
    });

    socket.on("messages_read", ({ readerId, type, targetId }) => {
      setSelectedChat((currentChat) => {
        const isMatch =
          (type === "direct" && currentChat.type === "direct" && Number(readerId) === currentChat.targetId) ||
          (type === "group" && currentChat.type === "group" && Number(targetId) === currentChat.targetId);

        if (isMatch) {
          setMessages((prev) =>
            prev.map((m) => {
              const currentReadBy = m.readBy || [];
              if (m.senderId === currentUserId && !currentReadBy.includes(Number(readerId))) {
                return { ...m, readBy: [...currentReadBy, Number(readerId)] };
              }
              return m;
            })
          );
        }
        return currentChat;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [currentUserId, fetchConversations]);

  // Join group rooms automatically when groups load
  useEffect(() => {
    if (socketRef.current && groups.length > 0) {
      groups.forEach((g) => {
        socketRef.current.emit("join_group", g.id);
      });
    }
  }, [groups]);

  // Emits Typing status to server
  const emitTyping = (isTyping) => {
    if (!socketRef.current || !selectedChat) return;

    socketRef.current.emit("typing", {
      type: selectedChat.type,
      recipientId: selectedChat.type === "direct" ? selectedChat.targetId : null,
      groupId: selectedChat.type === "group" ? selectedChat.targetId : null,
      isTyping
    });
  };

  const handleInputChange = (e) => {
    setMessageInput(e.target.value);
    emitTyping(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(false);
    }, 2000);
  };

  // Handle Sending Message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((!messageInput.trim() && !previewFile) || isSending) return;

    const token = sessionStorage.getItem("token");
    if (!token) return;

    setIsSending(true);

    let content = messageInput.trim();

    // If there is an attachment, format the content as JSON
    if (previewFile) {
      content = JSON.stringify({
        isAttachment: true,
        fileName: previewFile.name,
        fileType: previewFile.type,
        fileSize: previewFile.size,
        fileData: previewFile.data
      });
    }

    setMessageInput("");
    setPreviewFile(null);
    emitTyping(false);

    try {
      let endpoint = "";
      let payload = {};

      if (selectedChat.type === "global") {
        if (!canManageUsers(userRole)) {
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

      // Optimistically add or wait for socket event
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });

      fetchConversations();
    } catch (err) {
      console.error("Error sending message:", err);
      alert("Failed to send message. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  // Handle Attachment Selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size limit (max 8MB for base64 safety in React state)
    if (file.size > 8 * 1024 * 1024) {
      alert("File is too large. Max limit is 8MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const sizeStr =
        file.size > 1024 * 1024
          ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
          : `${(file.size / 1024).toFixed(0)} KB`;

      setPreviewFile({
        name: file.name,
        type: file.type,
        size: sizeStr,
        data: reader.result
      });
      setShowAttachmentMenu(false);
    };
    reader.readAsDataURL(file);
  };

  // Download custom base64 file attachments
  const downloadAttachment = (fileName, dataUrl) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Create Group Submission
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    const token = sessionStorage.getItem("token");
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

  // Filter messages based on chat internal search
  const filteredMessages = messages.filter((m) => {
    if (!chatSearchQuery.trim()) return true;

    try {
      const parsed = JSON.parse(m.content);
      if (parsed.isAttachment) {
        return parsed.fileName.toLowerCase().includes(chatSearchQuery.toLowerCase());
      }
    } catch (e) {
      // String content
    }
    return m.content.toLowerCase().includes(chatSearchQuery.toLowerCase());
  });

  // Render message tick checks
  const renderMessageTicks = (m) => {
    if (m.senderId !== currentUserId) return null;

    const readBy = m.readBy || [];

    if (selectedChat.type === "direct") {
      const recipientId = selectedChat.targetId;
      const isRead = readBy.includes(recipientId);
      const isOnline = onlineUserIds.includes(recipientId);

      if (isRead) {
        return <FontAwesomeIcon icon={faCheckDouble} className="tick-icon tick-blue" />;
      } else if (isOnline) {
        return <FontAwesomeIcon icon={faCheckDouble} className="tick-icon tick-gray" />;
      } else {
        return <FontAwesomeIcon icon={faCheck} className="tick-icon tick-gray" />;
      }
    } else {
      // Group or Global messages (blue if readBy length > 1, meaning someone besides sender read it)
      const isRead = readBy.length > 1;
      if (isRead) {
        return <FontAwesomeIcon icon={faCheckDouble} className="tick-icon tick-blue" />;
      } else {
        return <FontAwesomeIcon icon={faCheckDouble} className="tick-icon tick-gray" />;
      }
    }
  };

  // Parse and render message content (Text or File Attachment)
  const renderMessageBody = (content) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.isAttachment) {
        const isImage = parsed.fileType?.startsWith("image/");

        if (isImage) {
          return (
            <div className="message-attachment-image">
              <img
                src={parsed.fileData}
                alt={parsed.fileName}
                onClick={() => setLightboxImage(parsed.fileData)}
                className="img-preview-bubble"
              />
              <div className="attachment-info-row">
                <span className="file-name-text">{parsed.fileName}</span>
                <button
                  type="button"
                  className="btn-download-bubble"
                  onClick={() => downloadAttachment(parsed.fileName, parsed.fileData)}
                  title="Download Image"
                >
                  <FontAwesomeIcon icon={faDownload} />
                </button>
              </div>
            </div>
          );
        } else {
          // Document / PDF / Sheet
          const isPdf = parsed.fileType === "application/pdf" || parsed.fileName.endsWith(".pdf");
          const isExcel =
            parsed.fileType?.includes("sheet") ||
            parsed.fileType?.includes("excel") ||
            parsed.fileName.endsWith(".xlsx") ||
            parsed.fileName.endsWith(".xls");

          let docIcon = faFile;
          if (isPdf) docIcon = faFilePdf;
          else if (isExcel) docIcon = faFileExcel;

          return (
            <div className="message-attachment-doc">
              <div className="doc-icon-container">
                <FontAwesomeIcon icon={docIcon} className="doc-icon-graphic" />
              </div>
              <div className="doc-meta-info">
                <span className="doc-name">{parsed.fileName}</span>
                <span className="doc-size">{parsed.fileSize}</span>
              </div>
              <button
                type="button"
                className="btn-download-bubble"
                onClick={() => downloadAttachment(parsed.fileName, parsed.fileData)}
                title="Download File"
              >
                <FontAwesomeIcon icon={faDownload} />
              </button>
            </div>
          );
        }
      }
    } catch (e) {
      // Fallback to normal text string
    }

    return <p className="message-content">{content}</p>;
  };

  return (
    <div className="chat-container">
      {/* Sidebar Conversation Panel */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <div className="sidebar-brand-title">
            <h2>Chats</h2>
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
              placeholder="Search or start a new chat"
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
              className={`chat-list-item global-item ${selectedChat.type === "global" ? "active" : ""} ${unread.global > 0 ? "has-unread" : ""}`}
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
              {unread.global > 0 && (
                <span className="chat-unread-badge">{unread.global > 99 ? "99+" : unread.global}</span>
              )}
            </div>
          )}

          {/* Group Chats */}
          {(activeTab === "all" || activeTab === "groups") && filteredGroups.length > 0 && (
            <div className="chat-list-section-label">Groups</div>
          )}
          {(activeTab === "all" || activeTab === "groups") &&
            filteredGroups.map((g) => {
              const groupTypingStatus = typingUsers[`group_${g.id}`];
              const groupUnread = unread.group[g.id] || 0;

              return (
                <div
                  key={`group-${g.id}`}
                  className={`chat-list-item ${selectedChat.type === "group" && selectedChat.targetId === g.id ? "active" : ""} ${groupUnread > 0 ? "has-unread" : ""}`}
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
                      {groupTypingStatus ? (
                        <span className="typing-text-sidebar">{groupTypingStatus}</span>
                      ) : (
                        g.description || `${g.members?.length || 0} Members`
                      )}
                    </span>
                  </div>
                  {groupUnread > 0 && (
                    <span className="chat-unread-badge">{groupUnread > 99 ? "99+" : groupUnread}</span>
                  )}
                </div>
              );
            })}

          {/* Direct Contact Users */}
          {(activeTab === "all" || activeTab === "direct") && filteredUsers.length > 0 && (
            <div className="chat-list-section-label">Direct Messages</div>
          )}
          {(activeTab === "all" || activeTab === "direct") &&
            filteredUsers.map((u) => {
              const isOnline = onlineUserIds.includes(u.id);
              const isUserTyping = typingUsers[`user_${u.id}`];
              const userUnread = unread.direct[u.id] || 0;

              return (
                <div
                  key={`user-${u.id}`}
                  className={`chat-list-item ${selectedChat.type === "direct" && selectedChat.targetId === u.id ? "active" : ""} ${userUnread > 0 ? "has-unread" : ""}`}
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
                  <div className={`chat-avatar user-avatar avatar-role-${u.role}`}>
                    {u.name.substring(0, 2).toUpperCase()}
                    {isOnline && <span className="online-indicator-dot"></span>}
                  </div>
                  <div className="chat-item-info">
                    <div className="item-title-row">
                      <span className="chat-item-name">{u.name}</span>
                      <span className={`role-pill role-${u.role}`}>
                        {u.role}
                      </span>
                    </div>
                    <span className="chat-item-sub">
                      {isUserTyping ? (
                        <span className="typing-text-sidebar">typing...</span>
                      ) : (
                        u.email
                      )}
                    </span>
                  </div>
                  {userUnread > 0 && (
                    <span className="chat-unread-badge">{userUnread > 99 ? "99+" : userUnread}</span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Main Message Active Window */}
      <div className="chat-main-window">
        {/* Active Chat Header */}
        <div className="chat-main-header">
          <div className="active-chat-info">
            <div className={`chat-avatar ${selectedChat.type === 'global' ? 'global-avatar' : selectedChat.type === 'group' ? 'group-avatar' : `user-avatar avatar-role-${selectedChat.role}`}`}>
              {selectedChat.type === 'global' ? (
                <FontAwesomeIcon icon={faBullhorn} />
              ) : selectedChat.type === 'group' ? (
                <FontAwesomeIcon icon={faUsers} />
              ) : (
                (selectedChat.name || "U").substring(0, 2).toUpperCase()
              )}
              {selectedChat.type === 'direct' && onlineUserIds.includes(selectedChat.targetId) && (
                <span className="online-indicator-dot header-dot"></span>
              )}
            </div>
            <div>
              <h3 className="active-chat-title">{selectedChat.name || "Global Announcements"}</h3>
              <p className="active-chat-sub">
                {selectedChat.type === "global" ? (
                  "Official Broadcast Channel"
                ) : selectedChat.type === "group" ? (
                  typingUsers[`group_${selectedChat.targetId}`] || selectedChat.details || "Group Chat"
                ) : (
                  typingUsers[`user_${selectedChat.targetId}`] ? (
                    <span className="typing-text-header">typing...</span>
                  ) : (
                    onlineUserIds.includes(selectedChat.targetId) ? "Online" : "Offline"
                  )
                )}
              </p>
            </div>
          </div>

          <div className="chat-header-actions">
            {/* Search inside Chat Button */}
            <button
              type="button"
              className={`btn-header-action ${showChatSearch ? "active" : ""}`}
              onClick={() => setShowChatSearch(!showChatSearch)}
              title="Search Messages"
            >
              <FontAwesomeIcon icon={faSearch} />
            </button>

            {selectedChat.type === "global" && (
              <div className="global-channel-indicator">
                <FontAwesomeIcon icon={faShieldHalved} />
                <span>{canManageUsers(userRole) ? "Broadcast Authorized" : "Read Only"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Chat Search Box overlay if toggled */}
        {showChatSearch && (
          <div className="chat-messages-search-overlay">
            <div className="search-input-wrapper">
              <FontAwesomeIcon icon={faSearch} className="search-icon" />
              <input
                type="text"
                placeholder="Search messages in this chat..."
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                autoFocus
              />
              {chatSearchQuery && (
                <button
                  type="button"
                  className="btn-clear-search"
                  onClick={() => setChatSearchQuery("")}
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn-close-search-overlay"
              onClick={() => {
                setShowChatSearch(false);
                setChatSearchQuery("");
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Message Thread Scroll Area */}
        <div className="chat-messages-area">
          {isLoadingMessages ? (
            <div className="messages-loading">
              <FontAwesomeIcon icon={faSpinner} spin className="spinner-icon" />
              <span>Loading messages...</span>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="messages-empty">
              <p>
                {chatSearchQuery
                  ? "No messages found matching search query."
                  : "No messages in this conversation yet. Start the discussion!"}
              </p>
            </div>
          ) : (
            filteredMessages.map((m) => {
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
                      <div className="global-card-body">{renderMessageBody(m.content)}</div>
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
                    
                    {/* Render message text or attachment file */}
                    {renderMessageBody(m.content)}

                    <div className="message-footer">
                      <span className="message-time">{formatTime(m.createdAt)}</span>
                      {isMine && renderMessageTicks(m)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* File Preview Bar if a file is ready to send */}
        {previewFile && (
          <div className="chat-upload-preview-bar">
            <div className="file-details">
              <FontAwesomeIcon
                icon={previewFile.type.startsWith("image/") ? faImage : faFile}
                className="preview-type-icon"
              />
              <span className="preview-file-name" title={previewFile.name}>
                {previewFile.name}
              </span>
              <span className="preview-file-size">({previewFile.size})</span>
            </div>
            <div className="preview-actions">
              {previewFile.type.startsWith("image/") && (
                <img
                  src={previewFile.data}
                  alt="preview thumbnail"
                  className="preview-thumbnail"
                />
              )}
              <button
                type="button"
                className="btn-cancel-preview"
                onClick={() => setPreviewFile(null)}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
          </div>
        )}

        {/* Message Input Bar */}
        <form onSubmit={handleSendMessage} className="chat-input-bar">
          <div className="chat-input-left-controls">
            {/* Paperclip Button for attachments */}
            <button
              type="button"
              className={`btn-input-control btn-attach ${showAttachmentMenu ? "active" : ""}`}
              onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
              title="Add attachment"
              disabled={selectedChat.type === "global" && !canManageUsers(userRole)}
            >
              <FontAwesomeIcon icon={faPaperclip} />
            </button>

            {/* Attachment Dropdown Menu */}
            {showAttachmentMenu && (
              <div className="attachment-dropdown-menu">
                <button
                  type="button"
                  className="attachment-menu-item"
                  onClick={() => {
                    fileInputRef.current.click();
                    setShowAttachmentMenu(false);
                  }}
                >
                  <FontAwesomeIcon icon={faImage} className="item-icon icon-image" />
                  <span>Photos & Videos</span>
                </button>
                <button
                  type="button"
                  className="attachment-menu-item"
                  onClick={() => {
                    fileInputRef.current.click();
                    setShowAttachmentMenu(false);
                  }}
                >
                  <FontAwesomeIcon icon={faFile} className="item-icon icon-doc" />
                  <span>Document</span>
                </button>
              </div>
            )}

            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />
          </div>

          <input
            type="text"
            placeholder={
              selectedChat.type === "global"
                ? canManageUsers(userRole)
                  ? "Broadcast global announcement to all users..."
                  : "Only Administrators can post in Global Announcements"
                : previewFile
                  ? `Write a caption for ${previewFile.name}...`
                  : "Type a message..."
            }
            value={messageInput}
            onChange={handleInputChange}
            disabled={selectedChat.type === "global" && !canManageUsers(userRole)}
          />

          <button
            type="submit"
            className="btn-send-message"
            disabled={
              (!messageInput.trim() && !previewFile) ||
              isSending ||
              (selectedChat.type === "global" && !canManageUsers(userRole))
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

      {/* Lightbox Modal for zooming attachments */}
      {lightboxImage && (
        <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <div className="lightbox-container">
            <button className="lightbox-close-btn" onClick={() => setLightboxImage(null)}>
              <FontAwesomeIcon icon={faTimes} />
            </button>
            <img src={lightboxImage} alt="lightbox zoom" className="lightbox-img" />
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
