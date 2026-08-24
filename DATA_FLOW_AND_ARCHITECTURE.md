# Drone Analysis (3D) — Data Flow & Architecture

This is the plain reference doc for this codebase: where data comes from,
how it moves through the app, what every file does, what each library is
doing for you, and — in detail — exactly how the 3D drone/vehicles/waypoints
actually get drawn on top of a normal 2D map. Read this before changing
anything; the 3D rendering section in particular exists so you don't have to
re-derive any of this math from scratch.

---

## 1. What this app is

A live, oblique bird's-eye 3D view (MapLibre GL + Three.js on top of plain
OpenStreetMap tiles) that shows a real 3D drone model flying at its real
telemetry altitude, 3D vehicle models for every tracked object oriented to
their direction of travel, and glowing ring markers along the flown path —
fed by a single WebSocket connection to the drone's backend. Same backend,
same telemetry shape as the 2D sibling project; this one adds a real 3D
layer on top.

---

## 2. Data flow — the big picture

```mermaid
flowchart TD
    WS["Backend WebSocket\nws://192.168.123.251:8055/ws/telemetry"]
    WS -->|"raw JSON frame\n(telemetry + detections + frame_corners)"| Apply["applyFrame()\nsrc/store/telemetryStore.js"]

    Apply -->|writes| Store["store\n(plain mutable JS object — NOT React state)"]

    Store -->|read every ~250ms, 4Hz poll| Sync["useTelemetrySync()"]
    Sync -->|setState -> re-render| React["React tree\nApp -> HUD / Sidebar / Legend"]

    Store -->|read every animation frame, 60fps| RAFLoop["rAF loop in DroneMap.jsx\n(React component, outer loop)"]
    RAFLoop --> FollowCam["Follow-cam: map.jumpTo(center, bearing)\n+ camera footprint polygon"]

    Store -->|read every render() call| ThreeLayer["Three.js custom MapLibre layer\ncreateVehicleLayer() in DroneMap.jsx"]
    ThreeLayer --> Drone3D["3D drone model\nthreeVehicles.js: buildDroneModel()"]
    ThreeLayer --> Veh3D["3D vehicle models\nthreeVehicles.js: buildVehicleModel()"]
    ThreeLayer --> Way3D["Waypoint rings\nthreeWaypoints.js: WaypointMarkers"]

    ThreeLayer -->|exposes smoothed drone pos via ref| RAFLoop

    WSHook["useTelemetryWS()"] -.owns the socket,\ncalls applyFrame().-> Apply
```

**The one rule that explains almost everything in this codebase:** `store`
in `telemetryStore.js` is a plain mutable object, not React state. There
are **three independent readers** of it, each on its own cadence:

1. **React UI** (HUD, Sidebar, Legend) — `useTelemetrySync()`, polls at 4Hz.
2. **The outer rAF loop** (inside the `DroneMap` React component) — 60fps,
   drives the follow-camera (`map.jumpTo`) and the camera-footprint polygon.
3. **The Three.js custom layer's own `render()`** — called by MapLibre
   itself whenever it repaints (which we keep continuous via
   `map.triggerRepaint()` at the end of every `render()` call) — this is
   what actually draws the 3D drone, vehicles, and waypoint rings.

(2) and (3) are two *separate* per-frame loops that both read `store`
independently — see §6 for why they have to stay in sync for the drone to
render at the right screen position.

---

## 3. Step by step: one WebSocket message's journey

Identical to the 2D project through `applyFrame()`, with two 3D-specific
additions:

1. `useTelemetryWS.js` owns the socket, parses each message, calls
   `applyFrame(data)`.
