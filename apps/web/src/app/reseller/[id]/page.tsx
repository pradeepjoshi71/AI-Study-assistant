"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function TenantDetailsPage({ params }: PageProps) {
  const { id: tenantId } = use(params);

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<any>(null);

  // Edit config states
  const [appName, setAppName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");
  const [secondaryColor, setSecondaryColor] = useState("#8b5cf6");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [customCss, setCustomCss] = useState("");
  
  // File upload state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Features state
  const [features, setFeatures] = useState<any>({
    marketplace: false,
    voice: false,
    groups: true,
    api_access: false,
    custom_branding: false,
  });

  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
      loadTenantData(savedToken);
    }
  }, [tenantId]);

  const loadTenantData = async (activeToken: string) => {
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/reseller/tenants/${tenantId}`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) throw new Error("Tenant not found");

      const data = await res.json();
      setTenant(data);

      const cfg = data.config || {};
      setAppName(cfg.appName || data.name);
      setSupportEmail(cfg.supportEmail || "");
      setPrimaryColor(cfg.primaryColor || "#6366f1");
      setSecondaryColor(cfg.secondaryColor || "#8b5cf6");
      setFontFamily(cfg.fontFamily || "Inter");
      setCustomCss(cfg.customCss || "");
      setLogoPreview(cfg.logoUrl || null);
      setFeatures(cfg.features || {
        marketplace: false,
        voice: false,
        groups: true,
        api_access: false,
        custom_branding: false,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFeatureToggle = (key: string) => {
    setFeatures((prev: any) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    setSuccessMsg("");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      // Use FormData to allow file upload
      const formData = new FormData();
      formData.append("appName", appName);
      formData.append("supportEmail", supportEmail);
      formData.append("primaryColor", primaryColor);
      formData.append("secondaryColor", secondaryColor);
      formData.append("fontFamily", fontFamily);
      formData.append("customCss", customCss);
      formData.append("features", JSON.stringify(features));
      if (logoFile) {
        formData.append("logo", logoFile);
      }

      const res = await fetch(`${apiUrl}/reseller/tenants/${tenantId}/config`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Failed to save changes");
      }

      setSuccessMsg("Branding & feature flag updates saved successfully!");
      setTimeout(() => setSuccessMsg(""), 4000);
      if (token) loadTenantData(token);
    } catch (err: any) {
      alert(`Save Failed: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  if (loading && !tenant) {
    return (
      <div style={{ textAlign: "center", padding: "120px 0" }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid var(--glass-border)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 20px" }}></div>
        <p style={{ color: "var(--color-text-secondary)" }}>Loading client tenant details...</p>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div style={{ maxWidth: "800px", margin: "80px auto", textAlign: "center" }} className="glass-panel">
        <h2 style={{ color: "var(--color-error)", marginBottom: "12px" }}>Tenant Not Found</h2>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "20px" }}>The tenant workspace requested does not exist or was deleted.</p>
        <Link href="/reseller" style={{ color: "var(--color-primary)", textDecoration: "none" }}>← Back to Reseller Center</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "40px 20px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
        <div>
          <Link href="/reseller" style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: "0.9rem" }}>
            ← Back to Reseller Center
          </Link>
          <h1 style={{ fontSize: "2.2rem", color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700, marginTop: "10px" }}>
            Manage {tenant.name}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Domain: <span style={{ color: "var(--color-secondary)", fontWeight: 600 }}>{tenant.subdomain}.studyapp.com</span>
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: "30px", alignItems: "start" }}>
        
        {/* Left Block: Editor & Feature toggles */}
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          
          {/* Config form */}
          <div className="glass-panel" style={{ padding: "30px" }}>
            <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "20px" }}>Custom Branding Editor</h3>
            
            {successMsg && (
              <div style={{ background: "var(--color-success-glow)", border: "1px solid var(--color-success)", color: "#fff", borderRadius: "8px", padding: "12px", marginBottom: "20px", fontSize: "0.9rem" }}>
                ✓ {successMsg}
              </div>
            )}

            <form onSubmit={handleUpdateConfig} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Portal Custom Title</label>
                  <input
                    type="text"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    required
                    style={{ padding: "10px 14px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Support Email</label>
                  <input
                    type="email"
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    required
                    style={{ padding: "10px 14px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Font Family</label>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    style={{ padding: "10px 14px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "8px", color: "#fff", outline: "none" }}
                  >
                    <option value="Inter">Inter (Sans Serif)</option>
                    <option value="Outfit">Outfit (Display Rounded)</option>
                    <option value="Plus Jakarta Sans">Jakarta Sans</option>
                    <option value="Roboto">Roboto</option>
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Logo Image</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ color: "var(--color-text-secondary)", fontSize: "0.95rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Primary Brand Color</label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      style={{ border: "none", background: "none", width: "40px", height: "40px", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "0.9rem", color: "var(--color-text-secondary)" }}>{primaryColor}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Secondary Brand Color</label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      style={{ border: "none", background: "none", width: "40px", height: "40px", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "0.9rem", color: "var(--color-text-secondary)" }}>{secondaryColor}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Override Custom Stylesheets (CSS)</label>
                <textarea
                  value={customCss}
                  onChange={(e) => setCustomCss(e.target.value)}
                  placeholder="/* Write clean scoped custom styling rules */"
                  style={{
                    minHeight: "100px",
                    padding: "12px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "8px",
                    color: "#fff",
                    outline: "none",
                    fontFamily: "monospace",
                    fontSize: "0.85rem"
                  }}
                />
              </div>

              <button type="submit" disabled={updating} style={{ width: "100%", padding: "12px", borderRadius: "8px", background: "var(--color-primary)", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer", marginTop: "10px" }}>
                {updating ? "Saving config..." : "Save Config Settings"}
              </button>
            </form>
          </div>

          {/* Feature toggles */}
          <div className="glass-panel" style={{ padding: "30px" }}>
            <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "20px" }}>Feature Flags Override</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {Object.keys(features).map((key) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderRadius: "8px", background: "var(--bg-primary)" }}>
                  <div>
                    <strong style={{ color: "#fff", textTransform: "capitalize" }}>{key.replace("_", " ")} Module</strong>
                    <span style={{ display: "block", fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                      {key === "voice" ? "Unlock voice STT/TTS processing" : key === "marketplace" ? "Enable custom quiz marketplaces" : `Toggle standard ${key} options`}
                    </span>
                  </div>
                  <button
                    onClick={() => handleFeatureToggle(key)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      background: features[key] ? "var(--color-success)" : "var(--color-text-muted)",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                      transition: "background 0.2s"
                    }}
                  >
                    {features[key] ? "Enabled" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Block: Live branding preview & Usage Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          
          {/* Live Mockup Preview */}
          <div className="glass-panel" style={{ padding: "24px", borderColor: "rgba(255,255,255,0.15)" }}>
            <h3 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "16px" }}>Live Branding Preview</h3>
            
            <div style={{
              background: "#08080a",
              border: "1px solid var(--glass-border)",
              borderRadius: "10px",
              padding: "20px",
              minHeight: "220px",
              display: "flex",
              flexDirection: "column",
              fontFamily: fontFamily
            }}>
              {/* Header preview */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1c1c24", paddingBottom: "12px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" style={{ width: "24px", height: "24px", borderRadius: "4px", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "24px", height: "24px", background: primaryColor, borderRadius: "4px" }} />
                  )}
                  <span style={{ fontWeight: 700, color: "#fff", fontSize: "0.95rem" }}>{appName}</span>
                </div>
                <span style={{ fontSize: "0.75rem", color: secondaryColor }}>★ Premium Portal</span>
              </div>

              {/* Main content body preview */}
              <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                <h4 style={{ color: "#fff", fontSize: "1rem" }}>Welcome to our study group</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", lineHeight: "1.4" }}>
                  Access premium study packs, complete mock test sessions, and optimize flashcard decks.
                </p>
                <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                  <button style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    background: primaryColor,
                    color: "#fff",
                    border: "none",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "default"
                  }}>
                    Primary Action
                  </button>
                  <button style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: `1px solid ${secondaryColor}`,
                    background: "none",
                    color: secondaryColor,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "default"
                  }}>
                    Secondary
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Usage Stats limits */}
          <div className="glass-panel" style={{ padding: "30px" }}>
            <h3 style={{ color: "#fff", fontSize: "1.15rem", marginBottom: "20px" }}>Usage & Limit Audits</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "8px" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>Organization Workspace Users</span>
                  <span style={{ color: "#fff", fontWeight: 600 }}>{tenant.usage.users} / {tenant.usage.maxUsers}</span>
                </div>
                <div style={{ height: "6px", background: "var(--bg-primary)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(tenant.usage.users / tenant.usage.maxUsers) * 100}%`, background: "var(--color-primary)" }} />
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "8px" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>AI Tokens Transmitted (Monthly)</span>
                  <span style={{ color: "#fff", fontWeight: 600 }}>{tenant.usage.tokens} / {tenant.usage.maxTokens}</span>
                </div>
                <div style={{ height: "6px", background: "var(--bg-primary)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(tenant.usage.tokens / tenant.usage.maxTokens) * 100}%`, background: "var(--color-secondary)" }} />
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "8px" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>Documents Stored</span>
                  <span style={{ color: "#fff", fontWeight: 600 }}>{tenant.usage.docs} / {tenant.usage.maxDocs}</span>
                </div>
                <div style={{ height: "6px", background: "var(--bg-primary)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(tenant.usage.docs / tenant.usage.maxDocs) * 100}%`, background: "var(--color-success)" }} />
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
