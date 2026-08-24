import { Film, Hash, MapPin, ArrowUp, Compass, Navigation } from "lucide-react";
import { classColor, classIcon, CLASS_META } from "../utils/classColors";

function StatPill({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-slate-700/40 bg-white/5 px-2.5 py-1">
      {Icon && <Icon size={11} className="text-slate-500" />}
      <span className="text-[10px] text-slate-400">{label}</span>
      <span className={`text-xs font-semibold text-white ${mono ? "font-mono tabular-nums" : ""}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-5 w-px shrink-0 bg-slate-700/60" />;
}

export default function HUD({ snapshot }) {
  const { drone, connected, frameCount, lastFrameIndex, objects } = snapshot;

  const classCounts = objects.reduce((acc, o) => {
    acc[o.cls] = (acc[o.cls] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/80 bg-slate-900/95 px-4 py-1.5 backdrop-blur-sm">
      {/* Connection */}
      <div
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
          connected ? "border-green-500/25 bg-green-500/10" : "border-red-500/25 bg-red-500/10"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-green-400" : "bg-red-500"}`} />
        <span className={`text-xs font-bold tracking-wide ${connected ? "text-green-400" : "text-red-400"}`}>
          {connected ? "LIVE" : "OFFLINE"}
        </span>
      </div>

      <Divider />

      {/* Frame */}
      <StatPill icon={Film} label="Frames" value={frameCount} mono />
      {lastFrameIndex != null && <StatPill icon={Hash} label="Frame" value={lastFrameIndex} mono />}

      {/* Drone telemetry */}
      {drone ? (
        <>
          <Divider />
          <StatPill icon={MapPin} label="Lat" value={parseFloat(drone.lat).toFixed(5)} mono />
          <StatPill icon={MapPin} label="Lng" value={parseFloat(drone.lng).toFixed(5)} mono />
          <StatPill icon={ArrowUp} label="Alt" value={`${parseFloat(drone.alt).toFixed(1)} m`} mono />
          <StatPill icon={Compass} label="Hdg" value={`${parseFloat(drone.heading).toFixed(1)}°`} mono />
          {drone.pitch != null && (
            <StatPill icon={Navigation} label="Pitch" value={`${parseFloat(drone.pitch).toFixed(1)}°`} mono />
          )}
        </>
      ) : (
        <span className="text-xs text-slate-500">Awaiting drone fix…</span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Object class counts */}
      <div className="flex items-center gap-1.5">
        {Object.keys(CLASS_META)
          .filter((cls) => classCounts[cls])
          .map((cls) => (
            <div
              key={cls}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"
              style={{ background: classColor(cls) }}
            >
              {classIcon(cls)} {classCounts[cls]}
            </div>
          ))}
        {objects.length > 0 && (
          <div className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white">
            {objects.length} total
          </div>
        )}
      </div>
    </div>
  );
}
