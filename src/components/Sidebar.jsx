import { useState } from "react";
import { classColor, classLabel, classIcon, CLASS_META } from "../utils/classColors";
import { ChevronRight, ChevronLeft, MapPin, Navigation } from "lucide-react";

function ConfBar({ value }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700/60">
        <div style={{ width: `${pct}%`, background: color }} className="h-full rounded-full transition-all duration-300" />
      </div>
      <span className="w-7 text-right text-[10px] font-medium" style={{ color }}>{pct}%</span>
    </div>
  );
}

function AccordionGroup({ cls, items }) {
  const [open, setOpen] = useState(true);
  const color = classColor(cls);
  const label = classLabel(cls);
  const icon  = classIcon(cls);

  return (
    <div className="border-b border-slate-700/50 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="sticky top-0 bg-slate-900/95 z-999 cursor-pointer  flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors "
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs"
          style={{ background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}
        >
          {icon}
        </span>
        <span className="flex-1 text-xs font-semibold tracking-wide text-slate-200">{label}</span>
        <span
          className="rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-white shadow-sm"
          style={{ background: color }}
        >
          {items.length}
        </span>
        <ChevronRight
          size={13}
          className="shrink-0 text-slate-500 transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="space-y-1.5 px-2 pb-1.5">
          {items.map((o) => (
            <div
              key={o.track_id}
              className=" rounded-lg border border-slate-700/50 border-l-[3px] bg-slate-800/60 px-3 py-2 text-xs transition-colors hover:bg-slate-800"
              style={{ borderLeftColor: color }}
            >
              <div className="flex items-center justify-between ">
                <span className="font-mono font-semibold tabular-nums text-slate-200">ID {o.track_id}</span>
              </div>
              <ConfBar value={o.confidence} />
              <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] tabular-nums text-slate-500">
                <MapPin size={9} />
                {o.lat.toFixed(5)}, {o.lng.toFixed(5)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ snapshot, open, onToggle }) {
  const { objects, drone } = snapshot;
  console.log("helo",objects)

  const grouped = objects.reduce((acc, o) => {
    (acc[o.cls] ??= []).push(o);
    return acc;
  }, {});

  const orderedKeys = Object.keys(CLASS_META).filter((k) => grouped[k]);
  console.log('asdasdasd',CLASS_META)
  console.log('grouped', grouped)

  return (
    <div className="relative flex shrink-0">
      {/* Collapse/expand handle — always visible on the seam between map and sidebar */}
      <button
        onClick={onToggle}
        className="z-10 flex w-5 shrink-0 items-center justify-center border-l border-slate-700/60 bg-slate-800 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
        title={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        {open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Sidebar panel */}
      <aside
        className={`flex flex-col overflow-hidden border-l border-slate-700/60 bg-slate-900 shadow-inner transition-all duration-300 ${
          open ? "w-72" : "w-0 border-l-0"
        }`}
      >
        <div className="flex h-full w-72 flex-col overflow-hidden">
          {/* Header */}
          <div className="relative border-b border-slate-700/60 bg-gradient-to-b from-slate-800 to-slate-800/70 px-4 py-3">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-indigo-400/50 via-slate-600/30 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold tracking-wide text-white">Detections</span>
              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-200">
                {objects.length} total
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">Live object tracking</p>
          </div>

          {/* Drone card */}
          {drone ? (
            <div className="border-b border-slate-700/60 bg-gradient-to-r from-red-500/10 via-orange-500/5 to-transparent px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-red-500/25 bg-red-500/15 text-sm shadow-[0_0_8px_rgba(239,68,68,0.15)]">
                  🚁
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-red-400">Drone · Frame {drone.frame_index ?? "—"}</p>
                  <p className="font-mono text-[10px] tabular-nums text-slate-500">
                    {drone.lat.toFixed(5)}, {drone.lng.toFixed(5)}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {[
                  { label: "Alt", value: `${parseFloat(drone.alt).toFixed(1)} m` },
                  { label: "Hdg", value: `${parseFloat(drone.heading).toFixed(1)}°` },
                  { label: "Pitch", value: `${parseFloat(drone.pitch ?? 0).toFixed(1)}°` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-md border border-white/5 bg-white/5 px-2 py-1 text-center">
                    <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="font-mono text-[11px] font-bold tabular-nums text-slate-200">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="border-b border-slate-700/60 bg-slate-800/40 px-4 py-3 text-center text-xs text-slate-500">
              <Navigation size={16} className="mx-auto mb-1 text-slate-600" />
              Awaiting drone fix…
            </div>
          )}

          {/* Accordion groups */}
          <div className="flex-1 overflow-y-auto">
            {objects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                <MapPin size={28} className="mb-2 text-slate-700" />
                <p className="text-xs">No detections yet</p>
                <p className="mt-0.5 text-[10px] text-slate-700">Waiting for telemetry…</p>
              </div>
            ) : (
              orderedKeys.map((cls) => (
                <AccordionGroup key={cls} cls={cls} items={grouped[cls]} />
              ))
            )}
          </div>

          {/* Footer summary */}
          {/* {objects.length > 0 && (
            <div className="border-t border-slate-700/60 bg-slate-800/40 px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {orderedKeys.map((cls) => (
                  <span
                    key={cls}
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-white shadow-sm"
                    style={{ background: classColor(cls) }}
                  >
                    {classIcon(cls)} {grouped[cls].length}
                  </span>
                ))}
              </div>
            </div>
          )} */}
        </div>
      </aside>
    </div>
  );
}