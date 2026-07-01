'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Endpoint {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  description: string;
  params: { name: string; type: 'text' | 'select'; options?: string[]; description: string; required: boolean; defaultValue?: string }[];
  defaultBody?: string;
}

export default function DevelopersPlaygroundPage() {
  const [apiKey, setApiKey] = useState('');
  const [selectedEndpointId, setSelectedEndpointId] = useState('get-docs');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [requestBody, setRequestBody] = useState('');
  
  // Response output states
  const [isRunning, setIsRunning] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseBody, setResponseBody] = useState<string>('');
  const [latency, setLatency] = useState<number | null>(null);

  const endpoints: Endpoint[] = [
    {
      id: 'get-docs',
      name: 'List Documents',
      method: 'GET',
      path: '/api/public/v1/documents',
      description: 'Fetch cursor-paginated list of uploaded documents.',
      params: [
        { name: 'limit', type: 'text', description: 'Max documents to return', required: false, defaultValue: '10' },
        { name: 'cursor', type: 'text', description: 'Pagination cursor', required: false }
      ]
    },
    {
      id: 'get-doc-by-id',
      name: 'Get Document by ID',
      method: 'GET',
      path: '/api/public/v1/documents/{id}',
      description: 'Fetch details of a single document by its UUID.',
      params: [
        { name: 'id', type: 'text', description: 'Document UUID', required: true, defaultValue: '88fa8e46-ef92-498c-8519-866bbf310b80' }
      ]
    },
    {
      id: 'delete-doc',
      name: 'Delete Document',
      method: 'DELETE',
      path: '/api/public/v1/documents/{id}',
      description: 'Delete document records and associated vector spaces.',
      params: [
        { name: 'id', type: 'text', description: 'Document UUID to delete', required: true }
      ]
    },
    {
      id: 'create-chat',
      name: 'Create Chat Session',
      method: 'POST',
      path: '/api/public/v1/chat',
      description: 'Start a multi-document chat session.',
      params: [],
      defaultBody: JSON.stringify({
        documentIds: ['88fa8e46-ef92-498c-8519-866bbf310b80'],
        title: 'API Session'
      }, null, 2)
    },
    {
      id: 'get-quizzes',
      name: 'List Quizzes',
      method: 'GET',
      path: '/api/public/v1/quizzes',
      description: 'Get all quizzes created for the organization.',
      params: []
    },
    {
      id: 'get-progress',
      name: 'Get Progress Summary',
      method: 'GET',
      path: '/api/public/v1/progress',
      description: 'Get organization-wide student progress analytics.',
      params: []
    }
  ];

  const activeEndpoint = endpoints.find(e => e.id === selectedEndpointId) || endpoints[0];

  useEffect(() => {
    const savedKey = sessionStorage.getItem('playground_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  // Update default body & param defaults when active endpoint changes
  useEffect(() => {
    const initialParams: Record<string, string> = {};
    activeEndpoint.params.forEach(p => {
      if (p.defaultValue) {
        initialParams[p.name] = p.defaultValue;
      }
    });
    setParamValues(initialParams);
    setRequestBody(activeEndpoint.defaultBody || '');
  }, [selectedEndpointId]);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    sessionStorage.setItem('playground_api_key', val);
  };

  const handleRunRequest = async () => {
    if (!apiKey) {
      alert('Please provide an API Key first.');
      return;
    }

    setIsRunning(true);
    setResponseStatus(null);
    setResponseBody('');
    setResponseHeaders({});
    setLatency(null);

    const baseApiUrl = process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/v1$/, '')
      : 'http://localhost:3001';

    let requestPath = activeEndpoint.path;

    // Substitute path params
    activeEndpoint.params.forEach(p => {
      if (requestPath.includes(`{${p.name}}`)) {
        requestPath = requestPath.replace(`{${p.name}}`, paramValues[p.name] || '');
      }
    });

    // Append query params for GET requests
    if (activeEndpoint.method === 'GET') {
      const queryParts: string[] = [];
      activeEndpoint.params.forEach(p => {
        if (!activeEndpoint.path.includes(`{${p.name}}`) && paramValues[p.name]) {
          queryParts.push(`${p.name}=${encodeURIComponent(paramValues[p.name])}`);
        }
      });
      if (queryParts.length > 0) {
        requestPath += `?${queryParts.join('&')}`;
      }
    }

    const startTime = Date.now();
    try {
      const fetchOpts: RequestInit = {
        method: activeEndpoint.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      };

      if (activeEndpoint.method === 'POST' && requestBody) {
        fetchOpts.body = requestBody;
      }

      const res = await fetch(`${baseApiUrl}${requestPath}`, fetchOpts);
      const endTime = Date.now();
      setLatency(endTime - startTime);
      setResponseStatus(res.status);

      // Extract headers
      const headersMap: Record<string, string> = {};
      res.headers.forEach((value, name) => {
        headersMap[name] = value;
      });
      setResponseHeaders(headersMap);

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponseBody(JSON.stringify(json, null, 2));
      } catch {
        setResponseBody(text);
      }
    } catch (err: any) {
      setResponseBody(`Network Error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', position: 'relative', overflowX: 'hidden', paddingBottom: '60px' }}>
      <div className="bg-glow-1" />

      {/* Nav */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 5%',
        borderBottom: '1px solid var(--glass-border)',
        background: 'rgba(10, 10, 12, 0.7)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link href="/developers" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>
            ← Home
          </Link>
          <span style={{ color: '#333339' }}>|</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>
            API Playground
          </span>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <Link href="/developers/docs" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>Docs</Link>
          <Link href="/developers/dashboard" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>Console</Link>
        </div>
      </nav>

      {/* Main Area */}
      <main style={{ maxWidth: '1400px', margin: '40px auto 0 auto', padding: '0 24px', position: 'relative', zIndex: 2 }}>
        
        {/* API Key configuration bar */}
        <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '280px' }}>
            <label style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Playground API Key</label>
            <input
              type="password"
              placeholder="ska_live_..."
              value={apiKey}
              onChange={e => handleApiKeyChange(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: 'var(--color-secondary)',
                fontFamily: 'monospace',
                fontSize: '0.95rem',
                outline: 'none'
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Key stays in session memory only.</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Create one in the <Link href="/developers/dashboard" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Console</Link> if needed.</span>
          </div>
        </div>

        {/* Playground Split Screen */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '24px' }}>
          
          {/* Left panel: Request configurator */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px', fontFamily: 'var(--font-display)' }}>Configure Request</h2>
            
            {/* Endpoint Selector */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Select Endpoint</label>
              <select value={selectedEndpointId} onChange={e => setSelectedEndpointId(e.target.value)} style={{
                width: '100%',
                background: '#18181f',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                padding: '12px',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none'
              }}>
                {endpoints.map(e => (
                  <option key={e.id} value={e.id}>
                    [{e.method}] {e.path} — {e.name}
                  </option>
                ))}
              </select>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: 1.4 }}>
              {activeEndpoint.description}
            </p>

            {/* Path and Query Parameters */}
            {activeEndpoint.params.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '0.95rem', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>Parameters</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {activeEndpoint.params.map(p => (
                    <div key={p.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'monospace' }}>
                          {p.name} {p.required && <span style={{ color: 'var(--color-error)' }}>*</span>}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{p.description}</span>
                      </div>
                      <input
                        type="text"
                        value={paramValues[p.name] || ''}
                        onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        placeholder={p.required ? 'Required' : 'Optional'}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: '8px',
                          padding: '10px',
                          color: '#fff',
                          outline: 'none',
                          fontSize: '0.9rem'
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Request Body (POST only) */}
            {activeEndpoint.method === 'POST' && (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>JSON Request Body</label>
                <textarea
                  value={requestBody}
                  onChange={e => setRequestBody(e.target.value)}
                  rows={8}
                  style={{
                    width: '100%',
                    background: '#070709',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#a7f3d0',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {/* Run Button */}
            <button
              onClick={handleRunRequest}
              disabled={isRunning}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, var(--color-primary), #4f46e5)',
                border: 'none',
                borderRadius: '8px',
                padding: '14px',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'box-shadow 0.2s'
              }}
              onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
            >
              {isRunning ? 'Sending Request...' : 'Send Request'}
            </button>
          </div>

          {/* Right panel: Response inspector */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>Response</h2>
              
              {responseStatus && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  {latency && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{latency} ms</span>}
                  <span style={{
                    background: responseStatus < 300 ? 'var(--color-success-glow)' : 'var(--color-error-glow)',
                    border: `1px solid ${responseStatus < 300 ? 'var(--color-success)' : 'var(--color-error)'}`,
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: responseStatus < 300 ? 'var(--color-success)' : 'var(--color-error)'
                  }}>
                    HTTP {responseStatus}
                  </span>
                </div>
              )}
            </div>

            {responseStatus ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                
                {/* Response Headers */}
                <div>
                  <h3 style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Headers</h3>
                  <div style={{
                    maxHeight: '120px',
                    overflowY: 'auto',
                    background: '#070709',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    color: 'var(--color-text-muted)'
                  }}>
                    {Object.entries(responseHeaders).map(([k, v]) => (
                      <div key={k}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>{k}:</span> {v}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Response Body */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>Body</h3>
                  <pre style={{
                    flex: 1,
                    background: '#070709',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '16px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    color: '#e4e4e7',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: '350px'
                  }}>
                    {responseBody}
                  </pre>
                </div>

              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, color: 'var(--color-text-muted)', minHeight: '300px' }}>
                {isRunning ? 'Executing test request...' : 'Configure parameters on the left and run request to see response here.'}
              </div>
            )}
          </div>

        </div>

      </main>
    </div>
  );
}
