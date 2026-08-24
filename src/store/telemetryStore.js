/**
 * telemetryStore.js
 * Plain mutable object — NOT React state.
 * WebSocket writes here. rAF / MapLibre loop reads here.
 * React state syncs at ~4 Hz via useTelemetrySync.
 */

// Max flight-path points kept in memory (~5 min at 30fps would be 9000;
// 2000 is a safe bound that still shows a meaningful trajectory).
const MAX_PATH_POINTS = 2000;

export const store = {
  drone: null,           // { lat, lng, alt, heading, pitch, frame_index }
  footprint: null,       // [{ lat, lng }, ...] 4 corners
  objects: new Map(),    // track_id -> { lat, lng, cls, confidence, track_id }
  flightPath: [],        // [{ lat, lng, alt }, ...] bounded history
  connected: false,
  lastFrameIndex: null,
  frameCount: 0,
};

// Compass bearing (0=N, clockwise) from point 1 to point 2 — mirrors the
// backend's builder.py _bearing_deg exactly, since the live WS feed doesn't
// carry a heading field for detections and vehicles need to face the way
// they're actually moving.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad, p2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function flattenDetections(detections) {
  if (!detections || typeof detections !== "object") return [];
  if (Array.isArray(detections))
    return detections.map((d) => ({ ...d, cls: d.class ?? d.cls ?? "unknown" }));

  const result = [];
  Object.entries(detections).forEach(([key, items]) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => result.push({ ...item, cls: key }));
  });
  return result;
}

export function normalizeClass(raw = "unknown") {
  const map = {
    four_wheeler:     "four_wheeler",
    two_wheeler:      "two_wheeler",
    three_wheeler:    "three_wheeler",
    six_plus_wheeler: "six_plus_wheeler",
    car:              "four_wheeler",
    vehicle:          "four_wheeler",
    truck:            "six_plus_wheeler",
    bus:              "six_plus_wheeler",
    motorcycle:       "two_wheeler",
    bike:             "two_wheeler",
    person:           "person",
    pedestrian:       "person",
    // The backend's video renderer (canvas_renderer.py _GROUP_COLORS /
    // builder.py display_group) labels classes "2-W" / "3-W" / "4-W" /
    // "6+ W" / "Person" — the live WS feed uses the same display_group
    // strings, so they need to be recognized here too.
    "2-w":  "two_wheeler",
    "3-w":  "three_wheeler",
    "4-w":  "four_wheeler",
    "6+ w": "six_plus_wheeler",
    "6+w":  "six_plus_wheeler",
  };
  return map[raw.toLowerCase()] ?? raw.toLowerCase();
}

export function applyFrame(raw) {
  const telem = raw.telemetry ?? {};

  const droneLat = parseFloat(telem.latitude  ?? raw.drone_lat);
  const droneLng = parseFloat(telem.longitude ?? raw.drone_lng);
  const alt      = parseFloat(telem.rel_alt   ?? telem.altitude ?? 0);
  const heading  = parseFloat(telem.gb_yaw    ?? telem.yaw ?? telem.heading ?? 0);
  const pitch    = parseFloat(telem.gb_pitch  ?? 0);

  if (!isNaN(droneLat) && !isNaN(droneLng)) {
    store.drone = { lat: droneLat, lng: droneLng, alt, heading, pitch, frame_index: raw.frame_index };

    // Append to flight path — only if position actually changed
    const last = store.flightPath[store.flightPath.length - 1];
    if (!last || last.lat !== droneLat || last.lng !== droneLng) {
      store.flightPath.push({ lat: droneLat, lng: droneLng, alt });
      // Trim to bounded size
      if (store.flightPath.length > MAX_PATH_POINTS) {
        store.flightPath.splice(0, store.flightPath.length - MAX_PATH_POINTS);
      }
    }
  }

  // frame_corners — backend uses "latitude"/"longitude" keys
  const fc = raw.frame_corners;
  if (fc?.top_left && fc?.top_right && fc?.bottom_right && fc?.bottom_left) {
    const toPoint = (p) => ({
      lat: parseFloat(p.latitude ?? p.lat),
      lng: parseFloat(p.longitude ?? p.lon ?? p.lng),
    });
    const corners = [
      toPoint(fc.top_left),
      toPoint(fc.top_right),
      toPoint(fc.bottom_right),
      toPoint(fc.bottom_left),
    ].filter((p) => !isNaN(p.lat) && !isNaN(p.lng));
    if (corners.length === 4) store.footprint = corners;
  }

  // Update/add objects seen in this frame. Deliberately not cleared first —
  // the backend interleaves "heartbeat" frames with empty detections/telemetry
  // (e.g. telemetry: {}, detections: {}); clearing on every frame made those
  // wipe out all markers and immediately repopulate on the next real frame,
  // which is what caused the sidebar/map to flicker between populated and
  // "No detections yet". Objects now simply persist at their last known
  // position until a new frame reports that same track_id again.
  const items = flattenDetections(raw.detections ?? raw.objects ?? []);
  items.forEach((obj) => {
    const lat = parseFloat(obj.predicted_lat);
    const lng = parseFloat(obj.predicted_long ?? obj.predicted_lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const id = obj.track_id ?? obj.id;
    if (id == null) return; // no stable identity — skip rather than collide under an `undefined` key

    const cls = normalizeClass(obj.cls ?? obj.class ?? "unknown");

    // Heading: use it if the backend sends one, else derive it from the
    // last known fix for this track_id (same formula as builder.py), else
    // hold the previous heading rather than snapping to 0 on a near-zero move.
    const prev = store.objects.get(id);
    const rawHeading = parseFloat(obj.heading_deg ?? obj.heading);
    let heading = prev?.heading ?? 0;
    if (!isNaN(rawHeading)) {
      heading = rawHeading;
    } else if (prev) {
      const movedM = Math.hypot(lat - prev.lat, lng - prev.lng);
      if (movedM > 1e-7) heading = bearingDeg(prev.lat, prev.lng, lat, lng);
    }

    store.objects.set(id, {
      lat,
      lng,
      cls,
      heading,
      confidence: parseFloat(obj.confidence ?? 1),
      track_id: id,
    });
  });

  store.lastFrameIndex = raw.frame_index ?? null;
  store.frameCount += 1;
}
