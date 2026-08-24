/**
 * threeVehicles.js
 * Procedural, meter-scale THREE.Group vehicle models — car / bike / auto /
 * truck / person. Authored Y-up with the nose pointing -Z, so a heading of 0
 * faces -Z; DroneMap applies heading as a rotation around the model's own Y.
 */
import * as THREE from "three";

function box(w, h, d, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
  mesh.castShadow = false;
  return mesh;
}

function wheel(x, z, radius = 0.33, width = 0.24) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 14),
    new THREE.MeshStandardMaterial({ color: 0x14161c })
  );
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, radius, z);
  return mesh;
}

const GLASS = 0x3a4860;

export function buildCarModel(color) {
  const g = new THREE.Group();
  const body = box(1.62, 0.52, 3.7, color);
  body.position.set(0, 0.55, 0);
  const cabin = box(1.42, 0.48, 1.85, GLASS);
  cabin.position.set(0, 1.03, 0.15);
  g.add(body, cabin);
  g.add(wheel(-0.76, -1.2), wheel(0.76, -1.2), wheel(-0.76, 1.2), wheel(0.76, 1.2));
  return g;
}

export function buildBikeModel(color) {
  const g = new THREE.Group();
  const body = box(0.5, 0.42, 1.75, color);
  body.position.set(0, 0.42, 0);
  const seat = box(0.38, 0.16, 0.7, color);
  seat.position.set(0, 0.68, 0.12);
  const bar = box(0.62, 0.07, 0.07, 0x14161c);
  bar.position.set(0, 0.75, -0.62);
  g.add(body, seat, bar);
  g.add(wheel(0, -0.72, 0.3, 0.11), wheel(0, 0.72, 0.3, 0.11));
  return g;
}

export function buildAutoModel(color) {
  const g = new THREE.Group();
  const body = box(1.05, 0.62, 1.6, color);
  body.position.set(0, 0.42, 0);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: GLASS })
  );
  canopy.scale.set(0.95, 0.65, 0.88);
  canopy.position.set(0, 0.68, 0);
  g.add(body, canopy);
  g.add(wheel(0, -0.62, 0.25, 0.13), wheel(-0.52, 0.55, 0.25, 0.13), wheel(0.52, 0.55, 0.25, 0.13));
  return g;
}

export function buildTruckModel(color) {
  const g = new THREE.Group();
  const cargo = box(2.35, 1.95, 6.3, color);
  cargo.position.set(0, 1.5, 0.7);
  const cab = box(2.1, 1.25, 1.5, GLASS);
  cab.position.set(0, 1.05, -2.85);
  g.add(cargo, cab);
  g.add(
    wheel(-1.06, -2.55, 0.43, 0.28), wheel(1.06, -2.55, 0.43, 0.28),
    wheel(-1.06, 0.6, 0.43, 0.28), wheel(1.06, 0.6, 0.43, 0.28),
    wheel(-1.06, 2.5, 0.43, 0.28), wheel(1.06, 2.5, 0.43, 0.28)
  );
  return g;
}

export function buildPersonModel(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.85, 12),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.set(0, 0.78, 0);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xebebf0 })
  );
  head.position.set(0, 1.52, 0);
  g.add(body, head);
  return g;
}

export function buildDefaultModel(color) {
  const g = new THREE.Group();
  g.add(box(1.2, 1.2, 1.2, color));
  return g;
}

const BUILDERS = {
  four_wheeler: buildCarModel,
  two_wheeler: buildBikeModel,
  three_wheeler: buildAutoModel,
  six_plus_wheeler: buildTruckModel,
  person: buildPersonModel,
};

export function buildVehicleModel(cls, colorHex) {
  const build = BUILDERS[cls] ?? buildDefaultModel;
  return build(new THREE.Color(colorHex));
}

// ── Glow disc + beam marker (matches the reference digital-twin renderer's
// makeGlowDisc/makeBeam: canvas-generated radial/linear gradients, additive
// blending, sitting under/around each vehicle) ────────────────────────────
const _glowTexCache = {};
function radialGlowTexture(hex) {
  const key = "r" + hex;
  if (_glowTexCache[key]) return _glowTexCache[key];
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = s; cv.height = s;
  const ctx = cv.getContext("2d");
  const c = new THREE.Color(hex);
  const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.0, `rgba(${r},${g},${b},1.0)`);
  grad.addColorStop(0.28, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.62, `rgba(${r},${g},${b},0.16)`);
  grad.addColorStop(1.0, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  _glowTexCache[key] = tex;
  return tex;
}

