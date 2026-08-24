import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import * as THREE from "three";
import { store } from "../store/telemetryStore";
import { classColor } from "../utils/classColors";
import { buildVehicleModel, buildMarker, buildDroneModel } from "../utils/threeVehicles";
import { FlightTrail } from "../utils/threeWaypoints";

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_CENTER  = [78.428228, 17.417393]; // [lng, lat] — MapLibre order
const DEFAULT_ZOOM    = 16;
const INITIAL_ZOOM    = 19;   // first camera lock onto the drone zooms in closer than the follow-cam's usual level
const DEFAULT_PITCH   = 58;   // oblique bird's-eye
const DEFAULT_BEARING = 20;   // slight rotation for depth
const OBJECT_HIT_RADIUS_PX = 26; // click-to-select tolerance around a vehicle's projected screen position
const DRONE_HIT_RADIUS_PX = 30;
const DRONE_SCALE_BOOST = 1.8; // true 1:1 meter scale reads as a speck at this camera distance
const DRONE_SMOOTHING = 0.18;  // per-frame lerp factor toward the latest telemetry fix

// MapLibre's `center` always renders at the exact screen center, but that's
// the GROUND point (altitude 0) — the drone itself sits `alt` meters above
// it, and with the map pitched, an elevated point projects higher up the
// screen than its ground point does, so centering on the drone's raw
// lat/lng leaves it looking off-center (too high). Compensating: push the
// look-at point forward (in the direction the camera is already facing,
// i.e. the drone's heading, since bearing is locked to heading below) by
// the ground distance an object at this altitude and pitch appears to
// parallax — `alt * tan(pitch)` — so the drone's actual elevated position
// lands back on the true center of the screen.
function droneCameraCenter(lat, lng, alt, headingDeg) {
  const forwardM = Math.max(0, alt) * Math.tan((DEFAULT_PITCH * Math.PI) / 180);
  const headingRad = (headingDeg * Math.PI) / 180;
  const dLat = (forwardM * Math.cos(headingRad)) / 111320;
  const dLng = (forwardM * Math.sin(headingRad)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

// OpenStreetMap raster tiles — no API key required.
const MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// ── Popup HTML builders ───────────────────────────────────────────────────────
function makeObjectPopupHTML(o) {
  const color     = classColor(o.cls);
  const confColor = o.confidence >= 0.7 ? "#22c55e" : o.confidence >= 0.4 ? "#f59e0b" : "#ef4444";
  const confPct   = (o.confidence * 100).toFixed(0);
  return `
    <div style="font-family:system-ui,sans-serif;font-size:12px;min-width:180px;color:#e2e8f0;background:#1e293b;border-radius:8px;overflow:hidden;">
      <div style="background:${color}22;border-bottom:1px solid ${color}44;padding:8px 10px;display:flex;align-items:center;gap:8px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};flex-shrink:0;"></span>
        <span style="font-weight:700;color:#fff;">ID ${o.track_id}</span>
        <span style="margin-left:auto;font-size:10px;background:${color}33;color:${color};padding:1px 6px;border-radius:4px;">${o.cls.replace(/_/g, " ")}</span>
      </div>
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Confidence</span>
          <span style="color:${confColor};font-weight:600;">${confPct}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Lat</span>
          <span style="font-family:monospace;color:#e2e8f0;">${o.lat.toFixed(6)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Lng</span>
          <span style="font-family:monospace;color:#e2e8f0;">${o.lng.toFixed(6)}</span>
        </div>
      </div>
    </div>`;
}

function makeDronePopupHTML(d) {
  return `
    <div style="font-family:system-ui,sans-serif;font-size:12px;min-width:180px;color:#e2e8f0;background:#1e293b;border-radius:8px;overflow:hidden;">
      <div style="background:#ef444422;border-bottom:1px solid #ef444444;padding:8px 10px;display:flex;align-items:center;gap:8px;">
        <span style="font-weight:700;color:#fff;">Drone</span>
        ${d.frame_index != null ? `<span style="margin-left:auto;font-size:10px;color:#94a3b8;">Frame ${d.frame_index}</span>` : ""}
      </div>
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Altitude</span>
          <span style="color:#fbbf24;font-weight:600;">${parseFloat(d.alt).toFixed(1)} m</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Heading</span>
          <span style="color:#e2e8f0;">${parseFloat(d.heading).toFixed(1)}°</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Pitch</span>
          <span style="color:#e2e8f0;">${parseFloat(d.pitch ?? 0).toFixed(1)}°</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Lat</span>
          <span style="font-family:monospace;color:#e2e8f0;">${parseFloat(d.lat).toFixed(6)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#94a3b8;">Lng</span>
          <span style="font-family:monospace;color:#e2e8f0;">${parseFloat(d.lng).toFixed(6)}</span>
        </div>
      </div>
    </div>`;
}

// ── Three.js custom layer: 3D drone + vehicle meshes + waypoint rings ─────────
// MapLibre's renderingMode:"3d" render() no longer hands back a raw matrix —
// it passes { modelViewProjectionMatrix, ... }, a world(mercator)-space ->
// clip-space matrix. Positions absolute in that mercator [0,1) space are too
// small-magnitude for float32 at this zoom (visible jitter), so every
// position below is computed *relative to the drone's current location*
// each frame, with that same offset folded into the camera matrix.
function createVehicleLayer(id, map) {
  return {
    id,
    type: "custom",
    renderingMode: "3d",

    onAdd(_map, gl) {
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const sun = new THREE.DirectionalLight(0xffffff, 0.85);
      sun.position.set(80, 160, 200);
      this.scene.add(sun);

      this.vehicles = new Map(); // track_id -> { mount, heading, cls }
      this.trail = new FlightTrail();
      this.scene.add(this.trail.group);

      // Drone model: built once, reused every frame — only its mount's
      // position/scale and heading group's rotation change per frame.
      this.droneModel = buildDroneModel();
      this.droneMount = new THREE.Group();
      this.droneMount.rotation.x = Math.PI / 2; // authored Y-up model -> world Z-up ground plane
      this.droneHeading = new THREE.Group();
      this.droneHeading.add(this.droneModel);
      this.droneMount.add(this.droneHeading);
      this.droneMount.visible = false;
      this.scene.add(this.droneMount);
      this.droneRender = null; // smoothed { lat, lng, alt, heading }, set on first fix
      this._frame = 0;

      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },

    render(gl, options) {
      // MapLibre's modelViewProjectionMatrix does NOT take normalized (0..1)
      // MercatorCoordinates — it takes "world" pixel coordinates (mercator
      // fraction * worldSize, i.e. tileSize * 2^zoom, which is in the
      // millions at typical zoom) for X/Y, and raw meters for Z. worldSize
      // isn't in the public API but is the standard, widely-used escape
      // hatch for this exact custom-layer use case.
      const worldSize = map.transform?.worldSize ?? 512 * Math.pow(2, map.getZoom());

      const drone = store.drone;
      const originLngLat = drone ? [drone.lng, drone.lat] : map.getCenter().toArray();
      const originMc = maplibregl.MercatorCoordinate.fromLngLat(originLngLat, 0);
      const originX = originMc.x * worldSize;
      const originY = originMc.y * worldSize;
      // World-pixels per meter, horizontal only — Z is already raw meters,
      // no conversion needed there.
      const worldPixelsPerMeter = originMc.meterInMercatorCoordinateUnits() * worldSize;

      // Absolute world-pixel position of (lat,lng,altMeters), minus the
      // origin — keeps every coordinate small-magnitude (a few hundred
      // world-pixels at most) instead of the multi-million absolute value,
      // which would otherwise blow past float32 precision and jitter.
      const toRelative = (lat, lng, altMeters = 0) => {
        const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        return [mc.x * worldSize - originX, mc.y * worldSize - originY, altMeters];
      };

      this._frame++;

      // ── Drone: smoothed toward the latest telemetry fix each frame so it
      // glides between updates instead of snapping.
      if (drone) {
        if (!this.droneRender) {
          this.droneRender = { lat: drone.lat, lng: drone.lng, alt: drone.alt, heading: drone.heading };
        } else {
          const s = DRONE_SMOOTHING;
          this.droneRender.lat += (drone.lat - this.droneRender.lat) * s;
          this.droneRender.lng += (drone.lng - this.droneRender.lng) * s;
          this.droneRender.alt += (drone.alt - this.droneRender.alt) * s;
          let dh = drone.heading - this.droneRender.heading;
          while (dh > 180) dh -= 360;
          while (dh < -180) dh += 360;
          this.droneRender.heading += dh * s;
        }

        const [dx, dy, dz] = toRelative(this.droneRender.lat, this.droneRender.lng, this.droneRender.alt);
        this.droneMount.position.set(dx, dy, dz);
        const s3d = worldPixelsPerMeter * DRONE_SCALE_BOOST;
        this.droneMount.scale.set(s3d, DRONE_SCALE_BOOST, s3d);
        this.droneHeading.rotation.y = -(this.droneRender.heading * Math.PI) / 180;
        this.droneMount.visible = true;

        const rotors = this.droneModel.userData.rotors;
        for (let i = 0; i < rotors.length; i++) rotors[i].rotation.y += i % 2 ? -2.4 : 2.4;
        this.droneModel.userData.strobe.visible = this._frame % 20 < 5;
      }

      // ── Vehicles: mount (world position/scale + fixed ground-plane tilt)
      // > heading (per-frame yaw) > the authored Y-up model, unchanged.
      const seen = new Set();
      store.objects.forEach((obj) => {
        seen.add(obj.track_id);
        let entry = this.vehicles.get(obj.track_id);
        if (!entry || entry.cls !== obj.cls) {
          if (entry) this.scene.remove(entry.mount);
          const mount = new THREE.Group();
          mount.rotation.x = Math.PI / 2; // authored Y-up model -> world Z-up ground plane
          const heading = new THREE.Group();
          const color = classColor(obj.cls);
          heading.add(buildVehicleModel(obj.cls, color));
          heading.add(buildMarker(color));
          mount.add(heading);
          this.scene.add(mount);
          entry = { mount, heading, cls: obj.cls };
          this.vehicles.set(obj.track_id, entry);
        }
        const [x, y, z] = toRelative(obj.lat, obj.lng, 0);
        entry.mount.position.set(x, y, z);
        // Local X/Z (this model's width/length) land on world X/Y (world
        // pixels) after the tilt above; local Y (height) lands on world Z,
        // which is already raw meters — so only X/Z get the pixel scale.
        entry.mount.scale.set(worldPixelsPerMeter, 1, worldPixelsPerMeter);
        entry.heading.rotation.y = obj.heading != null ? -(obj.heading * Math.PI) / 180 : 0;
      });
      this.vehicles.forEach((entry, trackId) => {
        if (!seen.has(trackId)) {
          this.scene.remove(entry.mount);
          this.vehicles.delete(trackId);
        }
      });

      // ── Flight-path ribbon — rises through the air to meet the drone
      this.trail.update(store.flightPath, toRelative, worldPixelsPerMeter);

      this.camera.projectionMatrix
        .fromArray(options.modelViewProjectionMatrix)
        .multiply(new THREE.Matrix4().makeTranslation(originX, originY, 0));

      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      map.triggerRepaint(); // keep animating: drone/vehicles move and rotors spin every frame
    },

    onRemove() {
      this.vehicles?.forEach((entry) => this.scene.remove(entry.mount));
      this.vehicles?.clear();
      this.renderer?.dispose();
    },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DroneMap() {
  const containerRef    = useRef(null);
  const mapRef          = useRef(null);
  const dronePopupRef   = useRef(null);
  const objectPopupRef  = useRef(null); // single reusable popup for vehicle meshes
  const vehicleLayerRef = useRef(null); // three.js custom layer — read its smoothed drone position for the camera
  const rafRef          = useRef(null);
  const hasCenteredRef  = useRef(false);
  // Follow-cam: last { lat, lng, heading } we pointed the camera at, so we
  // only issue jumpTo() when the drone has actually moved/turned
  const lastCameraRef   = useRef({ lat: null, lng: null, heading: null });

  // "follow" = camera locks onto the drone every frame (existing behavior).
  // "free" = the rAF loop never touches the camera, so the user's own
  // drag/scroll/rotate on the map sticks instead of being overridden.
  // Kept as both state (so the checkboxes' checked= reflects it) and a ref
  // (so the rAF loop — created once, inside the effect below — always reads
  // the current value instead of a value captured at effect-creation time).
  const [cameraMode, setCameraMode] = useState("follow");
  const cameraModeRef = useRef("follow");
  function selectCameraMode(mode) {
    cameraModeRef.current = mode;
    setCameraMode(mode);
  }

  useEffect(() => {
    // StrictMode double-invokes this effect in dev (mount → cleanup → mount).
    // map.remove() in cleanup is synchronous, but the map's "load" event is
    // async and can still fire afterward — this flag stops that stale
    // callback from running setup logic on an already-destroyed map.
    let cancelled = false;

    // ── Init map ──────────────────────────────────────────────────────────────
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      antialias: true,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    mapRef.current = map;

    map.on("load", () => {
      if (cancelled) return; // this map was already torn down by a StrictMode phantom cleanup

      const vehicleLayer = createVehicleLayer("vehicles-3d", map);
      map.addLayer(vehicleLayer);
      vehicleLayerRef.current = vehicleLayer;

      // ── Camera footprint source + layer ───────────────────────────────────
      map.addSource("footprint", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[]] } },
      });

      map.addLayer({
        id: "footprint-fill",
        type: "fill",
        source: "footprint",
        paint: {
          "fill-color": "#facc15",
          "fill-opacity": 0.07,
        },
      });

      map.addLayer({
        id: "footprint-outline",
        type: "line",
        source: "footprint",
        paint: {
          "line-color": "#facc15",
          "line-width": 1.8,
          "line-opacity": 0.75,
          "line-dasharray": [4, 3],
        },
      });

      // Popups: the drone and vehicles are now 3D meshes, not DOM elements,
      // so both are opened manually from the nearest-hit test in the map's
      // own click handler below rather than per-marker click listeners.
      const dronePopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 18,
        className: "tel-popup-wrap",
        maxWidth: "220px",
      });
      dronePopupRef.current = dronePopup;

      const objectPopup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 12,
        className: "tel-popup-wrap",
        maxWidth: "220px",
      });
      objectPopupRef.current = objectPopup;

      // ── rAF loop: follow-cam, camera footprint, open-popup refresh ─────────
      // (The drone model, vehicle meshes, and waypoint rings are updated
      // inside the three.js custom layer's own render(), driven by its
      // triggerRepaint().)
      function renderLoop() {
        rafRef.current = requestAnimationFrame(renderLoop);
        if (!mapRef.current) return;

        if (store.drone) {
          // Camera and the 3D drone model must agree on where the drone
          // *actually* is — the model renders from a smoothed/lagged
          // position (droneRender, in the three.js layer) so it doesn't
          // jump between telemetry ticks. Centering the camera on the raw
          // instantaneous telemetry instead means the two drift apart while
          // the drone is moving, and the model visibly sits off-center. Use
          // the same smoothed value for both, falling back to raw telemetry
          // only before the layer has produced one yet.
          const smoothed = vehicleLayerRef.current?.droneRender;
          const lat = smoothed?.lat ?? store.drone.lat;
          const lng = smoothed?.lng ?? store.drone.lng;
          const alt = smoothed?.alt ?? store.drone.alt;
          const heading = smoothed?.heading ?? store.drone.heading;
          const center = droneCameraCenter(lat, lng, alt, heading);

          if (dronePopup.isOpen()) {
            dronePopup.setHTML(makeDronePopupHTML(store.drone));
          }

          if (!hasCenteredRef.current) {
            // First fix: snap straight there (no flyTo — an animated fly-in
            // would fight the continuous jumpTo() that starts immediately
            // on the very next frame below).
            map.jumpTo({ center, zoom: INITIAL_ZOOM, pitch: DEFAULT_PITCH, bearing: heading });
            lastCameraRef.current = { lat, lng, heading };
            hasCenteredRef.current = true;
          } else if (cameraModeRef.current === "follow") {
            const cam = lastCameraRef.current;
            if (cam.lat !== lat || cam.lng !== lng || cam.heading !== heading) {
              map.jumpTo({ center, bearing: heading });
              lastCameraRef.current = { lat, lng, heading };
            }
          }
        }

        if (store.footprint && store.footprint.length === 4) {
          const ring = store.footprint.map((p) => [p.lng, p.lat]);
          ring.push(ring[0]); // close polygon
          const src = map.getSource("footprint");
          if (src) {
            src.setData({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [ring] },
            });
          }
        }
      }

      renderLoop();
    }); // map.on("load")

    // Click the drone or a vehicle (nearest projected screen position within
    // tolerance) to open its popup; click empty map to close whatever's open.
    map.on("click", (e) => {
      if (store.drone) {
        const p = map.project([store.drone.lng, store.drone.lat]);
        if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < DRONE_HIT_RADIUS_PX) {
          objectPopupRef.current?.remove();
          dronePopupRef.current
            ?.setLngLat([store.drone.lng, store.drone.lat])
            .setHTML(makeDronePopupHTML(store.drone))
            .addTo(map);
          return;
        }
      }

      let nearest = null;
      let nearestDist = OBJECT_HIT_RADIUS_PX;
      store.objects.forEach((obj) => {
        const p = map.project([obj.lng, obj.lat]);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = obj;
        }
      });

      if (nearest) {
        dronePopupRef.current?.remove();
        objectPopupRef.current
          ?.setLngLat([nearest.lng, nearest.lat])
          .setHTML(makeObjectPopupHTML(nearest))
          .addTo(map);
      } else {
        dronePopupRef.current?.remove();
        objectPopupRef.current?.remove();
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      dronePopupRef.current?.remove();
      objectPopupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      hasCenteredRef.current = false;
      lastCameraRef.current = { lat: null, lng: null, heading: null };
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Camera mode — mutually exclusive: exactly one is checked at a time. */}
      <div className="absolute right-3 top-3 z-[400] flex flex-col gap-1.5 rounded-xl border border-slate-700/60 bg-slate-900/92 px-3 py-2.5 text-xs text-slate-200 shadow-2xl shadow-black/40 backdrop-blur-md">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={cameraMode === "follow"}
            onChange={() => selectCameraMode("follow")}
          />
          Follow drone
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={cameraMode === "free"}
            onChange={() => selectCameraMode("free")}
          />
          Free roam
        </label>
      </div>
    </div>
  );
}
