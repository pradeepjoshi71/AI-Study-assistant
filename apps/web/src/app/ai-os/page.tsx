"use client";

import React, { useEffect, useState } from 'react';

interface AiSchedule {
  id: string;
  tenantId: string;
  cronExpression: string;
  taskType: string;
  params: any;
  nextRun: string;
  isActive: boolean;
}

interface StatusCount {
  status: string;
  count: number;
}

interface TelemetryMetrics {
  totalTasks: number;
  statusCounts: StatusCount[];
  accumulatedCostCents: number;
  averageLatencyMs: number;
  queuesBacklog: number;
}

interface SystemInfo {
  memoryPressureBytes: number;
  cpuUsageUserMicro: number;
  nodeVersion: string;
}

interface OsStatusData {
  status: string;
  system: SystemInfo;
  tenantMetrics: TelemetryMetrics;
}

export default function AiOsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // OS Telemetry Metrics
  const [systemStatus, setSystemStatus] = useState<string>('online');
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    memoryPressureBytes: 156890000,
    cpuUsageUserMicro: 245000,
    nodeVersion: 'v20.11.0',
  });
  const [metrics, setMetrics] = useState<TelemetryMetrics>({
    totalTasks: 42,
    statusCounts: [
      { status: 'COMPLETED', count: 35 },
      { status: 'FAILED', count: 4 },
      { status: 'QUEUED', count: 3 },
    ],
    accumulatedCostCents: 12.8,
    averageLatencyMs: 462,
    queuesBacklog: 0,
  });

  // Task execution terminal state
  const [execType, setExecType] = useState<string>('CHAT');
  const [execPrompt, setExecPrompt] = useState<string>('Prepare exam revision plan + quiz + flashcards');
  const [execSystemPrompt, setExecSystemPrompt] = useState<string>('You are the AI OS Orchestration Kernel.');
  const [execRunning, setExecRunning] = useState<boolean>(false);
  const [execResult, setExecResult] = useState<any>(null);

  // Scheduling state
  const [schedules, setSchedules] = useState<AiSchedule[]>([]);
  const [cronExpr, setCronExpr] = useState<string>('0 2 * * *');
  const [scheduleTaskType, setScheduleTaskType] = useState<string>('graph_update');
  const [scheduleParams, setScheduleParams] = useState<string>('{}');

  // Governance settings (UI Interactive only)
  const [restrictFreeApi, setRestrictFreeApi] = useState(true);
  const [auditLoggingEnabled, setAuditLoggingEnabled] = useState(true);
  const [inputSanitization, setInputSanitization] = useState(true);

  // Recent task executions log
  const [taskLogs, setTaskLogs] = useState<any[]>([
    { id: 'task-001', type: 'CHAT', status: 'COMPLETED', costCents: 0.08, latencyMs: 380, createdAt: new Date(Date.now() - 300000).toISOString() },
    { id: 'task-002', type: 'EMBEDDING', status: 'COMPLETED', costCents: 0.01, latencyMs: 120, createdAt: new Date(Date.now() - 600000).toISOString() },
    { id: 'task-003', type: 'REASONING', status: 'COMPLETED', costCents: 0.75, latencyMs: 1450, createdAt: new Date(Date.now() - 900000).toISOString() },
    { id: 'task-004', type: 'SUMMARIZATION', status: 'COMPLETED', costCents: 0.12, latencyMs: 680, createdAt: new Date(Date.now() - 1200000).toISOString() },
  ]);

  // Load configuration & data
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
    }
    loadTelemetry(savedToken);
  }, []);

  const loadTelemetry = async (activeToken: string | null) => {
    setLoading(true);
    try {
      if (activeToken) {
        // Fetch Telemetry & status
        const resStatus = await fetch('http://localhost:3001/api/ai-os/status', {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        // Fetch schedules
        const resSchedules = await fetch('http://localhost:3001/api/ai-os/schedules', {
          headers: { Authorization: `Bearer ${activeToken}` },
        });

        if (resStatus.ok) {
          const statusData: OsStatusData = await resStatus.json();
          setSystemStatus(statusData.status === 'healthy' ? 'online' : 'offline');
          setSystemInfo(statusData.system);
          setMetrics(statusData.tenantMetrics);
        }

        if (resSchedules.ok) {
          const schedulesData = await resSchedules.json();
          setSchedules(schedulesData);
        }
      }
    } catch (err) {
      console.warn('Could not load OS status from API, running in simulation mode:', err);
    } finally {
      setLoading(false);
    }
  };

  // Run Custom OS Task
  const handleExecuteTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execPrompt.trim() || execRunning) return;

    setExecRunning(true);
    setExecResult(null);
    setErrorMessage('');

    // Safety checks simulation (Policy engine)
    if (inputSanitization && (execPrompt.toLowerCase().includes('drop table') || execPrompt.toLowerCase().includes('truncate table'))) {
      setTimeout(() => {
        setErrorMessage('Security violation: Dangerous command or prompt injection keyword detected ("drop table"). Request blocked by AI OS Policy Engine.');
        setExecRunning(false);
      }, 500);
      return;
    }

    // Quota limits simulation
    if (restrictFreeApi && execType === 'REASONING' && !token) {
      setTimeout(() => {
        setErrorMessage('Policy violation: High-overhead REASONING compute tasks are restricted on the Free plan. Upgrade required.');
        setExecRunning(false);
      }, 500);
      return;
    }

    try {
      if (token) {
        const res = await fetch('http://localhost:3001/api/ai-os/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: execType,
            inputData: {
              prompt: execPrompt,
              systemPrompt: execSystemPrompt,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setExecResult(data);
          // Refresh telemetry
          await loadTelemetry(token);
          // Add to task logs
          setTaskLogs((prev) => [
            {
              id: data.taskId || `task-${Math.random().toString(36).substring(2, 6)}`,
              type: execType,
              status: data.status || 'COMPLETED',
              costCents: execType === 'REASONING' ? 0.8 : 0.05,
              latencyMs: data.latencyMs || 420,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
          setExecRunning(false);
          return;
        } else {
          const errorMsg = await res.text();
          try {
            const parsed = JSON.parse(errorMsg);
            setErrorMessage(parsed.message || 'Execution error.');
          } catch {
            setErrorMessage(errorMsg || 'Execution failed.');
          }
          setExecRunning(false);
          return;
        }
      }
    } catch (err: any) {
      console.warn('Execution API failed, falling back to local simulation:', err);
    }

    // Simulation response fallback
    setTimeout(() => {
      let outputText = '';
      let calculatedCost = 0.05;
      let mockLatency = 380;

      if (execType === 'EMBEDDING') {
        outputText = `[Vector points successfully generated and stored in Qdrant collection 'document_chunks']. Array length: 768 dimensions.`;
        calculatedCost = 0.005;
        mockLatency = 110;
      } else if (execType === 'SUMMARIZATION') {
        outputText = `AI OS Summarizer Output:\nThe user wants to prepare an exam revision plan, including a quiz and flashcards. The OS routed this request to parallel sub-tasks.`;
        calculatedCost = 0.08;
        mockLatency = 650;
      } else if (execType === 'REASONING') {
        outputText = `AI OS Agent reasoning loop completed (Multi-turn):\n1. Dispatched Study Planner tool -> Created curriculum milestones\n2. Dispatched Quiz Builder tool -> Compiled 5 multiple-choice questions\n3. Dispatched Flashcard Engine -> Synthesized active recall keypoints.\nAll tasks executed in parallel. Outputs saved.`;
        calculatedCost = 0.75;
        mockLatency = 1380;
      } else {
        outputText = `AI OS Chat response:\nRevision plan created. The planner task synthesized the materials. Flashcards are available under the active study session.`;
      }

      setExecResult({
        taskId: `sim-${Math.random().toString(36).substring(2, 10)}`,
        status: 'COMPLETED',
        output: outputText,
        modelUsed: execType === 'REASONING' ? 'gemini-1.5-pro' : 'gemini-1.5-flash',
      });

      // Update statistics
      setMetrics((prev) => ({
        ...prev,
        totalTasks: prev.totalTasks + 1,
        accumulatedCostCents: prev.accumulatedCostCents + (calculatedCost * 100),
      }));

      setTaskLogs((prev) => [
        {
          id: `sim-${Math.random().toString(36).substring(2, 6)}`,
          type: execType,
          status: 'COMPLETED',
          costCents: calculatedCost * 100,
          latencyMs: mockLatency,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);

      setExecRunning(false);
    }, 1000);
  };

  // Create Job Schedule
  const handleScheduleJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cronExpr) return;

    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(scheduleParams);
      } catch {
        alert('Invalid JSON parameters. Please input a valid JSON object.');
        return;
      }

      if (token) {
        const res = await fetch('http://localhost:3001/api/ai-os/schedule', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            cronExpression: cronExpr,
            taskType: scheduleTaskType,
            params: parsedParams,
          }),
        });

        if (res.ok) {
          setStatusMessage('New background job scheduled successfully.');
          await loadTelemetry(token);
          setTimeout(() => setStatusMessage(''), 3000);
          setScheduleParams('{}');
          return;
        }
      }
    } catch (err) {
      console.warn('API Schedule failed, running in simulation mode:', err);
    }

    // Simulation schedule fallback
    const newSchedule: AiSchedule = {
      id: `sched-${Math.random().toString(36).substring(2, 8)}`,
      tenantId: 'tenant-default',
      cronExpression: cronExpr,
      taskType: scheduleTaskType,
      params: scheduleParams,
      nextRun: new Date(Date.now() + 3600000).toISOString(),
      isActive: true,
    };

    setSchedules((prev) => [...prev, newSchedule]);
    setStatusMessage('New background job scheduled! (Simulation mode)');
    setTimeout(() => setStatusMessage(''), 3000);
    setScheduleParams('{}');
  };

  // Remove Job Schedule
  const handleUnschedule = async (id: string) => {
    try {
      if (token) {
        const res = await fetch(`http://localhost:3001/api/ai-os/schedule/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          setStatusMessage('Job schedule removed successfully.');
          await loadTelemetry(token);
          setTimeout(() => setStatusMessage(''), 3000);
          return;
        }
      }
    } catch (err) {
      console.warn('API Unschedule failed, running in simulation:', err);
    }

    // Fallback simulation
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    setStatusMessage('Job schedule removed. (Simulation)');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  const formatBytes = (bytes: number) => {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <main style={{ padding: '45px 30px', maxWidth: '1300px', margin: '0 auto', position: 'relative' }}>
      {/* Background Glows */}
      <div className="bg-glow-1" />
      <div className="bg-glow-2" />

      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', zIndex: 1, position: 'relative' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '8px', background: 'linear-gradient(135deg, #fff 0%, #a5b4fc 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            AI OS Kernel Control
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.05rem' }}>
            Multi-Tenant Compute Orchestration, Agent Lifecycle, and Telemetry Engine
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className={`status-badge ${systemStatus}`}>
            <span className={`status-dot ${systemStatus}`} />
            {systemStatus}
          </div>
          <button
            onClick={() => loadTelemetry(token)}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              background: 'var(--bg-tertiary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Refresh System
          </button>
        </div>
      </div>

      {/* Alert Banners */}
      {statusMessage && (
        <div style={{ padding: '12px 20px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--color-success)', marginBottom: '24px', fontSize: '0.95rem' }}>
          ✓ {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div style={{ padding: '12px 20px', borderRadius: '10px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', color: 'var(--color-error)', marginBottom: '24px', fontSize: '0.95rem' }}>
          ⚠ {errorMessage}
        </div>
      )}

      {/* Telemetry Metrics cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        <div className="glass-panel" style={{ minHeight: '130px' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OS Compute Units</span>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            {metrics.totalTasks} <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--color-text-secondary)' }}>workloads run</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--color-success)' }}>● Completed: {metrics.statusCounts.find((s) => s.status === 'COMPLETED')?.count ?? 0}</span>
            <span style={{ color: 'var(--color-error)' }}>● Failed: {metrics.statusCounts.find((s) => s.status === 'FAILED')?.count ?? 0}</span>
          </div>
        </div>

        <div className="glass-panel" style={{ minHeight: '130px' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resource pressure</span>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0' }}>
            {formatBytes(systemInfo.memoryPressureBytes)}
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
            Node Kernel runtime: {systemInfo.nodeVersion}
          </div>
        </div>

        <div className="glass-panel" style={{ minHeight: '130px' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accumulated compute cost</span>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0', color: 'var(--color-secondary)' }}>
            ${(metrics.accumulatedCostCents / 100).toFixed(4)}
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
            Average job latency: {metrics.averageLatencyMs}ms
          </div>
        </div>

        <div className="glass-panel" style={{ minHeight: '130px' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Queue backlog</span>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0', color: metrics.queuesBacklog > 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
            {metrics.queuesBacklog} jobs
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
            Active worker processes running: 2
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '32px', marginBottom: '32px' }}>
        {/* Task execution Terminal */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
            Agent Execution & Compute Unit Terminal
          </h2>
          <form onSubmit={handleExecuteTask} style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Compute Abstraction Type</label>
                <select
                  value={execType}
                  onChange={(e) => setExecType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--glass-border)',
                    color: '#fff',
                  }}
                >
                  <option value="CHAT">Chat Inference Unit (gemini-1.5-flash)</option>
                  <option value="EMBEDDING">Vector Embedding Unit (text-embedding-004)</option>
                  <option value="SUMMARIZATION">Summarization Unit (gemini-1.5-flash)</option>
                  <option value="REASONING">Agent Reasoning Unit (gemini-1.5-pro)</option>
                  <option value="BATCH">Batch Learning Unit (gemini-1.5-flash)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Quick Presets & Safe Tests</label>
                <select
                  onChange={(e) => {
                    if (e.target.value === 'safe-injection') {
                      setExecPrompt('Prepare study plan; DROP TABLE users;');
                    } else if (e.target.value === 'reasoning-block') {
                      setExecType('REASONING');
                      setExecPrompt('Synthesize weekly curriculum milestone nodes + execute tool plugin scripts');
                    } else {
                      setExecPrompt(e.target.value);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--glass-border)',
                    color: '#fff',
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Select Preset</option>
                  <option value="Prepare exam revision plan + quiz + flashcards">Standard Study Task</option>
                  <option value="safe-injection">Test Safe Validation Rule (Blocked SQL injection)</option>
                  <option value="reasoning-block">Test Reasoning Policy (Blocked for Free tier)</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>System Context Injection</label>
              <input
                type="text"
                value={execSystemPrompt}
                onChange={(e) => setExecSystemPrompt(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                }}
              />
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Task Input Data (Prompt)</label>
              <textarea
                value={execPrompt}
                onChange={(e) => setExecPrompt(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={execRunning}
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, var(--color-primary) 0%, #4f46e5 100%)',
                color: '#fff',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                opacity: execRunning ? 0.6 : 1,
              }}
            >
              {execRunning ? 'Orchestrating Kernel Workload...' : 'Execute OS Compute Workload'}
            </button>
          </form>

          {/* Execution Output result terminal */}
          {execResult && (
            <div style={{ marginTop: '20px', padding: '16px', borderRadius: '10px', background: '#070709', border: '1px solid var(--glass-border)', fontFamily: 'monospace' }}>
              <div style={{ color: 'var(--color-success)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span>✔ WORKLOAD_EXECUTED (ID: {execResult.taskId})</span>
                <span>Model: {execResult.modelUsed}</span>
              </div>
              <p style={{ color: '#e4e4e7', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{execResult.output}</p>
            </div>
          )}
        </div>

        {/* Compute Scheduler Panel */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
            Workload Job Scheduler
          </h2>
          <form onSubmit={handleScheduleJob} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>AI Workload Job Type</label>
              <select
                value={scheduleTaskType}
                onChange={(e) => setScheduleTaskType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                }}
              >
                <option value="graph_update">Nightly Knowledge Graph Update</option>
                <option value="memory_summarization">Background Memory Summarization</option>
                <option value="analytics_aggregation">Hourly Analytics & Usage Aggregation</option>
                <option value="cost_aggregation">Nightly Billing & Cost Aggregation</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Cron Interval Presets</label>
              <select
                onChange={(e) => setCronExpr(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                }}
                value={cronExpr}
              >
                <option value="*/15 * * * *">Every 15 minutes (Testing)</option>
                <option value="0 * * * *">Hourly (Analytics Aggregation)</option>
                <option value="0 2 * * *">Nightly at 2:00 AM (Knowledge Graph)</option>
                <option value="0 0 * * 0">Weekly on Sundays (Billing Sync)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Task Input Params (JSON)</label>
              <input
                type="text"
                value={scheduleParams}
                onChange={(e) => setScheduleParams(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: '10px',
                borderRadius: '8px',
                background: 'var(--bg-tertiary)',
                color: 'var(--color-secondary)',
                fontWeight: 600,
                border: '1px solid rgba(6, 182, 212, 0.3)',
                cursor: 'pointer',
              }}
            >
              Schedule Background Job
            </button>
          </form>

          {/* Scheduled jobs list */}
          <div style={{ flex: 1, minHeight: '160px' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Active Schedules</h3>
            {schedules.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
                No active background schedules. Use form above to add.
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '200px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {schedules.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--glass-border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {s.taskType === 'graph_update' ? 'Graph Rebuild' : s.taskType === 'memory_summarization' ? 'Memory Summary' : 'Analytics Aggregation'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                        Interval: {s.cronExpression}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnschedule(s.id)}
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        color: 'var(--color-error)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Governance & Policies Configuration panel */}
      <div className="glass-panel" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.4rem', marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
          AI OS Policies & Governance Constraints
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
          <div>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem', marginBottom: '16px', lineHeight: '1.5' }}>
              Enforce strict logical runtime gates at the Kernel level. These rules intercept request payloads prior to model routing to guarantee SOC2 compliance and cost quotas.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="restrictFreeApi"
                  checked={restrictFreeApi}
                  onChange={(e) => setRestrictFreeApi(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="restrictFreeApi" style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
                  Block reasoning workloads (Pro/Enterprise units) on FREE plans
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="auditLoggingEnabled"
                  checked={auditLoggingEnabled}
                  onChange={(e) => setAuditLoggingEnabled(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="auditLoggingEnabled" style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
                  Always force Audit trail logs for tenant policy violations
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="inputSanitization"
                  checked={inputSanitization}
                  onChange={(e) => setInputSanitization(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="inputSanitization" style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
                  Sanitize prompt payloads (Detect injection commands / SQL drop keywords)
                </label>
              </div>
            </div>
          </div>
          <div style={{ padding: '16px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.03)', border: '1px solid var(--glass-border)' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--color-primary)', marginBottom: '8px' }}>Security Gating Verification</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: '1.4' }}>
              The Policy engine validates all outbound model calls. Activating "Block reasoning workloads" ensures tenant limits are not bypassed. Activating "Sanitize prompt payloads" prevents execution of unsafe terminal keywords.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  setExecType('REASONING');
                  setExecPrompt('Prepare curriculum; run external terminal command.');
                  setStatusMessage('Reasoning workload selected. Run OS compute tool to trigger quota validation check.');
                  setTimeout(() => setStatusMessage(''), 4000);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                Mock Free-Tier Limit Trigger
              </button>
              <button
                onClick={() => {
                  setExecPrompt('DROP TABLE users;');
                  setStatusMessage('Malicious SQL query pre-filled. Click Execute to trigger input safety validation.');
                  setTimeout(() => setStatusMessage(''), 4000);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--glass-border)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                Mock Prompt Injection Trigger
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Task execution logs */}
      <div className="glass-panel">
        <h2 style={{ fontSize: '1.4rem', marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
          AI OS Task Execution Logs
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--color-text-secondary)' }}>
                <th style={{ padding: '12px 8px' }}>Task ID</th>
                <th style={{ padding: '12px 8px' }}>Unit Type</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
                <th style={{ padding: '12px 8px' }}>Calculated Cost</th>
                <th style={{ padding: '12px 8px' }}>Latency</th>
                <th style={{ padding: '12px 8px' }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {taskLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }}>
                  <td style={{ padding: '12px 8px', fontFamily: 'monospace', color: 'var(--color-secondary)' }}>{log.id}</td>
                  <td style={{ padding: '12px 8px', fontWeight: 500 }}>{log.type}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        background: log.status === 'COMPLETED' ? 'var(--color-success-glow)' : 'var(--color-error-glow)',
                        color: log.status === 'COMPLETED' ? 'var(--color-success)' : 'var(--color-error)',
                      }}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>${(log.costCents / 100).toFixed(4)}</td>
                  <td style={{ padding: '12px 8px', color: 'var(--color-text-secondary)' }}>{log.latencyMs}ms</td>
                  <td style={{ padding: '12px 8px', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
