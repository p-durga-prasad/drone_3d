import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import * as THREE from "three";
import { store } from "../store/telemetryStore";
import { useTelemetrySync } from "../hooks/useTelemetrySync";
import { classColor } from "../utils/classColors";
import { buildVehicleModel, buildMarker, buildDroneModel } from "../utils/threeVehicles";
import { FlightTrail } from "../utils/threeWaypoints";

/* =========================================================================
   Port of the reference digital-twin renderer's TPP ("flight following")
   chase camera + cinematic HUD (mapping/templates/real.html), onto this
   app's existing live WebSocket -> telemetryStore pipeline. Same camera-
   solve math and HUD chrome (sky/vignette, top-right counts panel,
   status/warn badges) — no follow/free-roam toggle and no click popups,
   because the reference renderer has neither: it's a passive,
   non-interactive, camera-driven cinematic view.

   TUNE below deliberately does NOT match real.html's literal numbers.
   real.html's screen-space-derived camera solve is altitude-invariant, but
   its distance floor is set by the OSM raster tile ceiling (z19) and the
   viewport's FOV — at real.html's own pitchDeg=72/droneScreenY=0.28/
   groundScreenY=0.72 defaults, the solved camera sits ~200m from a drone
   flying at 60m AGL (measured, not guessed — see the geometry sweep this
   was tuned against). That's simply too far for this app's low-altitude
   urban traffic scenes to read as a "close chase". These values instead
   target ~120-140m at that altitude — as close as the z19 tile ceiling
   comfortably allows before zoom clamps and tiles start missing.
   ========================================================================= */
const TUNE = {
  pitchDeg: 55,
  droneScreenY: 0.42,
  groundScreenY: 0.92,
  zoomMin: 12.0,
  zoomMax: 18.8,
  smoothPos: 0.22,
  smoothZoom: 0.10,
  smoothPitch: 0.08,
  smoothBearing: 0.09,
  droneTargetPx: 95,
  droneScaleMin: 1.0,
  droneScaleMax: 22.0,
  objModelDivisor: 50,
  objModelMax: 3.0,
  objMarkerDivisor: 33,
  objMarkerMax: 5.0,
};

const D2R = Math.PI / 180;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function mppFromZoom(zoom, lat) {
  return (78271.516964 * Math.cos(lat * D2R)) / Math.pow(2, zoom);
}
function zoomFromMpp(mpp, lat) {
  return Math.log2((78271.516964 * Math.cos(lat * D2R)) / mpp);
}
function offsetLatLon(lat, lng, distM, headingRad) {
  const dLat = (distM * Math.cos(headingRad)) / 111320.0;
  const dLng = (distM * Math.sin(headingRad)) / (111320.0 * Math.max(0.2, Math.cos(lat * D2R)));
  return { lat: lat + dLat, lng: lng + dLng };
}

// OpenStreetMap raster tiles — no API key required. maxzoom:19 matters: OSM
// serves no z20 tiles, and without this a raster source requests z20 at the
// chase cam's typical zoom and every tile 404s.
const MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#070b14" } },
    {
      id: "osm", type: "raster", source: "osm",
      paint: {
        "raster-brightness-min": 0.0,
        "raster-brightness-max": 0.80,
        "raster-contrast": 0.12,
        "raster-saturation": -0.18,
      },
    },
  ],
};

// ── Camera geometry helpers ──────────────────────────────────────────────
function getFovRad(map) {
  const t = map.transform;
  if (t) {
    if (typeof t._fov === "number" && t._fov > 0 && t._fov < 3) return t._fov;
    if (typeof t.fov === "number" && t.fov > 3) return t.fov * D2R;
  }
  return 0.6435011087932844; // MapLibre default, 36.87 deg
}
function viewportH(map) {
  const t = map.transform;
  if (t && t.height) return t.height;
  const c = map.getCanvas();
  return (c && c.clientHeight) || 720;
}

/* TPP flight-following camera — solved exactly (not approximated) so the
   drone lands on the same screen row at any altitude/zoom clamp. See
   real.html's computeChase() for the full derivation. */
