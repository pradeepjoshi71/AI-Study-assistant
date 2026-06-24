import React, { useRef, useEffect } from 'react';
import { CitationEvent } from '../hooks/useChatStream';

export interface ChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  citations?: CitationEvent[];
}

interface ChatWindowProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  streamingCitations: CitationEvent[];
  chatMode: 'study' | 'quiz' | 'flashcard';
  activeCitation: CitationEvent | null;
  setActiveCitation: (cite: CitationEvent | null) => void;
  onRegenerate?: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isStreaming,
  streamingText,
  streamingCitations,
  chatMode,
  activeCitation,
  setActiveCitation,
  onRegenerate,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, isStreaming]);

  const renderContent = (content: string, citationsList?: any[]) => {
    if (!citationsList || citationsList.length === 0) {
      return <p style={{ lineHeight: '1.6', margin: 0 }}>{content}</p>;
    }

    // Ground matching patterns like [chunk_uuid] or [chunk_id]
    const regex = /\[([a-f0-9-]{36}|chunk_[a-zA-Z0-9_]+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const matchIndex = match.index;
      const citationId = match[1];

      // Add text before match
      if (matchIndex > lastIndex) {
        parts.push(content.substring(lastIndex, matchIndex));
      }

      // Resolve matching citation object
      const citation = citationsList.find(
        (c) => c.chunk_id === citationId || c.chunk_id?.includes(citationId)
      );

      if (citation) {
        parts.push(
          <button
            key={matchIndex}
            onClick={() => setActiveCitation(citation)}
            style={{
              background: 'rgba(6, 182, 212, 0.12)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              borderRadius: '4px',
              padding: '1px 6px',
              fontSize: '0.8rem',
              color: 'var(--color-secondary)',
              cursor: 'pointer',
              margin: '0 3px',
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
              transition: 'all 0.2s',
            }}
            title="Click to view grounding text source"
          >
            pg. {citation.page}
          </button>
        );
      } else {
        parts.push(match[0]); // fallback
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return <p style={{ lineHeight: '1.6', margin: 0 }}>{parts}</p>;
  };

  const renderMessageBody = (msg: ChatMessage) => {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed && typeof parsed === 'object') {
        if (parsed.type === 'tool_call') {
          return (
            <div style={{
              background: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '8px',
              padding: '12px 16px',
              margin: '4px 0',
              fontFamily: 'monospace',
              fontSize: '0.85rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b', fontWeight: 600, marginBottom: '6px' }}>
                ⚙️ Tool Call: {parsed.name}
              </div>
              <pre style={{ margin: 0, overflowX: 'auto', opacity: 0.8, color: '#f59e0b', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(parsed.args, null, 2)}
              </pre>
            </div>
          );
        }
        if (parsed.type === 'tool_response') {
          return (
            <div style={{
              background: 'rgba(16, 185, 129, 0.05)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: '8px',
              padding: '12px 16px',
              margin: '4px 0',
              fontFamily: 'monospace',
              fontSize: '0.85rem'
            }}>
              <details>
                <summary style={{ cursor: 'pointer', color: '#10b981', fontWeight: 600, outline: 'none' }}>
                  ✅ Tool Output: {parsed.name} (Click to expand)
                </summary>
                <pre style={{ marginTop: '8px', overflowX: 'auto', opacity: 0.8, color: '#10b981', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(parsed.response, null, 2)}
                </pre>
              </details>
            </div>
          );
        }
      }
    } catch {
      // Ignore and fallback
    }

    return msg.role === 'USER' 
      ? <p style={{ margin: 0, lineHeight: 1.6 }}>{msg.content}</p> 
      : renderContent(msg.content, msg.citations);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' }}>
      
      {/* 1. Message viewport */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {messages.length === 0 && !isStreaming ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
            <div style={{ padding: '20px', background: 'var(--color-primary-glow)', borderRadius: '50%', fontSize: '2rem' }}>
              📖
            </div>
            <h3 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 600 }}>Real-Time AI Study Room</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', maxWidth: '400px', textAlign: 'center', lineHeight: 1.6 }}>
              Choose a study mode and begin typing. Responses will stream token-by-token and include clickable citation grounding highlights.
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignSelf: msg.role === 'USER' ? 'flex-end' : 'flex-start',
                  maxWidth: '75%',
                  gap: '6px',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', alignSelf: msg.role === 'USER' ? 'flex-end' : 'flex-start' }}>
                  {msg.role === 'USER' ? 'You' : 'AI Study Assistant'}
                </span>
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '12px',
                    background: msg.role === 'USER' ? 'var(--color-primary-glow)' : 'rgba(255,255,255,0.03)',
                    border: '1px solid',
                    borderColor: msg.role === 'USER' ? 'rgba(99, 102, 241, 0.3)' : 'var(--glass-border)',
                    color: '#fff',
                    fontSize: '0.95rem',
                  }}
                >
                  {renderMessageBody(msg)}
                </div>
              </div>
            ))}

            {/* Streaming message bubble */}
            {isStreaming && (streamingText || streamingCitations.length > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '75%', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  AI Study Assistant (Streaming...)
                </span>
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--glass-border)',
                    color: '#fff',
                    fontSize: '0.95rem',
                  }}
                >
                  {renderContent(streamingText || 'Synthesizing grounded response...', streamingCitations)}
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 2. Citations Overlay Preview Modal */}
      {activeCitation && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '580px', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 1010 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
              <div>
                <h4 style={{ fontSize: '1.2rem', color: '#fff', margin: 0 }}>Grounding Chunk Content</h4>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>Source Document: {activeCitation.document_id}</span>
              </div>
              <button
                onClick={() => setActiveCitation(null)}
                style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)', maxHeight: '200px', overflowY: 'auto' }}>
              <p style={{ fontSize: '0.95rem', color: '#fff', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>
                "{activeCitation.text_preview}"
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              <span>Page number: <strong>{activeCitation.page}</strong></span>
              <span>Chunk key: <code>{activeCitation.chunk_id}</code></span>
            </div>
            <button
              onClick={() => setActiveCitation(null)}
              style={{ width: '100%', padding: '12px', background: 'var(--color-primary)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
            >
              Close Source
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default ChatWindow;
