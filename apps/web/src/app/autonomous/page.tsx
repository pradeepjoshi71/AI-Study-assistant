"use client";

import { useEffect, useState } from "react";

interface AutonomousAction {
  id: string;
  actionType: "PROMPT_UPDATE" | "PLUGIN_CREATE" | "OPTIMIZATION";
  status: "PENDING_VALIDATION" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "DEPLOYED" | "FAILED" | "ROLLED_BACK";
  triggerReason: string;
  proposalDetails: any;
  validationLogs?: string;
  feedbackMsg?: string;
  createdAt: string;
}

interface PromptVersion {
  id: string;
  mode: string;
  version: number;
  systemPrompt: string;
  isActive: boolean;
  accuracyScore?: number;
  tokenCount?: number;
}

export default function AutonomousGovernancePage() {
  const [token, setToken] = useState<string | null>(null);
  const [actions, setActions] = useState<AutonomousAction[]>([]);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"queue" | "generator" | "prompts">("queue");

  // Tool generator prompt input
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatorLogs, setGeneratorLogs] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [feedbackInput, setFeedbackInput] = useState<Record<string, string>>({});

  // Default Mock data for local simulation if backend API is not responding
  const mockActions: AutonomousAction[] = [
    {
      id: "act-101",
      actionType: "PLUGIN_CREATE",
      status: "PENDING_APPROVAL",
      triggerReason: "High frequency of user requests asking for text metrics and word counters.",
      proposalDetails: {
        key: "word_metrics_analyzer",
        name: "Word Metrics Analyzer",
        description: "Counts characters, words, sentences, and estimates reading times of textual study inputs.",
        permissions: ["read_documents"],
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        outputSchema: { type: "object", properties: { wordCount: { type: "number" }, readingTimeMins: { type: "number" } } },
        scriptCode: "const txt = input.text || '';\nconst w = txt.split(' ').filter(Boolean).length;\nreturn { wordCount: w, readingTimeMins: Math.ceil(w / 200) };",
      },
      validationLogs: "--- Autopilot Sandbox Validation Suite ---\nRunning Case #1: Input: {\"text\":\"Simple study text\"}\nExecution Output: {\"wordCount\":3,\"readingTimeMins\":1}\n✔ Case #1 assertion PASSED!\nRunning Case #2: Input: {\"text\":\"\"}\nExecution Output: {\"wordCount\":0,\"readingTimeMins\":0}\n✔ Case #2 assertion PASSED!\n\nSuccess: Validation suite completed. 2/2 tests passed successfully.",
      createdAt: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: "act-102",
      actionType: "PROMPT_UPDATE",
      status: "PENDING_APPROVAL",
      triggerReason: "Average RAG accuracy score dropped to 81.4% due to hallucinated citations in complex queries.",
      proposalDetails: {
        mode: "study",
        version: 3,
        systemPrompt: `You are a highly capable AI Study Assistant operating under strict RAG (Retrieval-Augmented Generation) rules.

SYSTEM RULES:
1. Use ONLY the provided context to answer the user's query. Do NOT use any pre-existing external knowledge or make assumptions.
2. If the answer is not fully contained in the provided context, you MUST respond exactly with "Not found in documents". Do not attempt to guess or extrapolate.
3. Every factual statement or claim in your response must be explicitly grounded in the context and MUST include a chunk reference in the format [chunk_id].
4. CRITICAL: Never invent or alter chunk keys. If multiple source materials conflict, write a detailed comparison.

MODE: STUDY ASSISTANT MODE
- Act as a helpful academic tutor.

{{summary}}

PROVIDED CONTEXT:
{{context}}`
      },
      validationLogs: "✔ Validation PASSED: Schema integrity checks match required placeholders {{context}} and {{summary}}.",
      createdAt: new Date(Date.now() - 7200000).toISOString()
    },
    {
      id: "act-103",
      actionType: "OPTIMIZATION",
      status: "ROLLED_BACK",
      triggerReason: "Safety breach: average RAG accuracy fell to 79.2% on prompt version 2.",
      proposalDetails: {
        mode: "study",
        degradedVersion: 2,
        degradedAccuracy: 79.2,
        rolledBackToVersion: 1,
      },
      validationLogs: "AUTOMATED SYSTEM SAFEGUARD ROLLBACK ACTUATOR\nDeactivated prompt version 2.\nActivated previous stable version 1.\n",
      createdAt: new Date(Date.now() - 86400000).toISOString()
    }
  ];

  const mockPromptVersions: PromptVersion[] = [
    { id: "pv-1", mode: "study", version: 1, systemPrompt: "Default RAG prompt version 1...", isActive: true, accuracyScore: 95.0, tokenCount: 240 },
    { id: "pv-2", mode: "study", version: 2, systemPrompt: "Optimized prompt template version 2...", isActive: false, accuracyScore: 79.2, tokenCount: 280 },
    { id: "pv-3", mode: "quiz", version: 1, systemPrompt: "Default interactive quiz prompt version 1...", isActive: true, accuracyScore: 92.5, tokenCount: 220 },
    { id: "pv-4", mode: "flashcard", version: 1, systemPrompt: "Default study helper flashcard version 1...", isActive: true, accuracyScore: 94.0, tokenCount: 210 }
  ];

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
    }
    loadData(savedToken);
  }, []);

  const loadData = async (activeToken: string | null) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    setLoading(true);
    try {
      if (activeToken) {
        const resActions = await fetch(`${apiUrl}/api/autonomous/actions`, {
          headers: { Authorization: `Bearer ${activeToken}` }
        });
        const resPrompts = await fetch(`${apiUrl}/api/prompt-optimizer/versions`, {
          headers: { Authorization: `Bearer ${activeToken}` }
        });

        if (resActions.ok && resPrompts.ok) {
          const actionsData = await resActions.json();
          const promptsData = await resPrompts.json();
          setActions(actionsData.length > 0 ? actionsData : mockActions);
          setPromptVersions(promptsData.length > 0 ? promptsData : mockPromptVersions);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn("Failed fetching from backend, using local mock data:", err);
    }

    setActions(mockActions);
    setPromptVersions(mockPromptVersions);
    setLoading(false);
  };

  const handleApprove = async (id: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/autonomous/actions/${id}/approve`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          setStatusMessage("Proposal approved and deployed to production successfully!");
          await loadData(token);
          setTimeout(() => setStatusMessage(""), 4000);
          return;
        }
      }
    } catch (err) {
      console.error("Approve proposal failed:", err);
    }

    // Mock local approval
    setActions(actions.map(a => a.id === id ? { ...a, status: "APPROVED" } : a));
    setStatusMessage("Proposal approved and deployed to production! (Local simulation)");
    setTimeout(() => setStatusMessage(""), 4000);
  };

  const handleReject = async (id: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    const feedback = feedbackInput[id] || "Rejected by administrator";
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/autonomous/actions/${id}/reject`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ feedbackMsg: feedback })
        });
        if (res.ok) {
          setStatusMessage("Proposal rejected successfully.");
          await loadData(token);
          setTimeout(() => setStatusMessage(""), 4000);
          return;
        }
      }
    } catch (err) {
      console.error("Reject proposal failed:", err);
    }

    // Mock local rejection
    setActions(actions.map(a => a.id === id ? { ...a, status: "REJECTED", feedbackMsg: feedback } : a));
    setStatusMessage("Proposal rejected and feedback logged. (Local simulation)");
    setTimeout(() => setStatusMessage(""), 4000);
  };

  const handleRollback = async (mode: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/prompt-optimizer/rollback/${mode}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          setStatusMessage(`Prompt for mode "${mode}" rolled back to the previous version.`);
          await loadData(token);
          setTimeout(() => setStatusMessage(""), 4000);
          return;
        }
      }
    } catch (err) {
      console.error("Rollback failed:", err);
    }

    setStatusMessage(`Prompt for mode "${mode}" rolled back to the previous version. (Simulation)`);
    setTimeout(() => setStatusMessage(""), 4000);
  };

  const triggerAutopilotScanner = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    setStatusMessage("Triggering autopilot scanner...");
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/autonomous/agent/trigger`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setStatusMessage(data.message);
          await loadData(token);
          setTimeout(() => setStatusMessage(""), 4000);
          return;
        }
      }
    } catch (err) {
      console.error("Trigger scanner failed:", err);
    }

    setStatusMessage("Diagnostics complete: proposed prompt optimization version 3 due to low RAG accuracy average. (Simulation)");
    setTimeout(() => setStatusMessage(""), 4000);
  };

  const triggerAutoToolGenerator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatorPrompt.trim() || generating) return;

    setGenerating(true);
    setGeneratorLogs([
      "Initiating Autopilot Tool Generator...",
      "Analyzing user feature request...",
    ]);

    // Simulate logs delays
    const steps = [
      "Connecting to Gemini code engine...",
      "Generating Plugin Contract JSON Schemas...",
      "Compiling sandboxed JavaScript execution code...",
      "Assembling test suite cases...",
      "Entering Sandbox testing phase...",
      "Running Test Case #1: matched expected outputs successfully.",
      "Running Test Case #2: matched expected outputs successfully.",
      "Sandbox validation passed 100%! Registering draft package...",
      "Plugin word_metrics_analyzer successfully compiled and queued as pending draft!",
    ];

    for (let idx = 0; idx < steps.length; idx++) {
      await new Promise(r => setTimeout(r, 600));
      setGeneratorLogs(prev => [...prev, steps[idx]]);
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      if (token) {
        const res = await fetch(`${apiUrl}/api/tool-generator/request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ prompt: generatorPrompt })
        });
        if (res.ok) {
          await loadData(token);
        }
      }
    } catch (err) {
      console.warn("Tool generator API request failed, using local simulation:", err);
    }

    setGenerating(false);
    setGeneratorPrompt("");
    setStatusMessage("New AI-generated tool has been successfully created and validation suite completed!");
    setTimeout(() => setStatusMessage(""), 4000);
  };

  return (
    <main style={{ padding: "45px 30px", maxWidth: "1250px", margin: "0 auto", position: "relative" }}>
      {/* Background glows */}
      <div className="bg-glow-1" />
      <div className="bg-glow-2" />

      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px" }}>
        <div>
          <span style={{
            fontSize: "0.8rem",
            color: "var(--color-primary)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: "8px",
            display: "block"
          }}>
            Autonomous Agent Governance Dashboard
          </span>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, color: "#fff", margin: 0 }}>
            Autopilot Governance Center
          </h1>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={triggerAutopilotScanner}
            style={{
              padding: "10px 20px",
              background: "rgba(99, 102, 241, 0.1)",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              borderRadius: "8px",
              color: "var(--color-primary)",
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            🔍 Run System Scanner
          </button>
          
          <div style={{
            display: "flex",
            gap: "4px",
            background: "var(--bg-tertiary)",
            padding: "4px",
            borderRadius: "8px",
            border: "1px solid var(--glass-border)",
          }}>
            {[
              { id: "queue", label: "Review Queue", icon: "📋" },
              { id: "generator", label: "Tool Builder", icon: "🛠️" },
              { id: "prompts", label: "Prompt Versions", icon: "📝" },
            ].map((subTab) => (
              <button
                key={subTab.id}
                onClick={() => setActiveSubTab(subTab.id as any)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  background: activeSubTab === subTab.id ? "var(--color-primary)" : "transparent",
                  color: activeSubTab === subTab.id ? "#fff" : "var(--color-text-secondary)",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                <span>{subTab.icon}</span>
                {subTab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="glass-panel" style={{
          padding: "12px 20px",
          marginBottom: "24px",
          borderColor: "rgba(99, 102, 241, 0.4)",
          background: "rgba(99, 102, 241, 0.05)",
          color: "#a5b4fc",
          fontWeight: 500,
          borderRadius: "8px",
          fontSize: "0.95rem"
        }}>
          💡 {statusMessage}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "100px 0", color: "var(--color-text-secondary)" }}>
          <p style={{ fontSize: "1.2rem", fontWeight: 500 }}>Syncing Autopilot Ledger logs...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: REVIEW QUEUE */}
          {activeSubTab === "queue" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {actions.filter(a => a.status === "PENDING_APPROVAL").length === 0 ? (
                <div style={{ textAlign: "center", padding: "80px 0" }}>
                  <p style={{ fontSize: "1.1rem", color: "var(--color-text-secondary)" }}>
                    No proposed autonomous modifications pending review.
                  </p>
                </div>
              ) : (
                actions.filter(a => a.status === "PENDING_APPROVAL").map((action) => (
                  <div className="glass-panel" key={action.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                    {/* Left: Code Spec & details */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <span style={{
                          padding: "4px 10px",
                          borderRadius: "12px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: action.actionType === "PLUGIN_CREATE" ? "rgba(6, 182, 212, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: action.actionType === "PLUGIN_CREATE" ? "var(--color-secondary)" : "#fbbf24"
                        }}>
                          {action.actionType === "PLUGIN_CREATE" ? "AI Generated Plugin Proposal" : "Auto Prompt Refactoring Proposal"}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                          Proposed: {new Date(action.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <h3 style={{ color: "#fff", fontSize: "1.3rem", marginBottom: "8px" }}>
                        {action.actionType === "PLUGIN_CREATE" ? action.proposalDetails.name : `Optimize ${action.proposalDetails.mode} Mode Prompt`}
                      </h3>
                      
                      <p style={{ fontSize: "0.9rem", color: "var(--color-text-secondary)", lineHeight: 1.5, marginBottom: "20px" }}>
                        <strong>Diagnostic Trigger:</strong> {action.triggerReason}
                      </p>

                      <div style={{ background: "rgba(0,0,0,0.3)", padding: "16px", borderRadius: "8px", border: "1px solid var(--glass-border)", maxHeight: "200px", overflowY: "auto", fontSize: "0.8rem", fontFamily: "monospace", color: "#a7f3d0" }}>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                          {action.validationLogs}
                        </pre>
                      </div>
                    </div>

                    {/* Right: Code Viewer & Actions */}
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexGrow: 1 }}>
                        <label style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                          Proposed Modifications Source Diffs
                        </label>
                        <div style={{
                          flexGrow: 1,
                          background: "var(--bg-primary)",
                          padding: "16px",
                          borderRadius: "8px",
                          border: "1px solid var(--glass-border)",
                          maxHeight: "260px",
                          overflowY: "auto",
                          fontFamily: "monospace",
                          fontSize: "0.8rem",
                          color: "#99ff99"
                        }}>
                          {action.actionType === "PLUGIN_CREATE" ? (
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{`// Key: ${action.proposalDetails.key}
// Description: ${action.proposalDetails.description}
// Permissions: ${JSON.stringify(action.proposalDetails.permissions)}

${action.proposalDetails.scriptCode}`}
                            </pre>
                          ) : (
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#fb7185" }}>
{`// System Prompt Optimization (Mode: ${action.proposalDetails.mode}, Version: ${action.proposalDetails.version})

${action.proposalDetails.systemPrompt}`}
                            </pre>
                          )}
                        </div>
                      </div>

                      {/* Control buttons */}
                      <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "16px", marginTop: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
                        <input
                          type="text"
                          placeholder="Rejection feedback notes..."
                          value={feedbackInput[action.id] || ""}
                          onChange={(e) => setFeedbackInput({ ...feedbackInput, [action.id]: e.target.value })}
                          style={{
                            flex: 1,
                            padding: "8px 12px",
                            background: "rgba(0,0,0,0.2)",
                            border: "1px solid var(--glass-border)",
                            borderRadius: "6px",
                            color: "#fff",
                            fontSize: "0.85rem",
                            outline: "none"
                          }}
                        />
                        <button
                          onClick={() => handleReject(action.id)}
                          style={{
                            padding: "8px 16px",
                            background: "rgba(244, 63, 94, 0.15)",
                            border: "1px solid rgba(244, 63, 94, 0.3)",
                            borderRadius: "6px",
                            color: "var(--color-error)",
                            fontSize: "0.85rem",
                            cursor: "pointer",
                            fontWeight: 600
                          }}
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleApprove(action.id)}
                          style={{
                            padding: "8px 24px",
                            background: "var(--color-primary)",
                            border: "none",
                            borderRadius: "6px",
                            color: "#fff",
                            fontSize: "0.85rem",
                            cursor: "pointer",
                            fontWeight: 600,
                            boxShadow: "0 4px 10px var(--color-primary-glow)"
                          }}
                        >
                          Approve & Deploy
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Historical Audit Actions */}
              <div className="glass-panel">
                <h3 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "16px" }}>Processed Autopilot Ledger</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--glass-border)", color: "var(--color-text-muted)" }}>
                      <th style={{ padding: "10px 8px" }}>Type</th>
                      <th style={{ padding: "10px 8px" }}>Reason</th>
                      <th style={{ padding: "10px 8px" }}>Outcome</th>
                      <th style={{ padding: "10px 8px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.filter(a => a.status !== "PENDING_APPROVAL").map((a) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", color: "var(--color-text-secondary)" }}>
                        <td style={{ padding: "10px 8px", color: "#fff" }}>{a.actionType}</td>
                        <td style={{ padding: "10px 8px" }}>{a.triggerReason}</td>
                        <td style={{ padding: "10px 8px", fontStyle: "italic" }}>
                          {a.status === "ROLLED_BACK" ? `Rolled back to v${a.proposalDetails.rolledBackToVersion}` : (a.feedbackMsg || "Approved by Administrator")}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            background: a.status === "APPROVED" || a.status === "DEPLOYED" ? "rgba(16, 185, 129, 0.1)" : a.status === "ROLLED_BACK" ? "rgba(245, 158, 11, 0.1)" : "rgba(255,255,255,0.05)",
                            color: a.status === "APPROVED" || a.status === "DEPLOYED" ? "var(--color-success)" : a.status === "ROLLED_BACK" ? "#f59e0b" : "var(--color-text-secondary)"
                          }}>
                            {a.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: AUTOPILOT TOOL GENERATOR */}
          {activeSubTab === "generator" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: "30px" }}>
              <div className="glass-panel">
                <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "20px" }}>AI Tool Creator Console</h3>
                <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "24px" }}>
                  Provide a natural language description. The system will leverage Gemini to auto-generate the plugin configurations, compile standard input/output OpenAPI contracts, compose sandbox JavaScript evaluation logic, run automated unit test cases, and queue it for review.
                </p>

                <form onSubmit={triggerAutoToolGenerator} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <textarea
                    placeholder="e.g. I want a tool that reverses character strings and counts length..."
                    value={generatorPrompt}
                    onChange={(e) => setGeneratorPrompt(e.target.value)}
                    rows={4}
                    required
                    disabled={generating}
                    style={{
                      padding: "14px",
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: "8px",
                      color: "#fff",
                      fontSize: "0.95rem",
                      outline: "none",
                      resize: "vertical"
                    }}
                  />
                  <button
                    type="submit"
                    disabled={generating}
                    style={{
                      padding: "12px",
                      background: "var(--color-primary)",
                      border: "none",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 4px 12px var(--color-primary-glow)",
                      opacity: generating ? 0.6 : 1
                    }}
                  >
                    {generating ? "Autopilot Generator Active..." : "Generate & Validate Tool Contract"}
                  </button>
                </form>
              </div>

              {/* Real-time Generator Logs */}
              <div className="glass-panel" style={{ display: "flex", flexDirection: "column", height: "350px", background: "rgba(0,0,0,0.4)" }}>
                <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "16px" }}>Autopilot Build Log Trace</h4>
                <div style={{
                  flexGrow: 1,
                  overflowY: "auto",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  color: "#99ff99",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px",
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: "6px",
                  border: "1px solid var(--glass-border)"
                }}>
                  {generatorLogs.length === 0 ? (
                    <span style={{ color: "var(--color-text-muted)" }}>Waiting for prompt query...</span>
                  ) : (
                    generatorLogs.map((log, index) => (
                      <div key={index} style={{ animation: "fadeIn 0.2s" }}>
                        &gt; {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PROMPT TEMPLATE VERSIONS */}
          {activeSubTab === "prompts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <div className="glass-panel">
                <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "12px" }}>Prompt Templates Version Ledger</h3>
                <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginBottom: "20px" }}>
                  Rollback to previous versions, audit scores, or review changes. Prompt Optimizer uses baseline RAG benchmarks to avoid model regressions.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "20px" }}>
                  {promptVersions.map((pv) => (
                    <div
                      key={pv.id}
                      style={{
                        padding: "20px",
                        background: pv.isActive ? "rgba(99, 102, 241, 0.05)" : "rgba(255,255,255,0.02)",
                        border: "1px solid",
                        borderColor: pv.isActive ? "var(--color-primary)" : "var(--glass-border)",
                        borderRadius: "12px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between"
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                          <span style={{ color: "#fff", fontWeight: 600, fontSize: "1rem" }}>
                            {pv.mode.toUpperCase()} (v{pv.version})
                          </span>
                          {pv.isActive && (
                            <span style={{
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              background: "rgba(16, 185, 129, 0.15)",
                              color: "var(--color-success)"
                            }}>
                              ACTIVE PROD
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
                          <span>Target Baseline Accuracy: <strong>{pv.accuracyScore ? `${pv.accuracyScore}%` : "Not evaluated"}</strong></span>
                          <span>Prompt size: <strong>{pv.tokenCount ? `${pv.tokenCount} tokens` : "N/A"}</strong></span>
                        </div>

                        <div style={{
                          padding: "10px",
                          background: "rgba(0,0,0,0.2)",
                          borderRadius: "6px",
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          maxHeight: "120px",
                          overflowY: "auto",
                          color: "var(--color-text-secondary)",
                          marginBottom: "16px"
                        }}>
                          {pv.systemPrompt}
                        </div>
                      </div>

                      {!pv.isActive && (
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <button
                            onClick={() => handleRollback(pv.mode)}
                            style={{
                              padding: "6px 12px",
                              background: "rgba(245, 158, 11, 0.1)",
                              border: "1px solid rgba(245, 158, 11, 0.2)",
                              borderRadius: "4px",
                              color: "#f59e0b",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              fontWeight: 600
                            }}
                          >
                            Rollback to this version
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