function computeChase(pose, map, camState) {
  const alt = clamp(pose.alt || 60, 4, 900);
  const lat = pose.lat;
  const pitchDeg = Math.min(TUNE.pitchDeg, camState.maxPitch - 1.5);
  const pitch = pitchDeg * D2R;
  const halfTan = Math.tan(getFovRad(map) / 2);
  const pxDist = (0.5 / halfTan) * viewportH(map);
  const axis = (90 - pitchDeg) * D2R;

  const tD = Math.tan(Math.max(0.01, axis - Math.atan((1 - 2 * TUNE.droneScreenY) * halfTan)));
  const tG = Math.tan(Math.max(0.02, axis - Math.atan((1 - 2 * TUNE.groundScreenY) * halfTan)));

  let chaseBack, camAlt;
  if (tG - tD > 1e-4) {
    chaseBack = alt / (tG - tD);
    camAlt = chaseBack * tG;
  } else {
    camAlt = alt * 1.5;
    chaseBack = camAlt / tG;
  }

  let zoom = zoomFromMpp(camAlt / Math.cos(pitch) / pxDist, lat);
  zoom = clamp(zoom, TUNE.zoomMin, TUNE.zoomMax);

  const dist3d = mppFromZoom(zoom, lat) * pxDist;
  camAlt = dist3d * Math.cos(pitch);
  chaseBack = clamp(camAlt / tG, 20, 8000);
  const groundSpan = dist3d * Math.sin(pitch);
  const ahead = groundSpan - chaseBack;

  const hdg = (pose.heading || 0) * D2R;
  const c = offsetLatLon(pose.lat, pose.lng, ahead, hdg);

  camState.camAlt = camAlt;
  camState.chaseBack = chaseBack;
  camState.camDist = Math.sqrt(chaseBack * chaseBack + Math.pow(Math.max(0, camAlt - alt), 2));

  return { lng: c.lng, lat: c.lat, zoom, pitch: pitchDeg, bearing: pose.heading || 0 };
}

function updateCamera(pose, map, cam, camState) {
  const t = computeChase(pose, map, camState);
  if (cam.lng == null) {
    cam.lng = t.lng; cam.lat = t.lat; cam.zoom = t.zoom; cam.pitch = t.pitch; cam.bearing = t.bearing;
  } else {
    cam.lng += (t.lng - cam.lng) * TUNE.smoothPos;
    cam.lat += (t.lat - cam.lat) * TUNE.smoothPos;
    cam.zoom += (t.zoom - cam.zoom) * TUNE.smoothZoom;
    cam.pitch += (t.pitch - cam.pitch) * TUNE.smoothPitch;
    let bd = t.bearing - cam.bearing;
    while (bd > 180) bd -= 360;
    while (bd < -180) bd += 360;
    cam.bearing += bd * TUNE.smoothBearing;
  }
  map.jumpTo({ center: [cam.lng, cam.lat], zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });
}

