import { useState } from "react";
import { CLASS_META } from "../utils/classColors";
import { ICON_PATHS, DRONE_PATH } from "../utils/svgIcons";
import { ChevronDown, Layers } from "lucide-react";

function SvgIcon({ path, color, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color, display: "block", flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: path }}
    />
  );
}

export default function Legend() {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-10 left-3 z-[400] w-52 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/92 shadow-2xl shadow-black/40 backdrop-blur-md">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
      >
        <Layers size={13} className="text-slate-400" />
        <span className="flex-1 text-xs font-semibold tracking-wide text-slate-200">Legend</span>
        <ChevronDown
          size={13}
          className="text-slate-500 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-700/60 px-3 py-3 text-xs">
          {/* Drone */}
          <div className="flex items-center gap-2.5">
            <SvgIcon path={DRONE_PATH} color="#ef4444" size={16} />
            <span className="text-slate-300">Drone</span>
          </div>

          {/* Flight path */}
          <div className="flex items-center gap-2.5">
            <div
              className="h-[3px] w-4 shrink-0 rounded-full"
              style={{ background: "linear-gradient(to right, #4a10ff, #ff2fd0)" }}
            />
            <span className="text-slate-300">Flight path</span>
          </div>

          {/* Camera footprint */}
          {/* <div className="flex items-center gap-2.5">
            <div className="h-0 w-4 shrink-0 border-t-2 border-dashed border-yellow-400/80" />
            <span className="text-slate-300">Camera view</span>
          </div> */}

          <div className="border-t border-slate-700/50" />

          {/* Object classes */}
          <div className="space-y-2 pt-0.5">
            {Object.entries(CLASS_META).map(([cls, { color, label }]) => (
              <div key={cls} className="flex items-center gap-2.5">
                <SvgIcon
                  path={ICON_PATHS[cls] ?? ICON_PATHS.unknown}
                  color={color}
                  size={16}
                />
                <span className="text-slate-300">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
