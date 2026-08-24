// Colors match the backend's canonical scheme exactly (canvas_renderer.py
// _GROUP_COLORS), so this live view and the offline-rendered MP4 agree.
export const CLASS_META = {
  four_wheeler:     { color: "#3fe0d0", label: "4-Wheeler",      icon: "🚗" },
  two_wheeler:      { color: "#00d7ff", label: "2-Wheeler",      icon: "🏍️" },
  three_wheeler:    { color: "#ff0000", label: "3-Wheeler",      icon: "🛺" },
  six_plus_wheeler: { color: "#2b2be2", label: "6+ Wheeler",     icon: "🚛" },
  // person:           { color: "#6cff6c", label: "Person",         icon: "🚶" },
  // unknown:          { color: "#94a3b8", label: "Unknown",        icon: "❓" },
};

export function classColor(cls = "unknown") {
  return CLASS_META[cls]?.color ?? "#f59e0b";
}

export function classLabel(cls = "unknown") {
  return CLASS_META[cls]?.label ?? cls;
}

export function classIcon(cls = "unknown") {
  return CLASS_META[cls]?.icon ?? "📍";
}