// ── Three.js custom layer: drone + vehicles + trail ─────────────────────────
// camState is the SAME mutable object updateCamera() writes chaseBack/camAlt
// into every frame (a plain-object bridge, same pattern telemetryStore uses
// for store — mutate in place, read directly, no React state round-trip).
function createVehicleLayer(id, map, camState) {
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

      this.vehicles = new Map(); // track_id -> { mount, heading, cls, enterStart, ring }
      this.trail = new FlightTrail();
      this.scene.add(this.trail.group);

      this.droneModel = buildDroneModel();
      this.droneMount = new THREE.Group();
      this.droneMount.rotation.x = Math.PI / 2;
      this.droneHeading = new THREE.Group();
      this.droneHeading.add(this.droneModel);
      this.droneMount.add(this.droneHeading);
      this.droneMount.visible = false;
      this.scene.add(this.droneMount);
      this.droneRender = null;

      this._frame = 0;

      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },

    render(gl, options) {
      const worldSize = map.transform?.worldSize ?? 512 * Math.pow(2, map.getZoom());

      const drone = store.drone;
      const originLngLat = drone ? [drone.lng, drone.lat] : map.getCenter().toArray();
      const originMc = maplibregl.MercatorCoordinate.fromLngLat(originLngLat, 0);
      const originX = originMc.x * worldSize;
      const originY = originMc.y * worldSize;
      const worldPixelsPerMeter = originMc.meterInMercatorCoordinateUnits() * worldSize;

      const toRelative = (lat, lng, altMeters = 0) => {
        const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        return [mc.x * worldSize - originX, mc.y * worldSize - originY, altMeters];
      };

      this._frame++;
      const now = performance.now();

      // ── Drone: smoothed toward the latest fix so it glides between ticks.
      if (drone) {
        if (!this.droneRender) {
          this.droneRender = { lat: drone.lat, lng: drone.lng, alt: drone.alt, heading: drone.heading };
        } else {
          const s = 0.18;
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

        // Distance-adaptive drone scale (real.html's droneTargetPx formula):
        // sized so the model reads at a roughly constant on-screen pixel
        // footprint regardless of how far the chase camera currently sits,
        // instead of a fixed multiplier that shrinks visually as camDist grows.
        const pxDist = (0.5 / Math.tan(getFovRad(map) / 2)) * viewportH(map);
        const wantMeters = (TUNE.droneTargetPx / pxDist) * camState.camDist;
        const dScale = clamp(wantMeters / 3.2, TUNE.droneScaleMin, TUNE.droneScaleMax);
        const s3d = worldPixelsPerMeter * dScale;
        this.droneMount.scale.set(s3d, dScale, s3d);
        this.droneHeading.rotation.y = -(this.droneRender.heading * Math.PI) / 180;
        this.droneMount.rotation.z = (drone.roll || 0) * D2R;
        this.droneMount.visible = true;

        const rotors = this.droneModel.userData.rotors;
        for (let i = 0; i < rotors.length; i++) rotors[i].rotation.y += i % 2 ? -2.4 : 2.4;
        this.droneModel.userData.strobe.visible = this._frame % 20 < 5;
      }

      // ── Vehicles: mount (world position, meters->world-pixels) > heading
      // (yaw) > modelGroup / markerGroup, each with its own altitude-adaptive
      // scale — markers get boosted harder than the model itself so glow/ring
      // stay legible from a distant chase camera, exactly like real.html's
      // objModelDivisor(90)/objMarkerDivisor(60) split.
      const modelScale = clamp(camState.chaseBack / TUNE.objModelDivisor, 1, TUNE.objModelMax);
      const markerScale = clamp(camState.chaseBack / TUNE.objMarkerDivisor, 1.2, TUNE.objMarkerMax);

      const seen = new Set();
      store.objects.forEach((obj) => {
        seen.add(obj.track_id);
        let entry = this.vehicles.get(obj.track_id);
        if (!entry || entry.cls !== obj.cls) {
          if (entry) this.scene.remove(entry.mount);
          const mount = new THREE.Group();
          mount.rotation.x = Math.PI / 2;
          const heading = new THREE.Group();
          const color = classColor(obj.cls);
          const modelGroup = new THREE.Group();
          modelGroup.add(buildVehicleModel(obj.cls, color));
          const markerGroup = new THREE.Group();
          const marker = buildMarker(color);
          markerGroup.add(marker);
          heading.add(modelGroup, markerGroup);
          mount.add(heading);
          this.scene.add(mount);
          entry = {
            mount, heading, modelGroup, markerGroup, cls: obj.cls,
            ring: marker.userData.ring, enterStart: now,
          };
          this.vehicles.set(obj.track_id, entry);
        }
        const [x, y, z] = toRelative(obj.lat, obj.lng, 0);
        entry.mount.position.set(x, y, z);
        entry.mount.scale.set(worldPixelsPerMeter, 1, worldPixelsPerMeter);
        entry.heading.rotation.y = obj.heading != null ? -(obj.heading * Math.PI) / 180 : 0;

        // Entering pop-in (0 -> 1 over 300ms) multiplies on top of the
        // altitude-adaptive scale; steady-state just applies the adaptive
        // scale plus a gentle idle ring pulse.
        let enterT = 1;
        if (entry.enterStart != null) {
          enterT = Math.min(1, (now - entry.enterStart) / 300);
          if (enterT >= 1) entry.enterStart = null;
        }
        entry.modelGroup.scale.setScalar(Math.max(0.05, modelScale * enterT));
        entry.markerGroup.scale.setScalar(Math.max(0.05, markerScale * enterT));
        if (entry.enterStart == null && entry.ring) {
          entry.ring.scale.setScalar(1 + 0.06 * Math.sin(now * 0.003));
        }
      });
      this.vehicles.forEach((entry, trackId) => {
        if (!seen.has(trackId)) {
          this.scene.remove(entry.mount);
          this.vehicles.delete(trackId);
        }
      });

      // ── Flight-path ribbon.
      this.trail.update(store.flightPath, toRelative, worldPixelsPerMeter);

      this.camera.projectionMatrix
        .fromArray(options.modelViewProjectionMatrix)
        .multiply(new THREE.Matrix4().makeTranslation(originX, originY, 0));

      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      map.triggerRepaint();
    },

    onRemove() {
      this.vehicles?.forEach((entry) => this.scene.remove(entry.mount));
      this.vehicles?.clear();
      this.renderer?.dispose();
    },
  };
}

