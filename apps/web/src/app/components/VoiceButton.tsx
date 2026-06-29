import React, { useRef, useState, useEffect } from "react";

interface VoiceButtonProps {
  token: string | null;
  selectedDocIds: string[];
  activeConvId: string | null;
  onTranscriptReceived: (text: string) => void;
  onCitationsReceived: (citations: any[]) => void;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  token,
  selectedDocIds,
  activeConvId,
  onTranscriptReceived,
  onCitationsReceived,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Settings state
  const [speed, setSpeed] = useState<number>(1.0);
  const [voiceType, setVoiceType] = useState<string>("alloy");
  const [muteTts, setMuteTts] = useState<boolean>(false);

  // Recording API refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Auto-play TTS audio ref
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<{ seq: number; base64: string }[]>([]);
  const nextSeqRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);

  // WebSocket reference
  const wsRef = useRef<any>(null);

  // Clean up canvas animations and contexts on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ─── Recording & Waveform Rendering ───────────────────────────────────────

  const startRecording = async () => {
    if (!token) {
      alert("Authentication token is missing.");
      return;
    }
    audioChunksRef.current = [];
    setIsRecording(true);
    setStatusText("Recording...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // MediaRecorder config WebM max 60s
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await handleAudioUpload(audioBlob);
      };

      // 60 seconds auto-timeout limit
      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          stopRecording();
        }
      }, 60000);

      // Web Audio API Waveform setup
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      drawWaveform();
    } catch (err) {
      console.error("Failed to access microphone:", err);
      setIsRecording(false);
      setStatusText("Microphone access failed");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setIsRecording(false);
    setStatusText("Processing audio...");
  };

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isRecording) return;
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = "rgba(10, 10, 12, 0.4)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 2;
        ctx.fillStyle = `rgb(99, 102, 241)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  };

  // ─── Network uploads & Socket subscription ───────────────────────────────

  const handleAudioUpload = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/voice/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      const sessionId = data.sessionId;
      setStatusText("Awaiting STT...");

      // Subscribe to WebSocket events
      connectWebSocket(sessionId);
    } catch (err: any) {
      console.error(err);
      setStatusText("Upload failed");
    }
  };

  const connectWebSocket = (sessionId: string) => {
    const wsUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1")
      .replace("http://", "ws://")
      .replace("https://", "wss://") + `/mobile/ws?token=${token}&sessionId=${sessionId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Reset playback context
    nextSeqRef.current = 0;
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    if (!muteTts) {
      playbackCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { event: wsEvent, data } = payload;

        if (wsEvent === "voice:stt_done") {
          onTranscriptReceived(data.text);
          setStatusText("RAG thinking...");
        } else if (wsEvent === "voice:rag_thinking") {
          setStatusText("Synthesizing context...");
        } else if (wsEvent === "voice:audio_chunk") {
          if (!muteTts) {
            audioQueueRef.current.push({ seq: data.seq, base64: data.base64 });
            processAudioQueue();
          }
        } else if (wsEvent === "voice:done") {
          setStatusText("");
          if (data.citations) {
            onCitationsReceived(data.citations);
          }
          ws.close();
        } else if (wsEvent === "voice:error") {
          setStatusText("Pipeline failed");
          ws.close();
        }
      } catch (err) {
        console.error(err);
      }
    };
  };

  // ─── Audio playback sequencer ─────────────────────────────────────────────

  const processAudioQueue = async () => {
    if (isPlayingRef.current || !playbackCtxRef.current) return;

    // Search for next sequence
    const nextIndex = audioQueueRef.current.findIndex(
      (chunk) => chunk.seq === nextSeqRef.current
    );

    if (nextIndex === -1) return; // Sequence gap, await missing frames

    const chunk = audioQueueRef.current.splice(nextIndex, 1)[0];
    isPlayingRef.current = true;

    try {
      const arrayBuffer = base64ToArrayBuffer(chunk.base64);
      const audioBuffer = await playbackCtxRef.current.decodeAudioData(arrayBuffer);

      const source = playbackCtxRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = speed; // Configure speed multiplier
      source.connect(playbackCtxRef.current.destination);

      source.onended = () => {
        isPlayingRef.current = false;
        nextSeqRef.current += 1;
        processAudioQueue(); // loop remaining sequence
      };

      source.start(0);
    } catch (err) {
      console.error("Audio playback frame decoding error:", err);
      isPlayingRef.current = false;
      nextSeqRef.current += 1;
      processAudioQueue();
    }
  };

  const base64ToArrayBuffer = (base64Str: string) => {
    const binary = window.atob(base64Str);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
      {/* Waveform Canvas */}
      {isRecording && (
        <canvas
          ref={canvasRef}
          width={120}
          height={38}
          style={{
            borderRadius: "6px",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            background: "rgba(10,10,12,0.6)",
          }}
        />
      )}

      {statusText && (
        <span style={{ fontSize: "0.8rem", color: "var(--color-primary)" }}>{statusText}</span>
      )}

      {/* Record Trigger Button */}
      <button
        type="button"
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        style={{
          width: "46px",
          height: "46px",
          borderRadius: "10px",
          border: isRecording ? "1px solid #f43f5e" : "1px solid var(--glass-border)",
          background: isRecording ? "rgba(244, 63, 94, 0.15)" : "rgba(255,255,255,0.03)",
          color: isRecording ? "#f43f5e" : "#fff",
          fontSize: "1.2rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s",
        }}
        title="Hold to talk, release to send"
      >
        🎙️
      </button>

      {/* Voice settings panel toggle */}
      <button
        type="button"
        onClick={() => setShowSettings(!showSettings)}
        style={{
          width: "36px",
          height: "36px",
          background: "none",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          fontSize: "1.1rem",
        }}
        title="Voice Speech Configuration"
      >
        ⚙️
      </button>

      {showSettings && (
        <div
          style={{
            position: "absolute",
            bottom: "80px",
            right: "20px",
            background: "rgba(18, 18, 24, 0.95)",
            border: "1px solid var(--glass-border)",
            borderRadius: "12px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            zIndex: 100,
            width: "220px",
            backdropFilter: "blur(12px)",
          }}
        >
          <h4 style={{ margin: 0, fontSize: "0.9rem", color: "#fff" }}>Voice Preferences</h4>

          {/* Speed Selector */}
          <div>
            <label style={{ fontSize: "0.75rem", color: "#8a8b98" }}>Playback Speed</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              style={{
                width: "100%",
                padding: "6px",
                borderRadius: "6px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--glass-border)",
                color: "#fff",
                fontSize: "0.8rem",
                marginTop: "4px",
              }}
            >
              <option value="0.75">0.75x (Slow)</option>
              <option value="1.0">1.0x (Normal)</option>
              <option value="1.25">1.25x (Fast)</option>
              <option value="1.5">1.5x (Very Fast)</option>
            </select>
          </div>

          {/* Voice Type Selector */}
          <div>
            <label style={{ fontSize: "0.75rem", color: "#8a8b98" }}>Voice Model</label>
            <select
              value={voiceType}
              onChange={(e) => setVoiceType(e.target.value)}
              style={{
                width: "100%",
                padding: "6px",
                borderRadius: "6px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--glass-border)",
                color: "#fff",
                fontSize: "0.8rem",
                marginTop: "4px",
              }}
            >
              <option value="alloy">Alloy (Balanced)</option>
              <option value="echo">Echo (Warm)</option>
              <option value="nova">Nova (Bright)</option>
            </select>
          </div>

          {/* Mute TTS Toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.75rem", color: "#8a8b98" }}>Mute Output Audio</span>
            <input
              type="checkbox"
              checked={muteTts}
              onChange={(e) => setMuteTts(e.target.checked)}
              style={{ width: "16px", height: "16px" }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
