"use client";

import { useEffect, useState } from "react";
import { useChatStream, CitationEvent } from "../hooks/useChatStream";
import { ChatWindow, ChatMessage } from "../components/ChatWindow";

interface DocumentInfo {
  id: string;
  title: string;
  originalName: string;
  fileType: string;
  status: string;
  pageCount: number;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export default function ChatPage() {
  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [authError, setAuthError] = useState("");

  // App state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [chatMode, setChatMode] = useState<"study" | "quiz" | "flashcard">("study");

  const [inputMessage, setInputMessage] = useState("");
  const [activeCitation, setActiveCitation] = useState<CitationEvent | null>(null);

  // Hook usage
  const {
    streamingText,
    citations: streamingCitations,
    isStreaming,
    error: streamError,
    sendStreamRequest,
  } = useChatStream(token);

  // Load token on startup
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  // Fetch conversations and documents once token is available
  useEffect(() => {
    if (token) {
      fetchConversations();
      fetchDocuments();
    }
  }, [token]);

  // Fetch messages when active conversation changes
  useEffect(() => {
    if (token && activeConvId) {
      fetchChatHistory(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId, token]);

  const fetchConversations = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/v1/chat/list", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.warn("Failed to fetch conversations:", err);
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/v1/documents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.warn("Failed to fetch documents:", err);
    }
  };

  const fetchChatHistory = async (convId: string) => {
    try {
      const res = await fetch(`http://localhost:3001/api/v1/chat/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = data.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations ? (m.citations as CitationEvent[]) : undefined,
        }));
        setMessages(mapped);
      }
    } catch (err) {
      console.warn("Failed to fetch chat history:", err);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const endpoint = isRegister ? "register" : "login";
    const payload = isRegister ? { email, password, name } : { email, password };

    try {
      const res = await fetch(`http://localhost:3001/api/v1/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Authentication failed");
      }

      const data = await res.json();
      if (data.accessToken) {
        localStorage.setItem("token", data.accessToken);
        setToken(data.accessToken);
      } else if (isRegister) {
        setIsRegister(false);
        setAuthError("Registration successful! Please login.");
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setConversations([]);
    setActiveConvId(null);
    setMessages([]);
  };

  const toggleDocumentSelection = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const startNewConversation = () => {
    setActiveConvId(null);
    setMessages([]);
  };

  const submitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isStreaming) return;

    const queryText = inputMessage;
    setInputMessage("");

    // Optimistically add user bubble
    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      role: "USER",
      content: queryText,
    };
    setMessages((prev) => [...prev, userMsg]);

    const resultId = await sendStreamRequest(
      queryText,
      activeConvId || undefined,
      selectedDocIds,
      chatMode
    );

    if (resultId) {
      setActiveConvId(resultId);
      fetchChatHistory(resultId);
      fetchConversations();
    }
  };

  // If not authenticated, show Login/Registration UI
  if (!token) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div className="bg-glow-1" />
        <div className="bg-glow-2" />
        
        <div className="glass-panel" style={{ width: "100%", maxWidth: "420px", zIndex: 10 }}>
          <h2 style={{ fontSize: "2rem", textAlign: "center", marginBottom: "8px", background: "linear-gradient(135deg, #ffffff, #a5a6c2)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {isRegister ? "Create Account" : "Welcome Back"}
          </h2>
          <p style={{ color: "var(--color-text-secondary)", textAlign: "center", fontSize: "0.95rem", marginBottom: "24px" }}>
            {isRegister ? "Sign up to start chatting with your study materials" : "Login to access your AI Study Assistant"}
          </p>

          <form onSubmit={handleAuth} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {isRegister && (
              <div>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  style={{ width: "100%", padding: "12px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", borderRadius: "8px", color: "#fff", outline: "none" }}
                />
              </div>
            )}
            <div>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: "100%", padding: "12px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", borderRadius: "8px", color: "#fff", outline: "none" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: "100%", padding: "12px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--glass-border)", borderRadius: "8px", color: "#fff", outline: "none" }}
              />
            </div>

            {authError && (
              <p style={{ color: "var(--color-error)", fontSize: "0.85rem", textAlign: "center" }}>
                {authError}
              </p>
            )}

            <button
              type="submit"
              style={{ width: "100%", padding: "14px", background: "var(--color-primary)", border: "none", borderRadius: "8px", color: "#fff", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
            >
              {isRegister ? "Sign Up" : "Sign In"}
            </button>
          </form>

          <p style={{ textAlign: "center", fontSize: "0.85rem", marginTop: "20px", color: "var(--color-text-secondary)" }}>
            {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => { setIsRegister(!isRegister); setAuthError(""); }}
              style={{ background: "none", border: "none", color: "var(--color-secondary)", fontWeight: 600, cursor: "pointer" }}
            >
              {isRegister ? "Sign In" : "Sign Up"}
            </button>
          </p>
        </div>
      </main>
    );
  }

