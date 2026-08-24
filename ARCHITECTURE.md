# Drone Analysis — Architecture & Data Flow

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Folder Structure](#2-folder-structure)
3. [Data Flow — End to End](#3-data-flow--end-to-end)
4. [File-by-File Breakdown](#4-file-by-file-breakdown)
   - [telemetryStore.js](#41-storetelemetrystorejs)
   - [useTelemetryWS.js](#42-hooksuseTelemetryWSjs)
   - [useTelemetrySync.js](#43-hooksuseTelemetrySyncjs)
   - [classColors.js](#44-utilsclassColorsjs)
   - [DroneMap.jsx](#45-componentsDroneMapjsx)
   - [HUD.jsx](#46-componentsHUDjsx)
   - [Sidebar.jsx](#47-componentsSidebarjsx)
   - [Legend.jsx](#48-componentsLegendjsx)
   - [App.jsx](#49-Appjsx)
   - [index.css](#410-indexcss)
5. [How the Pulse / Ring Animations Work](#5-how-the-pulse--ring-animations-work)
6. [How Markers Are Created on the Map](#6-how-markers-are-created-on-the-map)
7. [How to Replace Pulse + Markers with SVGs](#7-how-to-replace-pulse--markers-with-svgs)

---

## 1. Project Overview

The app connects to a WebSocket that streams drone telemetry frame-by-frame.
Each frame contains:
- The drone's GPS position, altitude, heading, and camera pitch
- The 4 corners of the ground area the camera can currently see (footprint)
- Detected objects grouped by class (`four_wheeler`, `two_wheeler`, `three_wheeler`, `six_plus_wheeler`, `person`)

The UI shows all of this live on a Leaflet map with a sidebar and HUD bar.

---

## 2. Folder Structure

```
src/
├── store/
│   └── telemetryStore.js     ← single mutable data store (no React state)
├── hooks/
│   ├── useTelemetryWS.js     ← WebSocket connection + frame ingestion
│   └── useTelemetrySync.js   ← 4Hz snapshot of store → React state
├── components/
│   ├── DroneMap.jsx           ← Leaflet map, markers, rAF render loop
│   ├── HUD.jsx                ← top telemetry bar
│   ├── Sidebar.jsx            ← accordion object list
│   └── Legend.jsx             ← collapsible map legend
├── utils/
│   └── classColors.js         ← color / label / icon per detection class
├── App.jsx                    ← root layout, wires everything together
├── main.jsx                   ← React entry point
└── index.css                  ← Tailwind + Leaflet CSS + keyframe animations
```

---

## 3. Data Flow — End to End

```
WebSocket (ws://192.168.123.251:8055/ws/telemetry)
        │
        │  raw JSON frame arrives
        ▼
useTelemetryWS.js  (ws.onmessage)
        │
        │  JSON.parse(event.data)  →  applyFrame(raw)
        ▼
telemetryStore.js  (applyFrame)
        │
        ├── store.drone      ← lat, lng, alt, heading, pitch, frame_index
        ├── store.footprint  ← 4 corner points of camera view
        └── store.objects    ← Map<track_id, { lat, lng, cls, confidence }>
                                (cleared and rebuilt every frame)
        │
        │  Two consumers read from the store:
        │
        ├──► DroneMap.jsx  (requestAnimationFrame loop)
        │       reads store directly, updates Leaflet markers imperatively
        │       runs at display refresh rate (~60fps)
        │
        └──► useTelemetrySync.js  (setInterval 250ms = ~4Hz)
                snapshots store → React state
                        │
                        ├──► HUD.jsx       (drone telemetry pills)
                        └──► Sidebar.jsx   (accordion object list)
```

**Key design rule:** The WebSocket and the rAF loop never call `setState`.
Only `useTelemetrySync` calls `setState`, and only 4 times per second.
This means the map can update at 60fps without causing React re-renders.

---

## 4. File-by-File Breakdown

---

### 4.1 `store/telemetryStore.js`

**What it is:** A plain JavaScript object — not React state, not Zustand, not Context.
It is just a module-level `const store = { ... }` that any file can import and mutate directly.

**What it holds:**
```js
store.drone        // { lat, lng, alt, heading, pitch, frame_index }
store.footprint    // [{ lat, lng }, { lat, lng }, { lat, lng }, { lat, lng }]
store.objects      // Map<track_id, { lat, lng, cls, confidence, track_id }>
store.connected    // boolean
store.lastFrameIndex  // number
store.frameCount   // running total of frames received
```

**What `applyFrame(raw)` does step by step:**

1. Reads `raw.telemetry.latitude` / `longitude` (they arrive as strings, so `parseFloat` is always used)
2. Reads `rel_alt`, `gb_yaw` (heading), `gb_pitch` — all strings, all parsed
3. Writes `store.drone` with those values
4. Reads `raw.frame_corners` — the backend sends `latitude`/`longitude` keys inside each corner object (not `lat`/`lon`)
5. Builds a 4-element array of `{ lat, lng }` and writes to `store.footprint`
6. Calls `flattenDetections(raw.detections)` — the detections arrive as a keyed object:
   ```json
   {
     "four_wheeler": [ {...}, {...} ],
     "two_wheeler":  [ {...} ],
     "six_plus_wheeler": [ {...} ]
   }
   ```
   `flattenDetections` iterates each key and tags every item with its class key as `cls`
7. **Clears `store.objects` completely** — this is critical, it prevents stale track_ids from accumulating across frames
8. Loops through the flattened items, parses `predicted_lat` / `predicted_long`, and sets each into `store.objects` keyed by `track_id`
9. Increments `store.frameCount`

**`normalizeClass(raw)`** maps any alias to the canonical key:
```
"car" → "four_wheeler"
"truck" → "six_plus_wheeler"
"motorcycle" → "two_wheeler"
"pedestrian" → "person"
```

---

### 4.2 `hooks/useTelemetryWS.js`

**What it does:** Opens the WebSocket, keeps it alive with auto-reconnect, feeds every message into the store.

**How it works:**
- Uses `useRef` for the WebSocket instance and reconnect timer — not state, so no re-renders
- `mountedRef` tracks whether the component is still mounted to prevent reconnect after unmount
- `ws.onopen` → sets `store.connected = true`, calls `onStatusChange(true)` (which is `setConnected` in App.jsx — the only setState call from this hook)
- `ws.onmessage` → `JSON.parse` → `applyFrame(data)` → also logs four_wheeler count to console
- `ws.onclose` → sets `store.connected = false`, schedules reconnect after 3 seconds
- `ws.onerror` → does nothing (onclose always fires after onerror, so reconnect is handled there)
- Cleanup on unmount: closes the socket, clears the reconnect timer

**What it does NOT do:** Never calls `setState` for data. The store is mutated directly.

---

### 4.3 `hooks/useTelemetrySync.js`

**What it does:** Bridges the mutable store to React state for the UI components that need to re-render (HUD, Sidebar).

**How it works:**
- Runs `setInterval` every 250ms (4 times per second)
- On each tick, reads the current store values and calls `setSnapshot({...})`
- `snapshot.objects` is `Array.from(store.objects.values())` — a plain array copy, not the Map itself
- Returns the snapshot object which App.jsx passes to HUD and Sidebar

**Why not just use the store directly in components?**
Because React components re-render when state changes. If we called setState on every WebSocket message (potentially 30+ fps), the sidebar and HUD would re-render 30+ times per second. The 4Hz throttle keeps the UI smooth.

**The map does NOT use this hook** — it reads `store` directly in its rAF loop.

---

### 4.4 `utils/classColors.js`

**What it does:** Single source of truth for how each detection class looks.

```js
export const CLASS_META = {
  four_wheeler:     { color: "#3b82f6", label: "4-Wheeler",  icon: "🚗" },
  two_wheeler:      { color: "#06b6d4", label: "2-Wheeler",  icon: "🏍️" },
  three_wheeler:    { color: "#a855f7", label: "3-Wheeler",  icon: "🛺" },
  six_plus_wheeler: { color: "#f97316", label: "6+ Wheeler", icon: "🚛" },
  person:           { color: "#22c55e", label: "Person",     icon: "🚶" },
  unknown:          { color: "#94a3b8", label: "Unknown",    icon: "❓" },
};
```

Three helper functions exported:
- `classColor(cls)` → returns the hex color string
- `classLabel(cls)` → returns the human-readable label
- `classIcon(cls)`  → returns the emoji icon

These are used in DroneMap (dot color), Sidebar (accordion headers, conf bar color), HUD (count pills), and Legend (legend rows).

**To change a color or add a new class:** edit only this file. Everything else reads from it.

---

### 4.5 `components/DroneMap.jsx`

**What it does:** Renders the Leaflet map and keeps all markers in sync with the store via a `requestAnimationFrame` loop.

**Initialization (inside `useEffect`):**
1. Creates a Leaflet map on the `containerRef` div
2. Adds OSM tile layer
3. Creates the drone marker at `DEFAULT_CENTER` using `makeDroneIcon()`
4. Creates an empty footprint polygon using `L.polygon([])`
5. Starts the `renderLoop()`

**The rAF render loop (`renderLoop`):**
Runs on every animation frame (~60fps). Does three things:

1. **Drone position** — calls `droneMarkerRef.current.setLatLng([lat, lng])`. On the first valid fix, calls `map.setView()` to center the map once.

2. **Footprint** — calls `footprintRef.current.setLatLngs(...)` with the 4 corner points from `store.footprint`. Leaflet redraws the polygon in place.

3. **Object markers** — iterates `store.objects` (the Map):
   - If a marker already exists for that `track_id`: calls `setLatLng` to move it
   - If no marker exists yet: creates a new `L.marker` with `makeObjectIcon(cls)`, binds a popup, adds to map
   - After the loop: removes any markers whose `track_id` is no longer in `store.objects`

**`makeObjectIcon(cls)` — how the dot marker is built:**
Returns an `L.divIcon` (a Leaflet marker that uses HTML/CSS instead of an image).
The HTML is a two-layer `<div>`:
```
Outer div (size × size px, position:relative)
  ├── Layer 1 (position:absolute, inset:0)
  │     → the PING RING — same color, opacity 0.3, animation: obj-ping
  └── Layer 2 (position:absolute, inset:2px)
        → the SOLID DOT — full color, white border, box-shadow glow
```
The `iconSize` and `iconAnchor` tell Leaflet the pixel dimensions and where the "tip" of the marker is (center for dots).

**`makeDroneIcon()` — how the drone marker is built:**
Also an `L.divIcon`, two-layer:
```
Outer div (28×28px, position:relative)
  ├── Layer 1 (position:absolute, inset:-6px)
  │     → the RING — red semi-transparent, animation: drone-ring
  └── Layer 2 (position:absolute, inset:0)
        → the EMOJI CIRCLE — red gradient background, white border, 🚁 emoji inside
```

**Dot sizes per class (pixels):**
```
four_wheeler:     13px
two_wheeler:      10px
three_wheeler:    11px
six_plus_wheeler: 15px
person:            9px
unknown:           9px
```

**Popups:**
Both drone and object markers use `bindPopup(() => makePopupHtml(...))` — a function form so the popup always reads the latest store data when opened, not stale data from when the marker was created.

**Cleanup on unmount:**
Cancels the rAF, removes all markers, calls `map.remove()`.

---

### 4.6 `components/HUD.jsx`

**What it does:** Dark bar below the header showing live telemetry numbers and per-class object counts.

**What it displays:**
- LIVE / OFFLINE pill with animated green dot
- Total frames received (`store.frameCount`)
- Current frame index (`store.lastFrameIndex`)
- Drone lat, lng, altitude, heading — all from `snapshot.drone`
- Per-class count pills on the right (e.g. 🚗 12, 🚛 3) — computed by `objects.reduce()`
- Grand total object count

**Data source:** `snapshot` prop from `useTelemetrySync` (updates at 4Hz).

---

### 4.7 `components/Sidebar.jsx`

**What it does:** Collapsible panel on the right showing all detected objects grouped by class in accordion sections.

**Structure:**
```
Sidebar
  ├── Header (total count)
  ├── Drone card (lat/lng/alt/heading/pitch/frame)
  └── Accordion groups (one per class present in current frame)
        └── AccordionGroup
              ├── Header button (class icon, label, count badge, chevron)
              └── Item list (one card per track_id)
                    ├── ID badge with colored dot
                    ├── ConfBar (confidence percentage bar)
                    └── lat/lng coordinates
```

**`ConfBar` component:**
Takes `value` (0–1 float from the backend). Computes `pct = Math.round(value * 100)`.
Color logic:
- `pct >= 70` → green `#22c55e`
- `pct >= 40` → amber `#f59e0b`
- `pct < 40`  → red `#ef4444`

Renders a filled bar div with `width: pct%` and a text label.

**Accordion state:** Each `AccordionGroup` has its own `useState(true)` — open by default. Clicking the header toggles it. The chevron rotates 90° when open.

**Sidebar collapse:** The whole sidebar can be hidden via the `open` prop. A thin toggle button sits on the seam between map and sidebar at all times.

**Data source:** `snapshot` prop from `useTelemetrySync` (updates at 4Hz).

---

### 4.8 `components/Legend.jsx`

**What it does:** Floating overlay on the bottom-left of the map explaining what each color/marker means.

**Structure:**
- Toggle button with `Layers` icon — collapses/expands the body
- Drone entry: two-layer dot preview (mimics the actual drone marker appearance)
- Camera view entry: dashed yellow line
- Divider
- One row per class in `CLASS_META`: colored dot + emoji + label

**State:** Single `useState(true)` for open/closed. Chevron rotates on toggle.

**Position:** `absolute bottom-10 left-3 z-[400]` — sits above the Leaflet map (z-index 400 is above Leaflet's default layers).

---

### 4.9 `App.jsx`

**What it does:** Root component. Wires all hooks and components together.

**What it manages:**
- `connected` state — passed from `useTelemetryWS` callback, shown in header
- `sidebarOpen` state — controls sidebar visibility
- `snapshot` from `useTelemetrySync` — passed to HUD and Sidebar

**Layout:**
```
<div> (full screen, flex column)
  ├── <header>   (logo, WS URL, connection status)
  ├── <HUD>      (telemetry bar)
  └── <div>      (flex row, fills remaining height)
        ├── <div relative>   (map area)
        │     ├── <DroneMap>
        │     └── <Legend>   (absolute positioned over map)
        └── <Sidebar>
```

---

### 4.10 `index.css`

**What it does:** Global styles. Three things:

1. `@import "tailwindcss"` — loads Tailwind v4
2. `@import "leaflet/dist/leaflet.css"` — loads Leaflet's required styles
3. Two `@keyframes` animations used by the map markers (see section 5)
4. Leaflet tooltip style overrides
5. Thin scrollbar styles

---

## 5. How the Pulse / Ring Animations Work

There are two animations, both defined in `index.css` as `@keyframes` and applied via inline `style` attributes inside `L.divIcon` HTML strings in `DroneMap.jsx`.

---

### `obj-ping` — Object dot pulse

```css
@keyframes obj-ping {
  0%   { transform: scale(1);   opacity: 0.6; }
  70%  { transform: scale(2.2); opacity: 0;   }
  100% { transform: scale(2.2); opacity: 0;   }
}
```

**What it does:** The outer ring div starts at normal size (scale 1, opacity 0.6), expands to 2.2× its size while fading to invisible, then holds at invisible until the next cycle. Duration: 1.8s, infinite.

**Where it is applied:** Inside `makeObjectIcon()` in `DroneMap.jsx`:
```js
// Layer 1 — the ping ring
<div style="
  position:absolute; inset:0;
  background:${color}; opacity:0.3;
  border-radius:50%;
  animation: obj-ping 1.8s ease-out infinite;
"></div>

// Layer 2 — the solid dot (no animation, always visible)
<div style="
  position:absolute; inset:2px;
  background:${color};
  border:2px solid white;
  border-radius:50%;
  box-shadow:0 0 6px ${color}99;
"></div>
```

The `inset:0` on layer 1 means it fills the full parent div. The `inset:2px` on layer 2 means it is 2px smaller on all sides — so the solid dot is slightly smaller than the ping ring's starting size.

---

### `drone-ring` — Drone pulse ring

```css
@keyframes drone-ring {
  0%   { transform: scale(0.8); opacity: 0.8; }
  100% { transform: scale(2.4); opacity: 0;   }
}
```

**What it does:** Starts slightly smaller than its container (scale 0.8), expands outward to 2.4× while fading out. Duration: 1.4s, infinite. More aggressive than obj-ping to make the drone stand out.

**Where it is applied:** Inside `makeDroneIcon()` in `DroneMap.jsx`:
```js
// Layer 1 — the expanding ring (behind the emoji)
<div style="
  position:absolute; inset:-6px;   ← extends 6px OUTSIDE the parent
  background:#ef444433;             ← red, very transparent
  border-radius:50%;
  animation: drone-ring 1.4s ease-out infinite;
"></div>

// Layer 2 — the emoji circle (always visible, no animation)
<div style="
  position:absolute; inset:0;
  background:linear-gradient(135deg,#ef4444,#dc2626);
  border:3px solid white;
  border-radius:50%;
  box-shadow:0 0 12px #ef444488;
  display:flex; align-items:center; justify-content:center;
  font-size:13px;
">🚁</div>
```

The `inset:-6px` on the ring means it starts 6px larger than the parent on all sides, so the ring visually expands outward from behind the emoji circle.

---

### Why `animation` works inside `L.divIcon` HTML

Leaflet injects the `html` string directly into the DOM as `innerHTML`. The browser parses it as real DOM elements. The `animation` CSS property references the `@keyframes` names defined in `index.css`, which is loaded globally. So the animations run exactly as they would in any normal HTML element.

---

## 6. How Markers Are Created on the Map

All markers are `L.marker` instances with a custom `L.divIcon`. Here is the full lifecycle:

### Step 1 — Icon creation
`makeObjectIcon(cls)` or `makeDroneIcon()` returns an `L.divIcon`:
```js
L.divIcon({
  className: "",        // empty string removes Leaflet's default white box
  html: "...",          // the two-layer div HTML string
  iconSize: [w, h],     // pixel dimensions of the icon
  iconAnchor: [w/2, h/2], // which pixel of the icon sits on the lat/lng point
})
```
`iconAnchor` is the center of the dot, so the dot is centered exactly on the coordinate.

### Step 2 — Marker creation (first time a track_id is seen)
```js
const marker = L.marker([obj.lat, obj.lng], {
  icon: makeObjectIcon(obj.cls),
  zIndexOffset: 100,   // renders above the footprint polygon
})
  .bindPopup(...)
  .addTo(map);

objectLayerRef.current.set(id, { marker, cls: obj.cls });
```
The marker is stored in `objectLayerRef` (a `useRef(new Map())`) keyed by `track_id`.

### Step 3 — Marker update (subsequent frames, same track_id)
```js
entry.marker.setLatLng([obj.lat, obj.lng]);
```
Leaflet moves the marker's DOM element to the new screen position. No new marker is created.

If the class changed (rare but possible):
```js
entry.marker.setIcon(makeObjectIcon(obj.cls));
entry.cls = obj.cls;
```

### Step 4 — Marker removal (track_id not in current frame)
```js
entry.marker.remove();
objectLayerRef.current.delete(id);
```
`marker.remove()` detaches the DOM element from the map and cleans up Leaflet internals.

### Drone marker
Created once at init, never removed. Only `setLatLng` is called on it each frame.

### Footprint polygon
Created once as `L.polygon([])`. Each frame calls `setLatLngs(corners)` which redraws the polygon in place.

---

## 7. How to Replace Pulse + Markers with SVGs

When you are ready to replace the emoji/CSS dots with SVG icons, here is exactly what to change and where.

---

### Replace object dot markers

**File:** `src/components/DroneMap.jsx`
**Function:** `makeObjectIcon(cls)`

Currently returns an `L.divIcon` with two nested `<div>` elements.
Replace the entire function with one that returns an SVG-based `L.divIcon`:

```js
function makeObjectIcon(cls) {
  const color = classColor(cls);
  const size  = DOT_SIZE[cls] ?? 10;

  // Replace the two-div HTML with your SVG string
  const svgHtml = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- your SVG path here -->
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="${color}" stroke="white" stroke-width="1.5"/>
    </svg>`;

  return L.divIcon({
    className: "",
    html: svgHtml,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
```

To remove the pulse: simply do not include the ping ring div / animation in the HTML.
To keep the pulse but use SVG: wrap the SVG in a `position:relative` div and add the ping ring div behind it.

---

### Replace drone marker

**File:** `src/components/DroneMap.jsx`
**Function:** `makeDroneIcon()`

Currently returns a div with an emoji and a ring animation.
Replace with an SVG drone icon:

```js
function makeDroneIcon() {
  const svgHtml = `
    <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <!-- your drone SVG path here -->
    </svg>`;

  return L.divIcon({
    className: "",
    html: svgHtml,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
```

To remove the drone ring animation: just remove the ring `<div>` from the HTML.
To keep the ring but use SVG: keep the outer `position:relative` wrapper div, put the ring div inside it, and replace the emoji div with your SVG.

---

### Remove only the animations (keep the dots)

To keep the colored dots but stop the pulsing, in `makeObjectIcon` remove this layer:
```js
// DELETE this entire div from the html string:
<div style="
  position:absolute;inset:0;
  background:${color};opacity:0.3;
  border-radius:50%;
  animation:obj-ping 1.8s ease-out infinite;
"></div>
```

And in `makeDroneIcon` remove this layer:
```js
// DELETE this entire div from the html string:
<div style="
  position:absolute;inset:-6px;
  background:#ef444433;
  border-radius:50%;
  animation:drone-ring 1.4s ease-out infinite;
"></div>
```

You can also delete the `@keyframes obj-ping` and `@keyframes drone-ring` blocks from `index.css` once the animations are removed.

---

### Change dot sizes

**File:** `src/components/DroneMap.jsx`

```js
const DOT_SIZE = {
  four_wheeler:     13,   // ← change these numbers
  two_wheeler:      10,
  three_wheeler:    11,
  six_plus_wheeler: 15,
  person:            9,
  unknown:           9,
};
```

---

### Change colors

**File:** `src/utils/classColors.js`

```js
export const CLASS_META = {
  four_wheeler: { color: "#3b82f6", ... },  // ← change color here
  ...
};
```

The color flows automatically to: dot fill, dot glow, sidebar conf bar, HUD pills, legend dots, accordion headers.