2. `applyFrame()` mutates `store`:
   - `store.drone` from `telemetry.latitude/longitude/rel_alt/gb_yaw/gb_pitch`.
   - **`store.flightPath`** — appends `{lat, lng, alt}` whenever the drone's
     position actually changes (deduped), capped at `MAX_PATH_POINTS`
     (2000, oldest trimmed first). This is the raw data the waypoint rings
     are drawn from.
   - `store.footprint` from `frame_corners`.
   - `store.objects` (a `Map<track_id, {...}>`), same persist-don't-clear
     behavior as the 2D project (see that project's doc, §3, for why).
   - **Heading for each object** — the live feed doesn't reliably carry a
     heading field for detections, so `applyFrame()` derives one itself:
     if the backend sends `obj.heading_deg`/`obj.heading`, use it; otherwise
     compute a compass bearing from the object's last known fix to its new
     one (`bearingDeg()`, the same formula the backend's own
     `builder.py::_bearing_deg` uses); otherwise hold the previous heading
     rather than snapping to 0. This is what lets vehicle models rotate to
     face the direction they're actually moving.
3. `useTelemetrySync()` (4Hz) feeds the HUD/Sidebar/Legend, same as the 2D
   project.
4. The **outer rAF loop** in `DroneMap.jsx` (60fps) reads `store.drone` and
   `store.footprint` every frame to drive the follow-camera and the
   footprint polygon — see §5.
5. The **Three.js layer's `render()`** reads `store.drone`, `store.objects`,
   and `store.flightPath` every time MapLibre repaints, and draws the 3D
   scene — see §6.

---

## 4. Every file, what it does

### `src/main.jsx`
Entry point, mounts `<App />` in `<StrictMode>` (dev double-invokes effects
— see the `cancelled` flag in `DroneMap.jsx` and the `wsRef.current !== ws`
guards in `useTelemetryWS.js`, both exist specifically for this).

### `src/App.jsx`
Page shell — identical role to the 2D project's `App.jsx`: owns
`connected`/`sidebarOpen` state, calls the two data hooks once, lays out
header → `HUD` → (`DroneMap` + `Legend` overlay) + `Sidebar`.

### `src/hooks/useTelemetryWS.js`
Same as the 2D project (socket lifecycle, reconnect, StrictMode guards) —
**this project does not currently have the 2D project's 1-second staleness
sweep** (`clearStaleObjects`/`STALE_MS`); `store.objects` here persists
indefinitely once seen, only ever removed if you add that back.

### `src/hooks/useTelemetrySync.js`
Identical to the 2D project — the 4Hz bridge from `store` into React state
for the HUD/Sidebar/Legend. `DroneMap` does not use this hook at all.

### `src/store/telemetryStore.js`
Same shape/role as the 2D project's store, plus:
- `store.flightPath` — bounded history of drone positions (see §3).
- `bearingDeg()` — internal helper, computes a compass bearing between two
  lat/lng fixes; used to derive object heading when the backend doesn't
  send one.
- `normalizeClass()` here additionally recognizes the backend's raw
  `display_group` strings (`"2-W"`, `"3-W"`, `"4-W"`, `"6+ W"`, `"Person"`)
  from its offline video-rendering pipeline, in case the live feed ever
  sends those instead of `four_wheeler`/etc.

### `src/components/DroneMap.jsx`
The whole map. Two things live in this one file:

1. **The React component** (`export default function DroneMap()`) — creates
   the MapLibre `Map`, adds the OpenStreetMap raster style, adds the
   Three.js custom layer (`createVehicleLayer`, described below) and the
   camera-footprint GeoJSON layer, and runs the outer 60fps rAF loop that
   drives the follow-camera (§5) and refreshes the footprint polygon and any
   open popup's HTML. It also owns click-to-open-popup handling: since the
   drone and vehicles are 3D meshes (not DOM elements), clicks are resolved
   by projecting each candidate's lat/lng to screen pixels via `map.project()`
   and picking whichever is closest to the click, within a tolerance radius.
2. **`createVehicleLayer(id, map)`** — builds a MapLibre *custom layer*
   object (`{ type: "custom", renderingMode: "3d", onAdd, render, onRemove }`)
   that owns its own Three.js `Scene`/`Camera`/`WebGLRenderer`, sharing
   MapLibre's actual WebGL canvas/context. This is where the drone model,
   vehicle models, and waypoint rings actually get drawn — see §6 for the
   full mechanics.

### `src/utils/threeVehicles.js`
All procedural (hand-built-from-primitives) Three.js geometry:
- `buildCarModel` / `buildBikeModel` / `buildAutoModel` / `buildTruckModel` /
  `buildPersonModel` / `buildDefaultModel` — one per vehicle class, each a
  `THREE.Group` of boxes/cylinders/spheres at true meter-scale dimensions,
  authored nose-pointing -Z, Y-up.
- `buildVehicleModel(cls, colorHex)` — picks the right builder for a class
  and colors it.
- `buildDroneModel()` — the full quadcopter: fuselage, nose/tail fairings,
  battery, all 4 arms/motors/spinning-prop-discs/nav-LEDs/legs, skids,
  gimbal camera, and a blinking strobe. Built **once** and reused every
  frame — only its position/rotation change per frame (see §6). Exposes
  `userData.rotors` (the 4 spinning prop groups) and `userData.strobe` so
  the render loop can animate them without rebuilding anything.
- `buildMarker(colorHex)` — the glowing disc + vertical light-beam that sits
  under every vehicle (canvas-generated radial/linear gradient textures,
  additive blending) — purely decorative, ported from the reference
  "digital twin" renderer's `makeGlowDisc`/`makeBeam`.

### `src/utils/threeWaypoints.js`
`WaypointMarkers` — the flight-path visualization. Flat, glowing ring
markers (`RingGeometry`) laid directly on the ground along `store.flightPath`,
driven by a single `THREE.InstancedMesh` (one shared ring geometry, one draw
call, hundreds of instances) so it stays cheap regardless of how long the
flight path gets. `update()` walks the flight path and only places a new
ring instance once the previous one is at least `spacingM` (2.5m) away, so
rings read as an evenly-spaced trail rather than one per raw GPS point.

### `src/utils/svgIcons.js`
Flat inline-SVG path strings (`ICON_PATHS`, `DRONE_PATH`) — used **only** by
`Legend.jsx` for its small flat 2D swatch icons. Not used anywhere on the
actual 3D map anymore (the map itself uses the real 3D models above).

### `src/components/HUD.jsx` / `src/components/Sidebar.jsx` / `src/components/Legend.jsx`
Same role as their 2D-project counterparts (see that doc) — pure
presentational components driven by the `useTelemetrySync()` snapshot, with
minor visual differences (a "3D" badge in the header, a gimbal-pitch stat
pill, MapLibre-specific footprint-color styling in the legend).

### `src/utils/classColors.js`
Identical role to the 2D project — the single `CLASS_META` table of
`{color, label, icon}` per class, colors matched exactly to the backend's
own canonical scheme (`canvas_renderer.py`'s `_GROUP_COLORS`) so this live
view and the backend's offline-rendered MP4 agree visually.

---

## 5. The follow-camera (2D camera, not the 3D layer)

Runs in the outer rAF loop in `DroneMap.jsx`, every frame:

- First drone fix ever received: `map.jumpTo({ center, zoom: INITIAL_ZOOM,
  pitch: DEFAULT_PITCH, bearing: heading })` — snaps straight there, no
  animated fly-in (that would fight the continuous jump on the very next
  frame).
- Every frame after that: if the drone's position/heading actually changed
  since the last jump, `map.jumpTo({ center, bearing: heading })` again —
  no `zoom` here, so it stays at whatever zoom it's already at.
- `bearing: heading` locks the top of the screen to the direction the drone
  is currently facing (MapLibre's `bearing` convention: bearing `B` means
  compass direction `B` renders at the top of the screen).
- **`center` is not the drone's raw lat/lng** — see §6.3 for why, and the
  exact correction applied.

---

## 6. How the 3D scene actually works — the important part

This is the part worth understanding fully before changing anything in
`createVehicleLayer`.

### 6.1 The custom layer mechanism

MapLibre lets you register a "custom" style layer:
```js
{ id, type: "custom", renderingMode: "3d", onAdd(map, gl) {...}, render(gl, options) {...} }
```
`onAdd` fires once — that's where the Three.js `Scene`, a bare `THREE.Camera`
(no built-in projection math of its own — we drive it manually every frame),
lighting, and a `THREE.WebGLRenderer` that **shares MapLibre's own canvas and
GL context** get created. `render` fires every time MapLibre repaints; we
call `map.triggerRepaint()` at the end of every `render()` so this keeps
firing continuously (otherwise it would only fire when the user pans/zooms).

### 6.2 The coordinate system (the trickiest part)

MapLibre hands `render()` an `options.modelViewProjectionMatrix` — a matrix
that converts **world-pixel coordinates** to clip space. "World pixels" here
means: take a lng/lat, convert to normalized Mercator (`0..1`) via
`maplibregl.MercatorCoordinate.fromLngLat`, then multiply by `worldSize`
(`tileSize * 2^zoom`, tens of millions at this zoom level) for X/Y. Z is
**raw meters** (altitude), not mercator-scaled at all.

Two things fall out of this that the code works around:

- **Precision**: feeding absolute world-pixel coordinates (tens of millions)
  straight into `Float32Array`-backed Three.js matrices loses precision and
  causes visible jitter. Fix: every position is computed **relative to the
  drone's current lat/lng** (the `origin` computed at the top of `render()`),
  and that same origin offset is folded into the camera matrix via
  `camera.projectionMatrix.fromArray(mvp).multiply(makeTranslation(originX, originY, 0))`.
  Everything downstream (`toRelative(lat, lng, altMeters)`) returns small
  numbers (a few hundred, not tens of millions).
- **Scale**: X/Y are in "world pixels per mercator unit", Z is literal
  meters — two different units. `worldPixelsPerMeter` (computed once per
  frame from `MercatorCoordinate.meterInMercatorCoordinateUnits() * worldSize`)
  is the conversion factor used to scale every model's horizontal footprint
  correctly; vertical scale is always `1` because Z inputs are already
  meters.

### 6.3 Why every model is nested `mount > heading > geometry`

Every drone/vehicle model is built once in **Y-up, nose-facing -Z** local
space (the natural way to author a car or a quadcopter). The world's "up"
axis, per §6.2, is **Z**, not Y. So every model sits inside two wrapper
groups:

- **`mount`** — has a fixed `rotation.x = Math.PI / 2` (a 90° tilt that
  converts "Y-up authored model" into "lies flat on the Z-up world ground
  plane"), plus the per-frame `position` (from `toRelative`) and `scale`
  (`worldPixelsPerMeter` on the two horizontal axes, `1` on the vertical
  one — see §6.2).
- **`heading`** — a child of `mount`, holds only the per-frame
  `rotation.y` (yaw) driven by the object's compass heading. Because this
  rotation happens *before* the fixed 90° tilt is applied (it's the inner
  group), rotating it always spins the model around its own true vertical
  axis, regardless of the outer tilt.

This exact `mount > heading > model` pattern is used identically for the
drone, every vehicle class, and nowhere else — if you add a new 3D object to
this scene, replicate it.

### 6.4 The drone specifically

- Built **once** in `onAdd()` (`this.droneModel = buildDroneModel()`), never
  rebuilt — every frame only touches `this.droneMount.position/scale` and
  `this.droneHeading.rotation.y`. Do not call `buildDroneModel()` inside
  `render()`.
- **Smoothed, not snapped**: telemetry arrives in discrete ticks, but the
  drone's rendered position (`this.droneRender`) lerps toward the latest
  `store.drone` fix every frame (`DRONE_SMOOTHING = 0.18`), with heading
  interpolated the short way around the compass (wraps correctly through
  0°/360°). This is what makes the drone glide instead of jump.
- **Scale**: `worldPixelsPerMeter * DRONE_SCALE_BOOST` horizontally,
  `DRONE_SCALE_BOOST` (1.8) vertically — true 1:1 meter scale would read as
  a speck at this camera distance, so it's boosted modestly while staying
  proportionate to the (also true-scale) vehicle detections.
- **Rotor spin / strobe blink**: `this._frame` is a simple incrementing
  counter; each of the 4 rotor groups rotates a fixed amount per frame
  (alternating direction), and the strobe toggles visibility on a duty
  cycle (`this._frame % 20 < 5`) — cheap, no extra state needed.

### 6.5 The follow-camera correction (why `center` isn't the drone's raw position)

MapLibre's `center` option always renders at the *exact* screen center — but
that's a **ground point** (altitude 0). The drone sits `alt` meters above
its own ground point, and with the map pitched (`DEFAULT_PITCH = 58°`), an
elevated point visually projects *higher up the screen* than its ground
point does. Centering the camera on the drone's raw lat/lng therefore leaves
the drone looking too high, not actually centered.

The fix (`droneCameraCenter()` in `DroneMap.jsx`): push the look-at point
forward — in the direction the camera is already facing, i.e. the drone's
own heading, since `bearing` is locked to `heading` — by
`altitude * tan(pitch)` meters, which is exactly the ground distance an
object at that altitude and pitch appears to parallax by. This is an exact
similar-triangles result (not an approximation): for any point on the
camera's boresight ray, everything on that same ray projects to the same
screen position, so solving for where the *ground* intersects the boresight
that also passes through the drone's real elevated position gives this
formula directly.

**Important**: this correction uses the *same smoothed* `droneRender`
position the 3D model itself renders from (read off `vehicleLayerRef.current
.droneRender`, exposed by the custom layer), not raw `store.drone`. If the
camera used raw telemetry while the model used the smoothed/lagged value,
the two would visibly drift apart while the drone is moving — this was a
real bug, fixed by making both consumers agree on one position.

### 6.6 Vehicles

Each tracked object gets its own `{ mount, heading, cls }` entry in a
`Map<track_id, entry>`, created lazily the first time that `track_id` is
seen (or recreated if its class changes, e.g. a misclassification correcting
itself), removed the frame after it stops appearing in `store.objects`.
Every vehicle carries both its 3D model (`buildVehicleModel`) and the
glow-disc-and-beam marker (`buildMarker`) as siblings inside the same
`heading` group.

### 6.7 Waypoint rings

`WaypointMarkers.update()` is called every `render()` with the current
`store.flightPath`, the same `toRelative`/`worldPixelsPerMeter` used for
everything else, walks the path placing ring instances at least 2.5m apart
(so a long flight doesn't turn into a solid line), and updates a single
`InstancedMesh`'s `count` and per-instance transform matrices. Rings render
with `depthTest: false` so nothing else in the scene can occlude them, and
solid (non-additive) alpha blending so they stay visible over the bright
default OSM basemap — additive blending was tried first and washed out to
near-white over light backgrounds.

---

## 7. Libraries — what's used and why

| Library | What it's doing here |
|---|---|
| **React 19** + **react-dom** | UI shell only (`App`, `HUD`, `Sidebar`, `Legend`) — the map is not React-rendered. |
| **Vite** | Dev server + build tool. |
| **Tailwind CSS v4** | All UI styling. |
| **MapLibre GL JS v6** | The base map: OpenStreetMap raster tiles, camera (pan/zoom/pitch/bearing), the camera-footprint GeoJSON polygon layer, popups, and — critically — the *host* for the custom 3D layer (its WebGL canvas/context is shared with Three.js, not a separate canvas on top). |
| **Three.js v0.160** | All 3D rendering: the drone model, vehicle models, waypoint rings, lighting, the `WebGLRenderer` itself. Mounted entirely inside one MapLibre custom layer (`createVehicleLayer`), never used standalone. |
| **lucide-react** | UI chrome icons (HUD/Sidebar/Legend), not the 3D scene. |
| `zustand` / `leaflet` | **Installed but not used anywhere in `src/`.** Leftover dependencies from before this became a MapLibre+Three.js project — safe to remove from `package.json` if you want it to match what's really running. |
| **oxlint** | The linter for this project (`npm run lint`) — note this is the *opposite* choice from the 2D sibling project, which uses ESLint. |

---

## 8. Quick reference — constants you might want to tune

All in `DroneMap.jsx` unless noted:

| Constant | Meaning |
|---|---|
| `DEFAULT_CENTER` / `DEFAULT_ZOOM` | Map view before any telemetry arrives. |
| `INITIAL_ZOOM` (19) | Zoom used the *first* time the camera locks onto the drone (closer than steady-state). |
| `DEFAULT_PITCH` (58°) | Map pitch — also the pitch value the camera-centering math in §6.5 assumes. If you change pitch, that formula's `DEFAULT_PITCH` reference updates automatically since it reads the same constant. |
| `DEFAULT_BEARING` (20°) | Initial bearing before the first drone fix (after that, bearing is always locked to `heading`). |
| `DRONE_SCALE_BOOST` (1.8) | How much bigger than true 1:1 meter scale the drone model renders. |
| `DRONE_SMOOTHING` (0.18) | Per-frame lerp factor for the drone's rendered position/heading — lower = smoother but laggier, higher = snappier but jumpier. |
| `OBJECT_HIT_RADIUS_PX` (26) / `DRONE_HIT_RADIUS_PX` (30) | Click-to-select tolerance, in screen pixels, for opening a vehicle's/the drone's popup. |
| `MAX_PATH_POINTS` (2000, in `telemetryStore.js`) | How many flight-path points are kept before old ones get trimmed. |
| `WaypointMarkers`'s `maxCount` (400) / `spacingM` (2.5) | Max ring instances and minimum real-world gap between them (`threeWaypoints.js`). |
| `CLASS_META` (in `classColors.js`) | Per-class color/label/icon — the one place to change these; kept in sync with the backend's own color scheme. |