function beamTexture(hex) {
  const key = "b" + hex;
  if (_glowTexCache[key]) return _glowTexCache[key];
  const w = 8, h = 128;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const c = new THREE.Color(hex);
  const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0.0, `rgba(${r},${g},${b},0.75)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.22)`);
  grad.addColorStop(1.0, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  _glowTexCache[key] = tex;
  return tex;
}

// ── Procedural quadcopter drone model ───────────────────────────────────────
// Full body + four arms/motors/spinning-prop-discs/legs, nose at -Z (same
// convention as the vehicle models above) so it composes with the same
// mount(tilt) > heading(yaw) nesting used everywhere else in this file.
// userData.rotors / userData.strobe let the render loop animate spin + blink
// without rebuilding the model.
export function buildDroneModel() {
  const g = new THREE.Group();
  const shell  = new THREE.MeshPhongMaterial({ color: 0x2b2f37, shininess: 70, specular: 0x6a7180 });
  const shell2 = new THREE.MeshPhongMaterial({ color: 0x454b57, shininess: 95, specular: 0x8a91a0 });
  const dark   = new THREE.MeshPhongMaterial({ color: 0x121419, shininess: 25 });
  const metal  = new THREE.MeshPhongMaterial({ color: 0x9aa2b1, shininess: 140, specular: 0xffffff });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 1.35), shell);
  g.add(hull);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 1.14), shell2);
  top.position.y = 0.225;
  g.add(top);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.33, 0.52, 4), shell);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(0, 0.02, -0.9);
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.1, 0.44, 4), shell);
  tail.rotation.x = -Math.PI / 2;
  tail.rotation.y = Math.PI / 4;
  tail.position.set(0, 0.02, 0.86);
  g.add(tail);
  const batt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.72), dark);
  batt.position.set(0, 0.36, 0.16);
  g.add(batt);

  const rotors = [];
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sz] of corners) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.075, 1.4), shell);
    arm.position.set(sx * 0.62, 0.05, sz * 0.56);
    arm.rotation.y = Math.atan2(sx, sz) + (sz < 0 ? Math.PI : 0);
    g.add(arm);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.165, 0.24, 14), dark);
    motor.position.set(sx * 1.1, 0.15, sz * 1.04);
    g.add(motor);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.135, 0.06, 14), metal);
    cap.position.set(sx * 1.1, 0.29, sz * 1.04);
    g.add(cap);

    const prop = new THREE.Group();
    prop.position.set(sx * 1.1, 0.34, sz * 1.04);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 0.012, 26),
      new THREE.MeshBasicMaterial({ color: 0xc7cede, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide })
    );
    prop.add(disc);
    const blade1 = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.016, 0.085), dark);
    prop.add(blade1);
    const blade2 = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.016, 0.085), dark);
    blade2.rotation.y = Math.PI / 2;
    prop.add(blade2);
    g.add(prop);
    rotors.push(prop);

    const ledCol = sz < 0 ? 0xff2626 : 0x2bff5a;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: ledCol }));
    led.position.set(sx * 1.1, 0.01, sz * 1.04);
    g.add(led);

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.52, 8), dark);
    leg.position.set(sx * 0.55, -0.33, sz * 0.35);
    g.add(leg);
  }

  const skidL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.1), dark);
  skidL.position.set(-0.55, -0.58, 0.05);
  g.add(skidL);
  const skidR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.1), dark);
  skidR.position.set(0.55, -0.58, 0.05);
  g.add(skidR);

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.15, 10), dark);
  mount.position.set(0, -0.21, -0.56);
  g.add(mount);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), shell);
  ball.position.set(0, -0.35, -0.56);
  g.add(ball);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12),
    new THREE.MeshPhongMaterial({ color: 0x080a0e, shininess: 210, specular: 0x8fe4ff })
  );
  lens.rotation.x = Math.PI / 2 - 0.55;
  lens.position.set(0, -0.4, -0.68);
  g.add(lens);

  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.set(0, 0.46, 0.52);
  g.add(strobe);

  g.userData.rotors = rotors;
  g.userData.strobe = strobe;
  return g;
}

export function buildMarker(colorHex, discRadius = 1.7, beamRadius = 0.22, beamHeight = 5.5) {
  const g = new THREE.Group();

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(discRadius * 2, discRadius * 2),
    new THREE.MeshBasicMaterial({
      map: radialGlowTexture(colorHex), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.06;
  g.add(disc);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(beamRadius, beamRadius * 1.25, beamHeight, 10, 1, true),
    new THREE.MeshBasicMaterial({
      map: beamTexture(colorHex), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  );
  beam.position.y = beamHeight / 2;
  g.add(beam);

  return g;
}
