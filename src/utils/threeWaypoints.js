/**
 * threeWaypoints.js
 * A thick, glowing ribbon tracing the flight path at the drone's actual
 * recorded altitude at each point — a continuous trail floating in the air
 * where the drone flew, rising up to meet its current position, not
 * projected down to the ground. Two stacked layers: a wide soft additive
 * glow (the halo look) plus a narrower solid core (so it stays visible even
 * over a bright basemap, where additive-only glow washes out toward white).
 * Rebuilt in place every frame from preallocated typed-array buffers — no
 * per-frame GC churn even with a long path.
 */
import * as THREE from "three";

const MAX_POINTS = 2000;
const TAIL_COLOR = [0.29, 0.06, 1.0];  // #4a10ff — oldest end of the trail
const HEAD_COLOR = [1.0, 0.184, 0.816]; // #ff2fd0 — saturated pink at the current end, not washed-out white
const TAIL_GAP_M = 1.2; // small real-world gap between the ribbon's tip and the drone itself

function buildRibbon(opacity, additive, renderOrder) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array((MAX_POINTS - 1) * 6), 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    // depthTest must stay ON: this was left off from an earlier ground-ring
    // design (rings needed to never be occluded by nearby ground clutter),
    // but now the ribbon's tip sits right next to the drone — with depth
    // testing disabled it painted straight over the drone model regardless
    // of which was actually in front.
    depthTest: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return { mesh, geometry };
}

export class FlightTrail {
  constructor() {
    this.group = new THREE.Group();
    this.glow = buildRibbon(0.4, true, 0);  // wide, soft, additive halo
    this.core = buildRibbon(0.95, false, 1); // narrower, solid — always visible regardless of basemap
    this.group.add(this.glow.mesh, this.core.mesh);
  }

  /**
   * @param points          store.flightPath — [{lat,lng,alt}], oldest first
   * @param toRelative      (lat,lng,altMeters) -> [x,y,z] scene-relative
   * @param worldPixelsPerMeter  horizontal meter -> world-pixel scale factor
   * @param glowHalfWidthM / coreHalfWidthM  ribbon half-widths, in meters
   */
  update(points, toRelative, worldPixelsPerMeter, glowHalfWidthM = 1.8, coreHalfWidthM = 0.6) {
    const n = Math.min(points.length, MAX_POINTS);
    if (n < 2) {
      this.glow.geometry.setDrawRange(0, 0);
      this.core.geometry.setDrawRange(0, 0);
      return;
    }

    const rel = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      // Real altitude at each point — this is what makes the ribbon rise
      // through the air to meet the drone instead of sitting on the ground.
      rel[i] = toRelative(p.lat, p.lng, p.alt || 0);
    }

    // Pull the tip back a small gap so the ribbon trails from just behind
    // the drone's tail instead of appearing to emerge from its center.
    if (n >= 2) {
      const head = rel[n - 1];
      const prev = rel[n - 2];
      const dx = head[0] - prev[0], dy = head[1] - prev[1], dz = head[2] - prev[2];
      const segLen = Math.hypot(dx, dy, dz) || 1;
      const gap = Math.min(TAIL_GAP_M * worldPixelsPerMeter, segLen * 0.9);
      const t = 1 - gap / segLen;
      rel[n - 1] = [prev[0] + dx * t, prev[1] + dy * t, prev[2] + dz * t];
    }

    fillRibbon(this.glow, rel, n, glowHalfWidthM * worldPixelsPerMeter);
    fillRibbon(this.core, rel, n, coreHalfWidthM * worldPixelsPerMeter);
  }
}

function fillRibbon({ geometry }, rel, n, halfWidth) {
  const pos = geometry.attributes.position.array;
  const col = geometry.attributes.color.array;

  for (let i = 0; i < n; i++) {
    const [x, y, z] = rel[i];
    let dx, dy;
    if (i === 0) {
      dx = rel[1][0] - x;
      dy = rel[1][1] - y;
    } else if (i === n - 1) {
      dx = x - rel[i - 1][0];
      dy = y - rel[i - 1][1];
    } else {
      dx = rel[i + 1][0] - rel[i - 1][0];
      dy = rel[i + 1][1] - rel[i - 1][1];
    }
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * halfWidth;
    const py = (dx / len) * halfWidth;

    const t = i / (n - 1); // 0 = oldest (tail) -> 1 = current position (head)
    const r = TAIL_COLOR[0] + (HEAD_COLOR[0] - TAIL_COLOR[0]) * t;
    const g = TAIL_COLOR[1] + (HEAD_COLOR[1] - TAIL_COLOR[1]) * t;
    const b = TAIL_COLOR[2] + (HEAD_COLOR[2] - TAIL_COLOR[2]) * t;

    const vi = i * 2;
    pos[vi * 3] = x - px;
    pos[vi * 3 + 1] = y - py;
    pos[vi * 3 + 2] = z;
    pos[(vi + 1) * 3] = x + px;
    pos[(vi + 1) * 3 + 1] = y + py;
    pos[(vi + 1) * 3 + 2] = z;

    col[vi * 3] = r; col[vi * 3 + 1] = g; col[vi * 3 + 2] = b;
    col[(vi + 1) * 3] = r; col[(vi + 1) * 3 + 1] = g; col[(vi + 1) * 3 + 2] = b;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;

  const idx = geometry.index.array;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    const t6 = i * 6;
    idx[t6] = a; idx[t6 + 1] = b; idx[t6 + 2] = c;
    idx[t6 + 3] = b; idx[t6 + 4] = d; idx[t6 + 5] = c;
  }
  geometry.index.needsUpdate = true;
  geometry.setDrawRange(0, (n - 1) * 6);
}