  // Dashboard & Chat Viewport
  return (
    <main style={{ height: "100vh", display: "flex", background: "var(--bg-primary)", position: "relative", overflow: "hidden" }}>
      <div className="bg-glow-1" />
      <div className="bg-glow-2" />

      {/* 1. Left Sidebar */}
      <section style={{ width: "300px", borderRight: "1px solid var(--glass-border)", background: "rgba(10,10,12,0.8)", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", zIndex: 10 }}>
        <div style={{ padding: "20px", borderBottom: "1px solid var(--glass-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", color: "#fff" }}>AI Study Assistant</h3>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Phase 2.1 Engine Active</span>
          </div>
          <button onClick={handleLogout} style={{ background: "none", border: "none", color: "var(--color-error)", fontSize: "0.8rem", cursor: "pointer" }}>
            Logout
          </button>
        </div>

        {/* Selected Documents */}
        <div style={{ padding: "20px", borderBottom: "1px solid var(--glass-border)" }}>
          <h4 style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
            Grounding Documents ({selectedDocIds.length})
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "150px", overflowY: "auto" }}>
            {documents.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>No documents found. Upload via Dashboard first.</p>
            ) : (
              documents.map((doc) => (
                <label key={doc.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", color: selectedDocIds.includes(doc.id) ? "#fff" : "var(--color-text-secondary)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedDocIds.includes(doc.id)}
                    onChange={() => toggleDocumentSelection(doc.id)}
                    style={{ accentColor: "var(--color-primary)" }}
                  />
                  <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={doc.title}>
                    {doc.title}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Study Mode Selector */}
        <div style={{ padding: "20px", borderBottom: "1px solid var(--glass-border)" }}>
          <h4 style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
            Study Mode
          </h4>
          <div style={{ display: "flex", gap: "6px" }}>
            {(["study", "quiz", "flashcard"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setChatMode(mode)}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  borderRadius: "6px",
                  border: "1px solid",
                  borderColor: chatMode === mode ? "var(--color-primary)" : "var(--glass-border)",
                  background: chatMode === mode ? "var(--color-primary-glow)" : "transparent",
                  color: chatMode === mode ? "#fff" : "var(--color-text-secondary)",
                  fontSize: "0.75rem",
                  textTransform: "capitalize",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Sessions List */}
        <div style={{ padding: "20px", flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Sessions
            </h4>
            <button
              onClick={startNewConversation}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--glass-border)",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "0.75rem",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              + New
            </button>
          </div>
          <div style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
            {conversations.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", textAlign: "center", marginTop: "20px" }}>No history sessions.</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConvId(conv.id)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: activeConvId === conv.id ? "rgba(99, 102, 241, 0.3)" : "transparent",
                    background: activeConvId === conv.id ? "rgba(99, 102, 241, 0.08)" : "transparent",
                    color: activeConvId === conv.id ? "#fff" : "var(--color-text-secondary)",
                    fontSize: "0.85rem",
                    textAlign: "left",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {conv.title}
                </button>
              ))
            )}
          </div>
        </div>
      </section>

      {/* 2. Main Chat Area */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column", zIndex: 10, position: "relative" }}>
        
        {/* Chat Header */}
        <header style={{ padding: "20px", borderBottom: "1px solid var(--glass-border)", background: "rgba(10,10,12,0.4)", backdropFilter: "blur(10px)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "1.2rem", color: "#fff" }}>
              {activeConvId ? "Active Study Room" : "New Study Room"}
            </h2>
            <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
              Context Mode: {chatMode.toUpperCase()} | Real-time SSE streaming active
            </p>
          </div>
        </header>

        {/* Chat Window Component */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ChatWindow
            messages={messages}
            isStreaming={isStreaming}
            streamingText={streamingText}
            streamingCitations={streamingCitations}
            chatMode={chatMode}
            activeCitation={activeCitation}
            setActiveCitation={setActiveCitation}
          />
        </div>

        {/* Error message */}
        {streamError && (
          <div style={{ padding: "10px", margin: "10px 20px", background: "var(--color-error-glow)", border: "1px solid rgba(244, 63, 94, 0.2)", borderRadius: "8px", color: "var(--color-error)", fontSize: "0.85rem" }}>
            ⚠️ {streamError}
          </div>
        )}

        {/* Input Bar */}
        <footer style={{ padding: "20px", borderTop: "1px solid var(--glass-border)", background: "rgba(10,10,12,0.4)" }}>
          <form onSubmit={submitQuery} style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              placeholder={selectedDocIds.length > 0 ? "Ask anything about the active documents..." : "No documents selected. Questions will be answered from general context if available."}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={isStreaming}
              style={{
                flex: 1,
                padding: "14px 18px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--glass-border)",
                borderRadius: "10px",
                color: "#fff",
                fontSize: "0.95rem",
                outline: "none",
                transition: "all 0.2s",
              }}
            />
            <button
              type="submit"
              disabled={isStreaming}
              style={{
                padding: "0 24px",
                background: "var(--color-primary)",
                border: "none",
                borderRadius: "10px",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s",
                opacity: isStreaming ? 0.6 : 1,
              }}
            >
              {isStreaming ? "Streaming..." : "Send"}
            </button>
          </form>
        </footer>
      </section>
    </main>
  );
}