// ── Component ─────────────────────────────────────────────────────────────
// Counts panel is intentionally NOT reimplemented here — the restored
// outhouse dashboard (HUD + Sidebar) already shows per-class counts and a
// running total; a second copy in this corner would just be a duplicate.
// Status/warn badges and the sky/vignette cosmetic overlays stay: they're
// real.html's cinematic chrome, not dashboard data, so nothing else covers them.
export default function DroneMap() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const vehicleLayerRef = useRef(null);
  const rafRef = useRef(null);
  const camRef = useRef({ lng: null, lat: null, zoom: null, pitch: null, bearing: null });
  const camStateRef = useRef({ maxPitch: 60, camAlt: 100, chaseBack: 150, camDist: 200 });
  // Scroll to zoom / drag to pan hands control to the user; the chase cam
  // stops overwriting the view every frame until they click "Follow drone"
  // again. manualRef is what the rAF loop reads (state wouldn't be visible
  // inside a closure created once on mount); manual (state) just drives the
  // button's visibility.
  const manualRef = useRef(false);
  const [manual, setManual] = useState(false);

  const snapshot = useTelemetrySync();

  useEffect(() => {
    let cancelled = false;

    // interactive:false disables every handler at once; build it disabled
    // then enable only scroll-to-zoom and drag-to-pan. dragRotate/keyboard/
    // boxZoom/touchZoomRotate stay off — bearing and pitch remain the chase
    // cam's job, so a rotate gesture can't fight it mid-follow.
    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [78.428228, 17.417393],
        zoom: 17,
        pitch: 60,
        bearing: 0,
        interactive: false,
        attributionControl: false,
        antialias: true,
        fadeDuration: 0,
        maxPitch: 85,
      });
      camStateRef.current.maxPitch = 85;
    } catch {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [78.428228, 17.417393],
        zoom: 17,
        pitch: 60,
        bearing: 0,
        interactive: false,
        attributionControl: false,
        antialias: true,
        fadeDuration: 0,
      });
      camStateRef.current.maxPitch = 60;
    }
    if (typeof map.getMaxPitch === "function") {
      try { camStateRef.current.maxPitch = map.getMaxPitch(); } catch { /* keep assumed value */ }
    }
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.doubleClickZoom.enable();

    const goManual = () => {
      if (manualRef.current) return;
      manualRef.current = true;
      setManual(true);
    };
    map.on("dragstart", goManual);
    map.on("wheel", goManual);
    map.on("touchstart", goManual);

    mapRef.current = map;

    map.on("load", () => {
      if (cancelled) return;

      const vehicleLayer = createVehicleLayer("vehicles-3d", map, camStateRef.current);
      map.addLayer(vehicleLayer);
      vehicleLayerRef.current = vehicleLayer;

      function renderLoop() {
        rafRef.current = requestAnimationFrame(renderLoop);
        if (!mapRef.current || !store.drone || manualRef.current) return;
        updateCamera(store.drone, map, camRef.current, camStateRef.current);
      }
      renderLoop();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
      camRef.current = { lng: null, lat: null, zoom: null, pitch: null, bearing: null };
      manualRef.current = false;
    };
  }, []);

  function resumeFollow() {
    manualRef.current = false;
    setManual(false);
    // Null out cam so the next chase-cam frame snaps straight to the drone
    // instead of smoothing in from wherever the user left the view.
    camRef.current = { lng: null, lat: null, zoom: null, pitch: null, bearing: null };
  }

  const showWarn = !snapshot.drone;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: "#05070c" }}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Atmospheric haze over the far field. Cosmetic, matches real.html's #sky. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-[4]"
        style={{
          height: "46%",
          background:
            "linear-gradient(to bottom, rgba(8,14,28,0.85) 0%, rgba(10,18,34,0.55) 45%, rgba(10,18,34,0) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 66%, rgba(0,0,0,0.42) 100%)" }}
      />

      <div
        className="pointer-events-none absolute z-10 tracking-wider"
        style={{ bottom: 18, right: 18, fontSize: 11, color: "#6cff6c", textShadow: "0 0 8px rgba(108,255,108,0.6)" }}
      >
        ● LIVE 3D
      </div>

      {showWarn && (
        <div
          className="pointer-events-none absolute z-10 tracking-wider"
          style={{ bottom: 18, left: 18, fontSize: 11, color: "#ffcf4d", textShadow: "0 0 8px rgba(255,207,77,0.6)" }}
        >
          ▲ NO DRONE TELEMETRY
        </div>
      )}

      {manual && (
        <button
          onClick={resumeFollow}
          className="absolute z-10 rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide transition-colors hover:brightness-125"
          style={{
            bottom: 18, left: "50%", transform: "translateX(-50%)",
            background: "rgba(8,11,18,0.75)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(147,20,255,0.55)", color: "#f2f2f7",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          ▶ Follow drone
        </button>
      )}
    </div>
  );
}
