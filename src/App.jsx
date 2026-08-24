import { useState } from "react";
import { Radio } from "lucide-react";
import { useTelemetryWS } from "./hooks/useTelemetryWS";
import { useTelemetrySync } from "./hooks/useTelemetrySync";
import DroneMap from "./components/DroneMap";
import HUD from "./components/HUD";
import Sidebar from "./components/Sidebar";
import Legend from "./components/Legend";

// Inline drone SVG for header — no external dependency
function DroneHeaderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ color: "#ef4444" }}>
      <path fill="currentColor" d="M8.5 4.5h2v2h3v-2h2v2h1.5a1 1 0 0 1 1 1V8h-2v3h2v1.5h-2V16h2v.5a1 1 0 0 1-1 1H15.5v-2h-3v2h-2v-2H9a1 1 0 0 1-1-1V16h2v-3.5H8V11h2V8H8V7.5a1 1 0 0 1 1-1H10.5v-2Zm1.5 4v7h4V8.5h-4Z"/>
    </svg>
  );
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const snapshot = useTelemetrySync();

  useTelemetryWS(setConnected);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-900 font-sans">
      {/* Header */}
      <header className="relative flex shrink-0 items-center justify-between bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800/95 px-5 py-2.5 shadow-[0_1px_0_0_rgba(148,163,184,0.15)]">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-indigo-500/50 via-slate-700/40 to-transparent" />

        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/30 bg-gradient-to-br from-red-500/25 to-orange-500/10 shadow-[0_0_12px_rgba(239,68,68,0.15)]">
            <DroneHeaderIcon />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold leading-none tracking-wide text-white">Drone Analysis</p>
              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-400 border border-indigo-500/30">
                3D
              </span>
            </div>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Real-time surveillance · MapLibre GL
            </p>
          </div>

          <div className="ml-2 h-6 w-px bg-slate-700/60" />

          <span className="flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 font-mono text-[10px] text-slate-400">
            <Radio size={11} className="text-slate-500" />
            ws://192.168.123.251:8055
          </span>
        </div>

        <div
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
            connected ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <span className="relative flex h-2 w-2">
            {connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-500"}`} />
          </span>
          <span className={`text-xs font-semibold ${connected ? "text-green-400" : "text-red-400"}`}>
            {connected ? "Connected" : "Connecting…"}
          </span>
        </div>
      </header>

      {/* HUD telemetry bar */}
      <HUD snapshot={{ ...snapshot, connected }} />

      {/* Map + Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="relative flex-1">
          <DroneMap />
          <Legend />
        </div>

        {/* Sidebar */}
        <Sidebar snapshot={snapshot} open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      </div>
    </div>
  );
}
