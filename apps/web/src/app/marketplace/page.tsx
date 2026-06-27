"use client";

import { useEffect, useState } from "react";

interface PluginInfo {
  id: string;
  key: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  inputSchema: any;
  outputSchema: any;
  endpointUrl?: string;
  scriptCode?: string;
  authType: string;
  priceMonthlyCents: number;
  costPerExecutionCents: number;
  isActive: boolean;
  authorId: string;
  installed?: boolean;
  config?: any;
}

export default function MarketplacePage() {
  const [token, setToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"store" | "installed" | "developer" | "analytics">("store");
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [installedList, setInstalledList] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);

  // Developer publishing state
  const [devKey, setDevKey] = useState("my_custom_tool");
  const [devName, setDevName] = useState("Custom Study Enhancer");
  const [devVersion, setDevVersion] = useState("1.0.0");
  const [devDesc, setDevDesc] = useState("Enhance and validate definitions in notes using external references.");
  const [devType, setDevType] = useState<"HTTP" | "SCRIPT">("SCRIPT");
  const [devEndpoint, setDevEndpoint] = useState("https://api.mytool.com/execute");
  const [devScript, setDevScript] = useState(`// Custom sandboxed JS code execution\n// Input data is accessible in the global 'input' object\nconst text = input.text || '';\nconst words = text.split(' ').length;\nreturn { wordCount: words, enhanced: true };`);
  const [devPermissions, setDevPermissions] = useState<string[]>(["read_documents"]);
  const [statusMessage, setStatusMessage] = useState("");

  // Secret Keys configurations
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, string>>({});

  // Mock analytics data
  const logs = [
    { id: "log-1", name: "Wolfram Alpha", timestamp: "Just now", latency: "342ms", status: 200, cost: "$0.00" },
    { id: "log-2", name: "Wikipedia Search", timestamp: "5 mins ago", latency: "189ms", status: 200, cost: "$0.00" },
    { id: "log-3", name: "LaTeX Formatter", timestamp: "22 mins ago", latency: "85ms", status: 200, cost: "$0.01" },
    { id: "log-4", name: "Google Drive Importer", timestamp: "1 hour ago", latency: "1.2s", status: 200, cost: "$0.00" },
    { id: "log-5", name: "LaTeX Formatter", timestamp: "3 hours ago", latency: "420ms", status: 500, cost: "$0.00" },
  ];

  // Default mock plugins list
  const defaultPlugins: PluginInfo[] = [
    {
      id: "p1",
      key: "wolfram_alpha",
      name: "Wolfram Alpha",
      version: "1.2.0",
      description: "Solve complex mathematics, science queries, formulas and step-by-step math explanations.",
      permissions: ["external_api_call"],
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      outputSchema: { type: "object", properties: { result: { type: "string" } } },
      endpointUrl: "https://api.wolframalpha.com/v1/llm-api",
      authType: "API_KEY",
      priceMonthlyCents: 0,
      costPerExecutionCents: 0,
      isActive: true,
      authorId: "admin",
    },
    {
      id: "p2",
      key: "google_drive",
      name: "Google Drive Importer",
      version: "1.0.4",
      description: "Seamlessly import class documents, textbooks, and notes directly into study workspaces.",
      permissions: ["read_documents", "write_notes", "external_api_call"],
      inputSchema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] },
      outputSchema: { type: "object", properties: { status: { type: "string" }, importedCount: { type: "number" } } },
      endpointUrl: "https://drive.googleapis.com/v3/files",
      authType: "OAUTH",
      priceMonthlyCents: 499,
      costPerExecutionCents: 0,
      isActive: true,
      authorId: "admin",
    },
    {
      id: "p3",
      key: "latex_formatter",
      name: "LaTeX Equation Formatter",
      version: "2.1.0",
      description: "Format study materials and scientific formulas to high-fidelity LaTeX notation dynamically.",
      permissions: ["write_notes"],
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      outputSchema: { type: "object", properties: { formattedText: { type: "string" } } },
      scriptCode: "const mathText = input.text || '';\n// Simple sandboxed regex compiler\nconst formatted = mathText.replace(/x\\^2/g, '$x^2$');\nreturn { formattedText: formatted };",
      authType: "NONE",
      priceMonthlyCents: 0,
      costPerExecutionCents: 1, // 1 cent per execution
      isActive: true,
      authorId: "admin",
    },
    {
      id: "p4",
      key: "wikipedia_search",
      name: "Wikipedia Search",
      version: "1.0.0",
      description: "Instantly fetch summaries, reference articles, and historical details to enrich lecture context.",
      permissions: ["external_api_call"],
      inputSchema: { type: "object", properties: { searchTerm: { type: "string" } }, required: ["searchTerm"] },
      outputSchema: { type: "object", properties: { articleSummary: { type: "string" } } },
      endpointUrl: "https://en.wikipedia.org/w/api.php",
      authType: "NONE",
      priceMonthlyCents: 0,
      costPerExecutionCents: 0,
      isActive: true,
      authorId: "admin",
    }
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
        // Fetch from actual NestJS API endpoints
        const resStore = await fetch(`${apiUrl}/api/marketplace/plugins`, {
          headers: { Authorization: `Bearer ${activeToken}` }
        });
        const resInst = await fetch(`${apiUrl}/api/plugins/installed`, {
          headers: { Authorization: `Bearer ${activeToken}` }
        });
        
        if (resStore.ok && resInst.ok) {
          const storeData = await resStore.json();
          const instData = await resInst.json();
          
          setPlugins(storeData.length > 0 ? storeData : defaultPlugins);
          setInstalledList(instData);
          
          // Seed secret keys config
          const configMap: Record<string, string> = {};
          instData.forEach((i: any) => {
            if (i.config && i.config.apiKey) {
              configMap[i.id] = i.config.apiKey;
            }
          });
          setPluginConfigs(configMap);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn("Failed fetching from backend, reverting to local state:", err);
    }
    
    // Default local simulation
    setPlugins(defaultPlugins);
    setLoading(false);
  };

  const handleInstall = async (pluginId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/plugins/install`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ pluginId })
        });
        if (res.ok) {
          await loadData(token);
          return;
        }
      }
    } catch (err) {
      console.error("Install request error:", err);
    }

    // Local fallback/mock simulation
    const updatedPlugins = plugins.map(p => p.id === pluginId ? { ...p, installed: true } : p);
    setPlugins(updatedPlugins);
    const target = plugins.find(p => p.id === pluginId);
    if (target && !installedList.some(i => i.id === pluginId)) {
      setInstalledList([...installedList, { ...target, installedAt: new Date().toISOString() }]);
    }
  };

  const handleUninstall = async (pluginId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/plugins/install/${pluginId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          await loadData(token);
          return;
        }
      }
    } catch (err) {
      console.error("Uninstall request error:", err);
    }

    // Local fallback/mock simulation
    const updatedPlugins = plugins.map(p => p.id === pluginId ? { ...p, installed: false } : p);
    setPlugins(updatedPlugins);
    setInstalledList(installedList.filter(i => i.id !== pluginId));
  };

  const handleSaveConfig = async (pluginId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    const key = pluginConfigs[pluginId] || "";
    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/plugins/install`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ pluginId, config: { apiKey: key } })
        });
        if (res.ok) {
          setStatusMessage("API key configuration saved successfully!");
          setTimeout(() => setStatusMessage(""), 3000);
          return;
        }
      }
    } catch (err) {
      console.error("Save config error:", err);
    }
    
    setStatusMessage("API key configuration saved successfully! (Simulation)");
    setTimeout(() => setStatusMessage(""), 3000);
  };

  const handlePublish = async (e: React.FormEvent) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    e.preventDefault();
    const payload = {
      key: devKey,
      name: devName,
      version: devVersion,
      description: devDesc,
      permissions: devPermissions,
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      outputSchema: { type: "object", properties: { result: { type: "string" } } },
      endpointUrl: devType === "HTTP" ? devEndpoint : undefined,
      scriptCode: devType === "SCRIPT" ? devScript : undefined,
      authType: "NONE",
      priceMonthlyCents: 0,
      costPerExecutionCents: 0,
    };

    try {
      if (token) {
        const res = await fetch(`${apiUrl}/api/marketplace/plugins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          setStatusMessage("Plugin published successfully to the marketplace catalog!");
          await loadData(token);
          setActiveTab("store");
          return;
        } else {
          const errData = await res.json();
          setStatusMessage(`Publishing failed: ${errData.message}`);
          return;
        }
      }
    } catch (err: any) {
      console.error("Publish request error:", err);
    }

    // Local simulation fallback
    const newPlugin: PluginInfo = {
      id: `p-${Date.now()}`,
      key: payload.key,
      name: payload.name,
      version: payload.version,
      description: payload.description,
      permissions: payload.permissions,
      inputSchema: payload.inputSchema,
      outputSchema: payload.outputSchema,
      endpointUrl: payload.endpointUrl,
      scriptCode: payload.scriptCode,
      authType: payload.authType,
      priceMonthlyCents: payload.priceMonthlyCents,
      costPerExecutionCents: payload.costPerExecutionCents,
      isActive: true,
      authorId: "developer"
    };

    setPlugins([...plugins, newPlugin]);
    setStatusMessage("Plugin published successfully to local marketplace store! (Simulation)");
    setTimeout(() => {
      setStatusMessage("");
      setActiveTab("store");
    }, 2000);
  };

  const handlePermissionToggle = (permission: string) => {
    if (devPermissions.includes(permission)) {
      setDevPermissions(devPermissions.filter(p => p !== permission));
    } else {
      setDevPermissions([...devPermissions, permission]);
    }
  };

  // Category matcher
  const categoryFilters = [
    { label: "All Packages", value: "ALL" },
    { label: "Study Helpers", value: "study" },
    { label: "Data Importers", value: "google_drive" },
    { label: "AI & Formatters", value: "latex" },
  ];

  const filteredPlugins = plugins.filter(p => {
    if (selectedCategory === "ALL") return true;
    if (selectedCategory === "study") return p.key.includes("wolfram") || p.key.includes("wiki");
    if (selectedCategory === "google_drive") return p.key.includes("drive");
    if (selectedCategory === "latex") return p.key.includes("latex");
    return true;
  });

  return (
    <main style={{ padding: "45px 30px", maxWidth: "1250px", margin: "0 auto", position: "relative" }}>
      {/* Background radial glows */}
      <div className="bg-glow-1" />
      <div className="bg-glow-2" />

      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px" }}>
        <div>
          <span style={{
            fontSize: "0.8rem",
            color: "var(--color-secondary)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: "8px",
            display: "block"
          }}>
            AI Agent & Extensibility Platform
          </span>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, color: "#fff", margin: 0 }}>
            Plugin Marketplace
          </h1>
        </div>

        {/* Tab Switching Navigation */}
        <div style={{
          display: "flex",
          gap: "4px",
          background: "var(--bg-tertiary)",
          padding: "4px",
          borderRadius: "8px",
          border: "1px solid var(--glass-border)",
        }}>
          {[
            { id: "store", label: "Browse Store", icon: "🌐" },
            { id: "installed", label: "My Workspace Tools", icon: "⚙️" },
            { id: "analytics", label: "Usage Dashboard", icon: "📊" },
            { id: "developer", label: "Developer Studio", icon: "🛠️" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                background: activeTab === tab.id ? "var(--color-primary)" : "transparent",
                color: activeTab === tab.id ? "#fff" : "var(--color-text-secondary)",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.9rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
              }}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {statusMessage && (
        <div className="glass-panel" style={{
          padding: "12px 20px",
          marginBottom: "24px",
          borderColor: "rgba(16, 185, 129, 0.4)",
          background: "rgba(16, 185, 129, 0.05)",
          color: "var(--color-success)",
          fontWeight: 500,
          borderRadius: "8px",
          fontSize: "0.95rem"
        }}>
          💡 {statusMessage}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "100px 0", color: "var(--color-text-secondary)" }}>
          <p style={{ fontSize: "1.2rem", fontWeight: 500 }}>Syncing Marketplace registry...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: BROWSE STORE */}
          {activeTab === "store" && (
            <div>
              {/* Category selector row */}
              <div style={{ display: "flex", gap: "10px", marginBottom: "30px" }}>
                {categoryFilters.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => setSelectedCategory(cat.value)}
                    style={{
                      padding: "8px 16px",
                      background: selectedCategory === cat.value ? "rgba(255,255,255,0.08)" : "transparent",
                      color: selectedCategory === cat.value ? "#fff" : "var(--color-text-secondary)",
                      border: "1px solid",
                      borderColor: selectedCategory === cat.value ? "var(--color-secondary)" : "var(--glass-border)",
                      borderRadius: "20px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      transition: "all 0.2s"
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Plugin Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "24px" }}>
                {filteredPlugins.map((plugin) => {
                  const isInstalled = installedList.some(i => i.id === plugin.id) || plugin.installed;
                  return (
                    <div
                      className="glass-panel"
                      key={plugin.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        height: "100%",
                      }}
                    >
                      <div>
                        {/* Title bar */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                          <div>
                            <h3 style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 600, margin: "0 0 4px 0" }}>
                              {plugin.name}
                            </h3>
                            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                              v{plugin.version} • Author: {plugin.authorId}
                            </span>
                          </div>
                          <span style={{
                            padding: "4px 10px",
                            borderRadius: "12px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: plugin.priceMonthlyCents > 0 ? "rgba(99, 102, 241, 0.15)" : "rgba(6, 182, 212, 0.15)",
                            color: plugin.priceMonthlyCents > 0 ? "var(--color-primary)" : "var(--color-secondary)"
                          }}>
                            {plugin.priceMonthlyCents > 0 ? `$${(plugin.priceMonthlyCents / 100).toFixed(2)}/mo` : "Free"}
                          </span>
                        </div>

                        {/* Description */}
                        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "20px" }}>
                          {plugin.description}
                        </p>

                        {/* Permission tokens */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "24px" }}>
                          {plugin.permissions.map((p) => (
                            <code
                              key={p}
                              style={{
                                padding: "2px 8px",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid var(--glass-border)",
                                borderRadius: "4px",
                                fontSize: "0.75rem",
                                color: "var(--color-text-secondary)"
                              }}
                            >
                              🔑 {p}
                            </code>
                          ))}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                          {plugin.costPerExecutionCents > 0 ? `Cost: $${(plugin.costPerExecutionCents / 100).toFixed(2)}/run` : "No run fees"}
                        </span>
                        {isInstalled ? (
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              onClick={() => {
                                setActiveTab("installed");
                              }}
                              style={{
                                padding: "8px 12px",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid var(--glass-border)",
                                borderRadius: "6px",
                                color: "#fff",
                                fontSize: "0.85rem",
                                cursor: "pointer",
                                fontWeight: 500
                              }}
                            >
                              Configure
                            </button>
                            <button
                              onClick={() => handleUninstall(plugin.id)}
                              style={{
                                padding: "8px 12px",
                                background: "rgba(244, 63, 94, 0.1)",
                                border: "1px solid rgba(244, 63, 94, 0.2)",
                                borderRadius: "6px",
                                color: "var(--color-error)",
                                fontSize: "0.85rem",
                                cursor: "pointer",
                                fontWeight: 500
                              }}
                            >
                              Uninstall
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleInstall(plugin.id)}
                            style={{
                              padding: "8px 20px",
                              background: "var(--color-primary)",
                              border: "none",
                              borderRadius: "6px",
                              color: "#fff",
                              fontSize: "0.85rem",
                              cursor: "pointer",
                              fontWeight: 600,
                              boxShadow: "0 4px 12px var(--color-primary-glow)"
                            }}
                          >
                            Install Package
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: MY WORKSPACE TOOLS */}
          {activeTab === "installed" && (
            <div>
              {installedList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "80px 0" }}>
                  <p style={{ fontSize: "1.1rem", color: "var(--color-text-secondary)", marginBottom: "20px" }}>
                    No plugins installed in this study workspace yet.
                  </p>
                  <button
                    onClick={() => setActiveTab("store")}
                    style={{
                      padding: "10px 24px",
                      background: "var(--color-primary)",
                      border: "none",
                      borderRadius: "6px",
                      color: "#fff",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Browse Extensions Store
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  {installedList.map((inst) => (
                    <div className="glass-panel" key={inst.id} style={{ display: "flex", gap: "30px", alignItems: "flex-start" }}>
                      {/* Left Block info */}
                      <div style={{ flex: "1" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                          <h3 style={{ color: "#fff", margin: 0 }}>{inst.name}</h3>
                          <span style={{
                            padding: "2px 8px",
                            background: "rgba(255,255,255,0.05)",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            color: "var(--color-text-secondary)"
                          }}>
                            {inst.key}
                          </span>
                        </div>
                        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "16px" }}>
                          {inst.description}
                        </p>

                        <div style={{ display: "flex", gap: "20px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                          <span>Permissions: <strong>{inst.permissions.join(", ")}</strong></span>
                          <span>Execution model: <strong>{inst.endpointUrl ? "Outbound HTTP API" : "Sandboxed Local Engine"}</strong></span>
                        </div>
                      </div>

                      {/* Right Config Block */}
                      <div style={{
                        width: "350px",
                        background: "rgba(0,0,0,0.2)",
                        padding: "16px",
                        borderRadius: "8px",
                        border: "1px solid var(--glass-border)"
                      }}>
                        <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "12px" }}>Configuration Credentials</h4>
                        {inst.authType === "API_KEY" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <label style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                              Access Secret / API Key
                            </label>
                            <input
                              type="password"
                              placeholder="••••••••••••••••"
                              value={pluginConfigs[inst.id] || ""}
                              onChange={(e) => setPluginConfigs({ ...pluginConfigs, [inst.id]: e.target.value })}
                              style={{
                                padding: "8px 12px",
                                background: "var(--bg-primary)",
                                border: "1px solid var(--glass-border)",
                                borderRadius: "4px",
                                color: "#fff",
                                fontSize: "0.85rem",
                                outline: "none"
                              }}
                            />
                            <button
                              onClick={() => handleSaveConfig(inst.id)}
                              style={{
                                padding: "8px",
                                background: "var(--color-secondary)",
                                border: "none",
                                borderRadius: "4px",
                                color: "#fff",
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.2s"
                              }}
                            >
                              Save credentials
                            </button>
                          </div>
                        ) : (
                          <div style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                            {inst.authType === "OAUTH" ? (
                              <span>🔐 Uses OAuth single sign-on authentication. Workspace status active.</span>
                            ) : (
                              <span>🌐 Public API. No additional auth required for execution.</span>
                            )}
                          </div>
                        )}
                        
                        <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                          <button
                            onClick={() => handleUninstall(inst.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--color-error)",
                              fontSize: "0.8rem",
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            Disable Extension
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: USAGE & ANALYTICS DASHBOARD */}
          {activeTab === "analytics" && (
            <div>
              {/* Top stats block */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "30px" }}>
                {[
                  { label: "Total Executions", value: "2,408", glow: "var(--color-primary-glow)", color: "var(--color-primary)" },
                  { label: "Avg Latency", value: "245ms", glow: "var(--color-secondary-glow)", color: "var(--color-secondary)" },
                  { label: "Spend incurred", value: "$0.18", glow: "rgba(16, 185, 129, 0.15)", color: "var(--color-success)" },
                  { label: "Failure Rate", value: "0.12%", glow: "rgba(244, 63, 94, 0.15)", color: "var(--color-error)" },
                ].map((stat, idx) => (
                  <div className="glass-panel" key={idx} style={{ background: stat.glow, border: `1px solid ${stat.color}33`, textAlign: "center" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
                      {stat.label}
                    </span>
                    <strong style={{ fontSize: "1.8rem", color: "#fff", fontFamily: "var(--font-display)" }}>
                      {stat.value}
                    </strong>
                  </div>
                ))}
              </div>

              {/* Graphic Chart representation */}
              <div className="glass-panel" style={{ marginBottom: "30px" }}>
                <h3 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "20px" }}>Plugin Calls (Last 7 Days)</h3>
                
                {/* CSS Columns chart */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", height: "180px", padding: "0 10px", borderBottom: "1px solid var(--glass-border)" }}>
                  {[
                    { day: "Mon", calls: 120, height: "45%" },
                    { day: "Tue", calls: 190, height: "70%" },
                    { day: "Wed", calls: 140, height: "50%" },
                    { day: "Thu", calls: 240, height: "90%" },
                    { day: "Fri", calls: 210, height: "80%" },
                    { day: "Sat", calls: 80, height: "30%" },
                    { day: "Sun", calls: 95, height: "35%" },
                  ].map((d, index) => (
                    <div key={index} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "8%" }}>
                      <span style={{ fontSize: "0.75rem", color: "#fff", marginBottom: "6px" }}>{d.calls}</span>
                      <div style={{
                        width: "100%",
                        height: "100px", // container height
                        display: "flex",
                        alignItems: "flex-end"
                      }}>
                        <div style={{
                          width: "100%",
                          height: d.height,
                          background: "linear-gradient(to top, var(--color-primary), var(--color-secondary))",
                          borderRadius: "4px 4px 0 0",
                          boxShadow: "0 0 10px var(--color-secondary-glow)"
                        }} />
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", marginTop: "8px" }}>{d.day}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Logs Table */}
              <div className="glass-panel">
                <h3 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "20px" }}>Recent Execution Audit Logs</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.9rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--glass-border)", color: "var(--color-text-muted)" }}>
                      <th style={{ padding: "12px 8px" }}>Agent Tool</th>
                      <th style={{ padding: "12px 8px" }}>Triggered</th>
                      <th style={{ padding: "12px 8px" }}>Latency</th>
                      <th style={{ padding: "12px 8px" }}>Status</th>
                      <th style={{ padding: "12px 8px" }}>Cost (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", color: "var(--color-text-secondary)" }}>
                        <td style={{ padding: "12px 8px", color: "#fff", fontWeight: 500 }}>{log.name}</td>
                        <td style={{ padding: "12px 8px" }}>{log.timestamp}</td>
                        <td style={{ padding: "12px 8px" }}>{log.latency}</td>
                        <td style={{ padding: "12px 8px" }}>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: log.status === 200 ? "rgba(16, 185, 129, 0.1)" : "rgba(244, 63, 94, 0.1)",
                            color: log.status === 200 ? "var(--color-success)" : "var(--color-error)"
                          }}>
                            {log.status === 200 ? "Success" : "Failed"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 8px" }}>{log.cost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: DEVELOPER STUDIO */}
          {activeTab === "developer" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "30px" }}>
              {/* Left block form */}
              <div className="glass-panel">
                <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "20px" }}>Register & Publish AI Tool</h3>
                
                <form onSubmit={handlePublish} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Unique Key / Identifier</label>
                      <input
                        type="text"
                        value={devKey}
                        onChange={(e) => setDevKey(e.target.value)}
                        required
                        style={{
                          padding: "10px 14px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.9rem",
                          outline: "none"
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Display Name</label>
                      <input
                        type="text"
                        value={devName}
                        onChange={(e) => setDevName(e.target.value)}
                        required
                        style={{
                          padding: "10px 14px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.9rem",
                          outline: "none"
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Version</label>
                      <input
                        type="text"
                        value={devVersion}
                        onChange={(e) => setDevVersion(e.target.value)}
                        required
                        style={{
                          padding: "10px 14px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.9rem",
                          outline: "none"
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Runtime Type</label>
                      <select
                        value={devType}
                        onChange={(e: any) => setDevType(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.9rem",
                          outline: "none"
                        }}
                      >
                        <option value="SCRIPT">Local Sandboxed JavaScript Script</option>
                        <option value="HTTP">Remote HTTP Action URL</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Tool Description</label>
                    <textarea
                      value={devDesc}
                      onChange={(e) => setDevDesc(e.target.value)}
                      rows={3}
                      required
                      style={{
                        padding: "10px 14px",
                        background: "var(--bg-primary)",
                        border: "1px solid var(--glass-border)",
                        borderRadius: "6px",
                        color: "#fff",
                        fontSize: "0.9rem",
                        outline: "none",
                        resize: "vertical"
                      }}
                    />
                  </div>

                  {devType === "HTTP" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Remote Endpoint URL</label>
                      <input
                        type="url"
                        value={devEndpoint}
                        onChange={(e) => setDevEndpoint(e.target.value)}
                        required
                        style={{
                          padding: "10px 14px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.9rem",
                          outline: "none"
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Local Sandboxed JS Code</label>
                      <textarea
                        value={devScript}
                        onChange={(e) => setDevScript(e.target.value)}
                        rows={6}
                        required
                        style={{
                          padding: "10px 14px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: "#99ff99",
                          fontFamily: "monospace",
                          fontSize: "0.85rem",
                          outline: "none",
                          resize: "vertical"
                        }}
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    style={{
                      padding: "12px",
                      background: "var(--color-primary)",
                      border: "none",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      marginTop: "10px",
                      boxShadow: "0 4px 12px var(--color-primary-glow)"
                    }}
                  >
                    Publish to Marketplace
                  </button>
                </form>
              </div>

              {/* Right block guidance panel */}
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div className="glass-panel" style={{ background: "rgba(99, 102, 241, 0.03)" }}>
                  <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "12px" }}>Security & Isolation</h4>
                  <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", lineHeight: 1.4, marginBottom: "12px" }}>
                    Your custom plugins are executed under a strictly isolated sandboxed boundary.
                  </p>
                  <ul style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <li>No access to Host Database</li>
                    <li>No access to file system or process context</li>
                    <li>Strict 1000ms CPU timeout limits</li>
                    <li>Resolved subnets SSRF validations block intranet execution</li>
                  </ul>
                </div>

                <div className="glass-panel">
                  <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "12px" }}>Requested Scopes</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {[
                      { key: "read_documents", name: "Read Documents Context" },
                      { key: "write_notes", name: "Write Summary Notes" },
                      { key: "access_chat_context", name: "Access Last 5 Messages" },
                      { key: "external_api_call", name: "Outbound API Fetch Calls" },
                    ].map((scope) => (
                      <label key={scope.key} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={devPermissions.includes(scope.key)}
                          onChange={() => handlePermissionToggle(scope.key)}
                          style={{ cursor: "pointer" }}
                        />
                        {scope.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
