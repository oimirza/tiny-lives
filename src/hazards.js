import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM, clamp, clampX, clampZ, rand, lerpAngle, compactModel } from './world.js';

// Two-bone leg IK: where the knee goes for a given hip and ankle (bends forward).
function solveKnee(hip, ankle, L1, L2, fwd) {
  const d = ankle.clone().sub(hip);
  const len0 = d.length() || 1;
  const dir = d.divideScalar(len0);
  const len = Math.min(len0, (L1 + L2) * 0.999);
  const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const bend = fwd.clone().addScaledVector(dir, -fwd.dot(dir));
  if (bend.lengthSq() < 1e-6) bend.set(0, 0, 1);
  bend.normalize();
  return hip.clone().addScaledVector(dir, a).addScaledVector(bend, h);
}
// Stretch a unit-height cylinder between two points.
function placeSeg(mesh, a, b) {
  const dir = b.clone().sub(a);
  const len = dir.length() || 0.001;
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len));
}
// Kain pelikat checks
function plaidTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3b2f6b';
  g.fillRect(0, 0, 128, 128);
  for (const [col, w, off] of [['rgba(200,40,60,0.75)', 18, 10], ['rgba(240,240,240,0.55)', 4, 40], ['rgba(30,110,80,0.7)', 12, 70], ['rgba(240,200,60,0.5)', 3, 100]]) {
    g.fillStyle = col;
    g.fillRect(off, 0, w, 128);
    g.fillRect(0, off, 128, w);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

const UP = new THREE.Vector3(0, 1, 0);
const M = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const shadowAll = (o) => o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
const angleDiff = (a, b) => ((((a - b + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function warningRing(color, inner, outer) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  m.renderOrder = 2;
  return m;
}

// Floor-projected vision cone so the player can read where things are looking.
function visionCone(range, fov, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false });
  const m = new THREE.Mesh(new THREE.CircleGeometry(range, 40, -Math.PI / 2 - fov / 2, fov), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  g.add(m);
  return { g, mat };
}

const iconCache = {};
function iconTexture(ch, bg) {
  const key = ch + bg;
  if (iconCache[key]) return iconCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 76px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (iconCache[key] = t);
}
function makeIcon() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture('?', '#d99a00'), depthTest: false, transparent: true }));
  s.scale.set(1.3, 1.3, 1);
  s.renderOrder = 10;
  s.visible = false;
  return s;
}
function setIcon(sprite, ch, bg, opacity = 1) {
  sprite.material.map = iconTexture(ch, bg);
  sprite.material.opacity = opacity;
  sprite.visible = true;
}

// Shared walking helper for the human and the cat.
function walkTo(self, x, z, speed, dt, arriveR, radius, height) {
  const dx = x - self.pos.x, dz = z - self.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < arriveR) {
    self.move += (0 - self.move) * (1 - Math.exp(-6 * dt));
    self.stuck = 0;
    return true;
  }
  self.facing = lerpAngle(self.facing, Math.atan2(dx, dz), 1 - Math.exp(-4 * dt));
  self.move += (1 - self.move) * (1 - Math.exp(-6 * dt));
  const sp = speed * self.move;
  const bx = self.pos.x, bz = self.pos.z;
  self.pos.x += Math.sin(self.facing) * sp * dt;
  self.pos.z += Math.cos(self.facing) * sp * dt;
  self.world.pushOut(self.pos, radius, height);
  self.phase += dt * sp * 1.9;
  const moved = Math.hypot(self.pos.x - bx, self.pos.z - bz);
  self.stuck = moved < sp * dt * 0.3 ? self.stuck + dt : 0;
  if (self.stuck > 1.2) { self.stuck = 0; return true; } // blocked: give up on this target
  return false;
}

// ================================================================ Human
const VISION_RANGE = 14;
const VISION_FOV = THREE.MathUtils.degToRad(100);
// Patrol route through the condo (kitchen + living room)
const WAYPOINTS = [[-20, -13], [-9, -12], [-21, 4], [-8, 5], [-15, 2], [0, 0], [4, -12], [16, -8], [22, 8], [6, 12], [18, 12]];

export class Person {
  constructor(scene, world, sfx) {
    this.world = world;
    this.sfx = sfx;
    // A Malaysian uncle at home: barefoot, kain pelikat (checked sarong) rolled up like shorts, t-shirt
    const skin = M(0xa86e45, 0.6), shirt = M(0x2f6f8f, 0.9), hair = M(0x141010, 0.75), white = M(0xf5f5f5, 0.3), dark = M(0x1a1210, 0.6);
    const kain = new THREE.MeshStandardMaterial({ map: plaidTexture(), roughness: 0.95 });
    const sph = (r, ws = 18, hs = 12) => new THREE.SphereGeometry(r, ws, hs);

    this.feet = [];
    this.thighs = [];
    this.shins = [];
    this.knees = [];
    for (let i = 0; i < 2; i++) {
      // Bare foot: rounded sole, heel, ankle bone and five toes (big toe on the inside)
      const g = new THREE.Group();
      const sole = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.45, 2.1, 3, 0.2), skin);
      sole.position.set(0, 0.24, 0.3);
      const heel = new THREE.Mesh(sph(0.5), skin);
      heel.scale.set(0.95, 0.75, 1);
      heel.position.set(0, 0.33, -0.55);
      const instep = new THREE.Mesh(sph(0.5), skin);
      instep.scale.set(0.9, 0.6, 1.3);
      instep.position.set(0, 0.5, 0.1);
      g.add(sole, heel, instep);
      const inner = i === 0 ? -1 : 1;
      const toeR = [0.21, 0.15, 0.14, 0.12, 0.11];
      toeR.forEach((r, t) => {
        const toe = new THREE.Mesh(sph(r, 10, 8), skin);
        toe.scale.set(1, 0.8, 1.15);
        toe.position.set(inner * (0.33 - t * 0.17), 0.17, 1.38 - Math.abs(t - 0.5) * 0.06 - t * 0.03);
        g.add(toe);
      });
      shadowAll(g);
      scene.add(g);
      this.feet.push({ g, override: null });
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.58, 1, 16), kain);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.36, 1, 14), skin);
      const knee = new THREE.Mesh(sph(0.52), skin);
      for (const m of [thigh, shin, knee]) { m.castShadow = true; scene.add(m); }
      this.thighs.push(thigh);
      this.shins.push(shin);
      this.knees.push(knee);
    }

    const u = (this.upper = new THREE.Group());
    const add = (geo, mat, x, y, z, parent = u) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    add(sph(1, 22, 14), kain, 0, 8.3, 0).scale.set(1.55, 0.95, 1.05); // hips
    add(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 22), kain, 0, 8.95, 0).scale.set(1, 1, 0.7); // rolled waist knot
    add(new THREE.CapsuleGeometry(1.25, 2.0, 6, 18), shirt, 0, 10.9, 0).scale.set(1.25, 1, 0.78); // chest
    add(sph(1, 20, 14), shirt, 0, 9.7, 0.25).scale.set(1.35, 1.1, 1.05); // a bit of a belly
    add(new THREE.CylinderGeometry(0.42, 0.5, 0.8, 12), skin, 0, 12.85, 0);
    // head
    const head = (this.head = new THREE.Group());
    head.position.set(0, 14.05, 0);
    u.add(head);
    add(sph(1, 24, 18), skin, 0, 0, 0, head).scale.set(0.86, 1.04, 0.95);
    const hairCap = add(new THREE.SphereGeometry(1.03, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.1, -0.06, head);
    hairCap.scale.set(0.88, 1.0, 0.98);
    hairCap.rotation.x = -0.25;
    for (const s of [-1, 1]) {
      add(sph(0.22, 10, 8), skin, 0.86 * s, -0.02, -0.05, head).scale.set(0.45, 1, 0.75); // ears
      add(sph(0.13, 10, 8), white, 0.31 * s, 0.12, 0.8, head); // eyes
      add(sph(0.07, 8, 6), dark, 0.31 * s, 0.12, 0.92, head);
      const brow = add(new THREE.BoxGeometry(0.34, 0.07, 0.08), hair, 0.31 * s, 0.33, 0.86, head);
      brow.rotation.z = -0.12 * s;
      this[s < 0 ? 'browL' : 'browR'] = brow;
      // closed eyelids (only while he sleeps)
      const lid = add(sph(0.16, 10, 8), skin, 0.31 * s, 0.13, 0.82, head);
      lid.scale.set(1, 0.9, 0.7);
      lid.visible = false;
      lid.userData.keep = true;
      (this.lids ||= []).push(lid);
    }
    const nose = add(new THREE.ConeGeometry(0.15, 0.4, 10), skin, 0, -0.08, 0.98, head);
    nose.rotation.x = Math.PI / 2 + 0.3;
    add(new THREE.BoxGeometry(0.55, 0.1, 0.12), hair, 0, -0.32, 0.9, head); // misai (mustache)
    this.mouth = add(new THREE.BoxGeometry(0.38, 0.06, 0.06), M(0x6b2a20, 0.6), 0, -0.48, 0.86, head);
    // arms with elbows
    this.arms = [];
    for (const s of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(1.75 * s, 12.2, 0);
      add(sph(0.6, 14, 10), shirt, 0, 0, 0, p);
      add(new THREE.CylinderGeometry(0.58, 0.5, 1.2, 12), shirt, 0, -0.55, 0, p);
      add(new THREE.CylinderGeometry(0.42, 0.37, 1.4, 12), skin, 0, -1.6, 0, p);
      const elbow = new THREE.Group();
      elbow.position.y = -2.3;
      p.add(elbow);
      add(sph(0.38, 10, 8), skin, 0, 0, 0, elbow);
      add(new THREE.CylinderGeometry(0.36, 0.3, 2.0, 12), skin, 0, -1.0, 0, elbow);
      add(new RoundedBoxGeometry(0.42, 0.75, 0.3, 2, 0.12), skin, 0, -2.25, 0, elbow);
      const thumb = add(new THREE.CapsuleGeometry(0.08, 0.25, 2, 6), skin, -0.22 * s, -2.1, 0.12, elbow);
      thumb.rotation.z = 0.5 * s;
      u.add(p);
      this.arms.push({ p, elbow, s });
    }
    // The selipar (flip-flop) he grabs when he's furious
    const slipper = (this.slipper = new THREE.Group());
    add(new RoundedBoxGeometry(0.95, 0.16, 2.4, 2, 0.06), M(0x2e6cd1, 0.6), 0, 0, 0, slipper);
    add(new RoundedBoxGeometry(0.97, 0.06, 2.42, 2, 0.03), M(0xffffff, 0.6), 0, 0.1, 0, slipper);
    add(new THREE.TorusGeometry(0.35, 0.06, 6, 14, Math.PI), M(0x2e6cd1, 0.6), 0, 0.15, 0.3, slipper).rotation.y = Math.PI / 2;
    slipper.position.set(0, -2.5, 0.9);
    slipper.rotation.x = Math.PI / 2;
    this.arms[0].elbow.add(slipper);
    this.slipper.visible = false;
    shadowAll(u);
    scene.add(u);
    // fewer draw calls: bake rigid parts of each body part together
    for (const m of [this.mouth, this.browL, this.browR]) m.userData.keep = true; // these animate on their own
    compactModel(u);
    for (const f of this.feet) compactModel(f.g);

    this.ring = warningRing(0xff2a2a, 1.0, 1.4);
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false })
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.visible = false;
    this.cone = visionCone(VISION_RANGE, VISION_FOV, 0xfff2a8);
    this.icon = makeIcon();
    scene.add(this.ring, this.disc, this.cone.g, this.icon);
    this.reset();
  }

  setTools(broom, spray) {
    this.broom = broom;
    this.spray = spray;
  }

  reset() {
    if (this.sleepSolids) for (const s of this.sleepSolids) this.world.removeSolid(s);
    this.sleepSolids = null;
    this.asleep = false;
    this.upper.rotation.set(0, 0, 0);
    this.upper.scale.set(1, 1, 1);
    for (const f of this.feet) f.g.rotation.set(0, 0, 0);
    for (const l of this.lids) l.visible = false;
    const ps = this.world.layout?.personStart || [0, 2];
    this.pos = new THREE.Vector3(ps[0], 0, ps[1]);
    this.facing = -Math.PI / 2;
    this.phase = 0;
    this.move = 0;
    this.state = 'patrol'; // patrol | investigate | search | alert | panic
    this.wp = 0;
    this.waitTimer = 2;
    this.suspicion = 0;
    this.seenNow = false;
    this.rage = false;
    this.poi = new THREE.Vector3();
    this.lastKnown = new THREE.Vector3();
    this.lostTimer = 0;
    this.searchTimer = 0;
    this.lookTimer = 0;
    this.panicTimer = 0;
    this.panicCool = 0;
    this.flee = new THREE.Vector3();
    this.stuck = 0;
    this.attack = null;
    this.attackCool = 0;
    this.t = 0;
    this.target = new THREE.Vector3();
    for (const f of this.feet) f.override = null;
    this.ring.visible = this.disc.visible = false;
    this.applyPose();
    this.updateVisuals();
  }

  fwd() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  side() { return new THREE.Vector3(Math.cos(this.facing), 0, -Math.sin(this.facing)); }

  footBase(i) {
    const ph = this.phase + i * Math.PI;
    const p = this.pos.clone()
      .addScaledVector(this.side(), i === 0 ? 0.85 : -0.85)
      .addScaledVector(this.fwd(), Math.sin(ph) * 0.9 * this.move);
    p.y = Math.max(0, Math.cos(ph)) * 0.6 * this.move;
    return p;
  }

  // Can the human see the roach right now? (eyes high up, so table tops block, sofa gaps hide you completely)
  canSee(roach, wide = false) {
    if (roach.dead || roach.inNest) return false;
    const dx = roach.pos.x - this.pos.x, dz = roach.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const alert = this.state === 'alert';
    if (dist > (alert ? 22 : VISION_RANGE)) return false;
    if (!wide && dist > 2.2) {
      const half = alert ? Math.PI * 0.8 : VISION_FOV / 2;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), this.facing)) > half) return false;
    }
    const eye = new THREE.Vector3(this.pos.x + Math.sin(this.facing) * 0.6, 14, this.pos.z + Math.cos(this.facing) * 0.6);
    return this.world.lineOfSight(eye, new THREE.Vector3(roach.pos.x, roach.pos.y + 0.12, roach.pos.z));
  }

  // ---------------------------------------------------------------- Asleep (night level)
  // He dozed off on a mat in front of the TV, head on a pillow by x=5.8, feet towards the TV.
  // You can climb over him... carefully. Crashes, scurrying near his head or a bug on him wake him up.
  goSleep() {
    this.asleep = true;
    this.sleepT = 0;
    this.disturb = 0;
    this.onHim = 0;
    this.state = 'patrol';
    this.suspicion = 0;
    this.sleepSolids = [
      { minX: 4.4, maxX: 7.0, minY: 0, maxY: 2.2, minZ: 9.4, maxZ: 11.6 }, // head
      { minX: 7.0, maxX: 13.2, minY: 0, maxY: 2.3, minZ: 8.8, maxZ: 12.2 }, // chest + belly
      { minX: 13.2, maxX: 20.2, minY: 0, maxY: 1.5, minZ: 9.0, maxZ: 12.0 }, // legs
    ];
    for (const s of this.sleepSolids) this.world.addSolid(s);
    for (const l of this.lids) l.visible = true;
    this.cone.g.visible = false;
    this.ring.visible = this.disc.visible = false;
    this.sleepPose();
  }

  sleepPose() {
    const headDir = new THREE.Vector3(-1, 0, 0), up = new THREE.Vector3(0, 1, 0);
    const X = new THREE.Vector3().crossVectors(headDir, up);
    const O = new THREE.Vector3(19.85, 1.1, 10.5);
    this.pos.set(O.x - 8, 0, O.z);
    this.upper.position.copy(O);
    this.upper.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, headDir, up));
    this.upper.scale.set(1, 1, 1 + Math.sin(this.sleepT * 1.4) * 0.035); // breathing
    const arm = this.arms[1];
    arm.p.rotation.set(-0.7, 0, 0);
    arm.elbow.rotation.set(-1.3, 0, 0); // hand resting on his belly
    this.arms[0].p.rotation.set(0, 0, 0.05);
    this.arms[0].elbow.rotation.set(-0.1, 0, 0);
    const footQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), up));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 0.78 : -0.78;
      const hip = new THREE.Vector3(O.x - 8, O.y, O.z).addScaledVector(X, side);
      const knee = hip.clone().add(new THREE.Vector3(3.55, 0.9 + i * 0.5, 0));
      const ankle = hip.clone().add(new THREE.Vector3(7.0, -0.35, 0));
      placeSeg(this.thighs[i], hip, knee);
      placeSeg(this.shins[i], knee, ankle);
      this.knees[i].position.copy(knee);
      const f = this.feet[i].g;
      f.quaternion.copy(footQ);
      f.position.set(ankle.x + 0.35, 0.75, ankle.z);
    }
    this.mouth.scale.y = 1.5 + Math.sin(this.sleepT * 1.4) * 0.8; // snoring
    this.browL.rotation.z = 0.12;
    this.browR.rotation.z = -0.12;
    this.slipper.visible = false;
    setIcon(this.icon, 'Zz', '#5b6cff', 0.6 + 0.4 * Math.sin(this.sleepT * 2));
    this.icon.position.set(5.8, 4.2 + Math.sin(this.sleepT) * 0.3, 10.5);
  }

  updateAsleep(dt, roach, game) {
    this.sleepT += dt;
    this.seenNow = false;
    if (!roach.dead && !roach.inNest) {
      const onTop = this.sleepSolids.some((s) => roach.pos.x > s.minX - 0.1 && roach.pos.x < s.maxX + 0.1 && roach.pos.z > s.minZ - 0.1 && roach.pos.z < s.maxZ + 0.1 && roach.pos.y > s.maxY - 0.35);
      const climbing = roach.climb && this.sleepSolids.includes(roach.climb.solid);
      this.onHim = onTop || climbing ? this.onHim + dt : Math.max(0, this.onHim - dt);
      const dHead = Math.hypot(roach.pos.x - 5.8, roach.pos.z - 10.5);
      if (roach.noise > 0.3 && dHead < 6) this.disturb += dt * roach.noise * 1.6;
      else this.disturb = Math.max(0, this.disturb - dt * 0.3);
      if (this.onHim > (dHead < 2.5 ? 0.25 : 0.9)) return this.wake(game, roach.pos, 'Something is crawling on him! HE WOKE UP!');
      if (this.disturb > 1) return this.wake(game, roach.pos, 'Too noisy! HE WOKE UP!');
    }
    this.sleepPose();
    if (Math.random() < dt * 0.5) this.sfx.snore?.();
  }

  wake(game, at, msg) {
    if (!this.asleep) return;
    this.asleep = false;
    for (const s of this.sleepSolids) this.world.removeSolid(s);
    this.sleepSolids = null;
    for (const l of this.lids) l.visible = false;
    this.upper.rotation.set(0, 0, 0);
    this.upper.scale.set(1, 1, 1);
    for (const f of this.feet) f.g.rotation.set(0, 0, 0);
    // he sits up and gets off the mat
    this.pos.set(10, 0, 14.8);
    this.world.pushOut(this.pos, 1.5, 14);
    this.facing = Math.atan2(at.x - this.pos.x, at.z - this.pos.z);
    this.cone.g.visible = true;
    this.suspicion = 0.6;
    this.poi.set(at.x, 0, at.z);
    this.state = 'investigate';
    this.lookTimer = 6;
    this.sfx.suspicious();
    game?.shake(0.15);
    game?.warn(msg);
  }

  // Something (the cat, a noise) points the human at a spot.
  hear(pos, amount) {
    if (this.asleep) { if (amount >= 0.5) this.wake(this.game, pos, 'CRASH! The noise woke him up!'); return; }
    if (this.state === 'alert' || this.state === 'panic') return;
    this.suspicion = Math.min(0.95, Math.max(this.suspicion, 0.35) + amount);
    this.poi.set(pos.x, 0, pos.z);
    if (this.state === 'search') {
      // the cat / a crash points him to a new spot: keep searching there
      this.lastKnown.set(pos.x, 0, pos.z);
      this.searchPoint = this.lastKnown.clone();
      this.searchTimer = Math.max(this.searchTimer, 12);
    }
    if (this.state !== 'search') {
      this.state = 'investigate';
      this.lookTimer = 5;
      this.sfx.suspicious();
    }
  }

  update(dt, roach, game) {
    this.game = game;
    if (this.asleep) return this.updateAsleep(dt, roach, game);
    this.t += dt;
    this.attackCool -= dt;
    this.panicCool -= dt;
    this.shockT = Math.max(0, (this.shockT || 0) - dt);
    if (this.attack) {
      this.updateAttack(dt, roach, game);
    } else if (!this.checkFear(roach, game)) {
      if (this.state !== 'alert' && this.state !== 'panic') {
        this.seenNow = this.canSee(roach);
        this.perceive(dt, roach, game);
      }
      if (this.state === 'patrol') this.patrol(dt);
      else if (this.state === 'investigate') this.investigate(dt);
      else if (this.state === 'search') this.search(dt, game);
      else if (this.state === 'alert') this.chase(dt, roach, game);
      else if (this.state === 'panic') this.panic(dt, roach, game);
    }
    this.applyPose();
    this.updateVisuals();
  }

  // A flying cockroach near his face = instant panic.
  checkFear(roach, game) {
    if (roach.dead || this.panicCool > 0 || this.state === 'panic') return false;
    const d = hdist(roach.pos, this.pos);
    if (!roach.onGround && roach.open > 0.5 && roach.pos.y > 0.8 && d < 5.5 && (d < 3 || this.canSee(roach, true))) {
      if (this.state !== 'alert') game.spot();
      this.state = 'panic';
      this.panicTimer = 2.6;
      this.panicCool = 5;
      this.rage = true;
      this.suspicion = 1;
      this.lastKnown.copy(roach.pos);
      this.move = 0;
      this.sfx.scream();
      game.warn('AAAAH! He ran away!');
      return true;
    }
    // A cockroach scuttling right by his bare feet: he jumps in shock, hops back, then hunts it
    if (roach.onGround && roach.pos.y < 0.5 && !roach.inNest && !this.attack) {
      const nearFoot = this.feet.some((f) => Math.hypot(roach.pos.x - f.g.position.x, roach.pos.z - f.g.position.z) < 2.3);
      if (nearFoot && (roach.speed > 0.4 || d < 2.5)) {
        if (this.state !== 'alert') game.spot();
        this.state = 'panic';
        this.panicTimer = 1.3; // short startle, then he comes after you
        this.panicCool = 6;
        this.shockT = 0.5; // little jump
        this.suspicion = 1;
        this.lastKnown.copy(roach.pos);
        this.move = 0;
        this.sfx.scream('eek');
        game.warn('EEK! Something touched his feet!');
        return true;
      }
    }
    return false;
  }

  perceive(dt, roach, game) {
    const dist = hdist(roach.pos, this.pos);
    if (this.seenNow) {
      const v = roach.eating ? 1.4 : roach.speed > 5 ? 1.5 : roach.speed > 0.4 ? 1.0 : 0.35;
      const df = clamp(1.5 - dist / VISION_RANGE, 0.3, 1.5);
      const k = this.state === 'patrol' ? 0.7 : 1.3;
      this.suspicion += dt * k * v * df * (this.sense || 1); // level difficulty: how sharp his eyes are
      this.poi.set(roach.pos.x, 0, roach.pos.z);
      if (this.state === 'search') this.lastKnown.set(roach.pos.x, 0, roach.pos.z);
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * (this.state === 'search' ? 0.05 : 0.15));
    }
    // Hearing: flying, scurrying and munching make noise
    if (!roach.dead && roach.noise > 0 && dist < roach.noise * 10 && this.suspicion < 0.8) {
      this.suspicion += dt * 0.3 * roach.noise;
      if (this.state !== 'search') this.poi.set(roach.pos.x, 0, roach.pos.z);
    }
    if (this.state === 'patrol' && this.suspicion > 0.3) {
      this.state = 'investigate';
      this.lookTimer = 3.5;
      this.sfx.suspicious();
    }
    if (this.suspicion >= 1 && !roach.dead) {
      this.suspicion = 1;
      this.state = 'alert';
      this.lastKnown.copy(roach.pos);
      this.lostTimer = 0;
      this.attackCool = 0.6;
      game.spot();
      this.sfx.alert();
      game.warn('SPOTTED!');
    }
  }

  route() { return this.world.layout?.waypoints || WAYPOINTS; }
  walk(x, z, speed, dt, arriveR) { return walkTo(this, x, z, speed * (this.speedMul || 1), dt, arriveR, 1.5, 14); }
  idle(dt) { this.move += (0 - this.move) * (1 - Math.exp(-6 * dt)); }

  patrol(dt) {
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      this.idle(dt);
      this.facing += Math.sin(this.t * 0.9) * dt * 0.8;
      if (this.waitTimer <= 0) this.wp = (this.wp + 1 + Math.floor(Math.random() * 2)) % this.route().length;
      return;
    }
    const [x, z] = this.route()[this.wp % this.route().length];
    if (this.walk(x, z, 2.0, dt, 1.0)) this.waitTimer = rand(2, 4.5);
  }

  investigate(dt) {
    if (this.walk(this.poi.x, this.poi.z, 2.6, dt, 2.5)) {
      this.lookTimer -= dt;
      this.idle(dt);
      this.facing += Math.sin(this.t * 2) * dt * 1.6;
      if (this.lookTimer <= 0) { this.state = 'patrol'; this.waitTimer = 0.5; }
    }
  }

  search(dt, game) {
    // Sweep the area around where he last saw you, checking spot after spot
    if (!this.searchPoint) this.searchPoint = this.lastKnown.clone();
    if (this.walk(this.searchPoint.x, this.searchPoint.z, this.rage ? 4.2 : 3.4, dt, 1.8)) {
      this.idle(dt);
      this.facing += dt * 1.6 * Math.sign(Math.sin(this.t * 0.6) || 1);
      this.searchWait = (this.searchWait ?? 2) - dt;
      if (this.searchWait <= 0) {
        const a = Math.random() * Math.PI * 2, r = rand(2, 7);
        this.searchPoint.set(clampX(this.lastKnown.x + Math.sin(a) * r, 2.5), 0, clampZ(this.lastKnown.z + Math.cos(a) * r, 2.5));
        this.searchWait = rand(1.5, 3);
      }
    }
    this.searchTimer -= dt;
    if (this.searchTimer <= 0) {
      this.state = 'patrol';
      this.rage = false;
      this.suspicion = Math.min(this.suspicion, 0.25);
      this.waitTimer = 1;
      game.warn('He gave up looking.');
    }
  }

  panic(dt, roach, game) {
    // run away from the bug, arms flailing
    const away = new THREE.Vector3(this.pos.x - roach.pos.x, 0, this.pos.z - roach.pos.z);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize();
    this.flee.set(clampX(this.pos.x + away.x * 8, 3), 0, clampZ(this.pos.z + away.z * 8, 3));
    this.walk(this.flee.x, this.flee.z, 5.5, dt, 0.5);
    this.panicTimer -= dt;
    if (this.panicTimer <= 0) {
      this.state = 'alert';
      this.lastKnown.copy(roach.pos);
      this.lostTimer = 0;
      this.attackCool = 0.8;
      this.sfx.alert();
      game.warn("Now he's FURIOUS... and he has a slipper!");
    }
  }

  chase(dt, roach, game) {
    const diff = game.difficulty;
    if (roach.dead) { this.state = 'patrol'; this.rage = false; this.suspicion = 0; return; }
    this.seenNow = this.canSee(roach);
    if (this.seenNow) { this.lastKnown.copy(roach.pos); this.lostTimer = 0; }
    else this.lostTimer += dt;
    if (this.lostTimer > (this.rage ? 5 : 3.5)) {
      this.state = 'search';
      this.searchPoint = this.lastKnown.clone();
      this.searchWait = 2;
      this.searchTimer = this.rage ? 26 : 18;
      this.suspicion = 0.7;
      this.sfx.lost();
      game.warn('He lost you. Stay hidden!');
      return;
    }
    const speed = 3.4 + 1.2 * diff + (this.rage ? 1.5 : 0);
    this.walk(this.lastKnown.x, this.lastKnown.z, speed, dt, 3.0);
    if (this.seenNow && this.attackCool <= 0) {
      const rd = hdist(roach.pos, this.pos);
      const top = this.world.groundAt(roach.pos.x, roach.pos.z, 1000);
      const k = this.rage ? 0.6 : 1;
      if (rd < 6.5 && top < 4.6) this.beginStomp(roach, game);
      else if (roach.pos.y < 0.5 && rd < 14 && this.broom.state === 'idle') { this.broom.trigger(roach, game); this.attackCool = 2.5 * k; }
      else if (this.spray.state === 'idle' && this.spray.cloudLife > 5) { this.spray.trigger(roach, game); this.attackCool = 3 * k; }
    }
  }

  beginStomp(roach, game) {
    const lead = roach.pos.clone().addScaledVector(roach.vel, 0.3);
    lead.x = clampX(lead.x, 1);
    lead.z = clampZ(lead.z, 1);
    lead.y = this.world.groundAt(lead.x, lead.z, 1000);
    if (lead.y > 4.6) { this.attackCool = 0.5; return; }
    this.target = lead;
    this.facing = Math.atan2(lead.x - this.pos.x, lead.z - this.pos.z);
    this.targetFoot = lead.clone().addScaledVector(this.fwd(), -0.35);
    const toT = new THREE.Vector3(lead.x - this.pos.x, 0, lead.z - this.pos.z);
    const d = toT.length();
    this.lungeFrom = this.pos.clone();
    this.lungeTo = d > 1.6 ? this.pos.clone().addScaledVector(toT.normalize(), d - 1.6) : this.pos.clone();
    const d0 = this.footBase(0).distanceTo(lead), d1 = this.footBase(1).distanceTo(lead);
    this.foot = d0 < d1 ? 0 : 1;
    this.from = this.footBase(this.foot);
    this.feet[this.foot].override = this.from.clone();
    this.move = 0;
    this.attack = 'windup';
    this.at = 0;
    this.ring.position.set(lead.x, lead.y + 0.03, lead.z);
    this.disc.position.set(lead.x, lead.y + 0.02, lead.z);
    this.ring.visible = this.disc.visible = true;
    game.warn('STOMP!');
    this.sfx.warn();
  }

  updateAttack(dt, roach, game) {
    const diff = game.difficulty;
    this.at += dt;
    const f = this.feet[this.foot];
    if (this.attack === 'windup') {
      const T = (this.rage ? 0.5 : 0.62) - 0.15 * diff;
      const e = easeOut(Math.min(1, this.at / T));
      this.pos.lerpVectors(this.lungeFrom, this.lungeTo, e);
      this.world.pushOut(this.pos, 1.5, 14);
      const above = this.targetFoot.clone();
      above.y += 3.6;
      f.override.lerpVectors(this.from, above, e);
      this.disc.material.opacity = 0.15 + 0.35 * e;
      this.ring.scale.setScalar(1 + Math.sin(this.at * 30) * 0.08);
      if (this.at >= T) { this.attack = 'slam'; this.at = 0; this.from = f.override.clone(); }
    } else if (this.attack === 'slam') {
      const e = Math.min(1, this.at / 0.09);
      f.override.lerpVectors(this.from, this.targetFoot, e * e);
      if (e >= 1) this.impact(roach, game);
    } else if (this.attack === 'recover') {
      if (this.at > 0.35) {
        const e = Math.min(1, (this.at - 0.35) / 0.4);
        f.override.lerpVectors(this.targetFoot, this.footBase(this.foot), e);
        f.override.y += Math.sin(e * Math.PI) * 0.8;
      }
      if (this.at > 0.75) {
        f.override = null;
        this.attack = null;
        this.attackCool = (this.rage ? 0.8 : 1.4) - 0.5 * diff + Math.random() * 0.8;
      }
    }
  }

  impact(roach, game) {
    this.attack = 'recover';
    this.at = 0;
    this.ring.visible = this.disc.visible = false;
    game.shake(0.45);
    this.sfx.thud();
    if (roach.dead) return;
    const dx = roach.pos.x - this.target.x, dz = roach.pos.z - this.target.z;
    const dy = roach.pos.y - this.target.y;
    const c = Math.cos(this.facing), s = Math.sin(this.facing);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < 0.75 && Math.abs(lz) < 1.45 && dy > -0.3 && dy < 0.7) {
      game.damage(100, 'Squashed by a giant foot', { squash: true });
    } else {
      const d = Math.hypot(dx, dz);
      if (d < 2.8 && Math.abs(dy) < 0.6 && roach.onGround) {
        roach.vy = 3.5;
        roach.onGround = false;
        roach.vel.x += (dx / (d || 1)) * 4;
        roach.vel.z += (dz / (d || 1)) * 4;
      }
    }
  }

  applyPose() {
    const fwd = this.fwd(), side = this.side();
    // startled hop when something runs over his feet
    const jump = this.shockT > 0 ? Math.sin((1 - this.shockT / 0.5) * Math.PI) * 1.4 : 0;
    const bob = Math.abs(Math.sin(this.phase)) * 0.15 * this.move + jump;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const p = (f.override ? f.override : this.footBase(i)).clone();
      p.y += jump;
      f.g.position.copy(p);
      f.g.rotation.y = this.facing;
      // tip the foot down while it's lifted (toes point down when stomping)
      f.g.rotation.x = f.override && this.attack === 'windup' ? 0.35 : Math.max(0, p.y) * -0.25;
      const hip = this.pos.clone().addScaledVector(side, i === 0 ? 0.78 : -0.78);
      hip.y = 8.0 + bob;
      const ankle = p.clone().addScaledVector(fwd, -0.45);
      ankle.y += 0.7;
      const knee = solveKnee(hip, ankle, 3.75, 3.55, fwd);
      placeSeg(this.thighs[i], hip, knee);
      placeSeg(this.shins[i], knee, ankle);
      this.knees[i].position.copy(knee);
    }
    this.upper.position.set(this.pos.x, bob, this.pos.z);
    this.upper.rotation.y = this.facing;
    this.upper.rotation.x = this.attack === 'windup' ? 0.12 : 0; // lean into the stomp
    for (const a of this.arms) {
      if (this.state === 'panic') {
        a.p.rotation.x = -2.7 + Math.sin(this.t * 22 + a.s) * 0.35; // arms up, flailing
        a.p.rotation.z = 0.4 * a.s;
        a.elbow.rotation.x = -0.6 + Math.sin(this.t * 25) * 0.3;
      } else if (this.rage && a === this.arms[0]) {
        a.p.rotation.x = -2.0 + Math.sin(this.t * 3) * 0.1; // selipar raised, ready to whack
        a.p.rotation.z = 0;
        a.elbow.rotation.x = -1.3;
      } else {
        a.p.rotation.x = Math.sin(this.phase + (a.s > 0 ? Math.PI : 0)) * 0.35 * this.move;
        a.p.rotation.z = 0.08 * a.s;
        a.elbow.rotation.x = -0.2 - 0.25 * this.move;
      }
    }
    // face: brows down when angry, mouth open when panicking
    const angry = this.rage && this.state !== 'panic';
    this.browL.rotation.z = angry ? -0.45 : 0.12;
    this.browR.rotation.z = angry ? 0.45 : -0.12;
    this.mouth.scale.y = this.state === 'panic' ? 4 : 1;
    this.slipper.visible = this.rage;
  }

  // Solid parts the roach bumps into: feet (toes + heel) and lower legs.
  colliders(out) {
    if (this.asleep) return; // lying down: his body is world solids instead
    const fwd = this.fwd();
    for (const f of this.feet) {
      const p = f.g.position;
      out.push({ x: p.x + fwd.x * 0.9, z: p.z + fwd.z * 0.9, r: 0.55, y0: p.y, y1: p.y + 0.8 });
      out.push({ x: p.x - fwd.x * 0.35, z: p.z - fwd.z * 0.35, r: 0.55, y0: p.y, y1: p.y + 0.9 });
    }
    for (const s of this.shins) out.push({ x: s.position.x, z: s.position.z, r: 0.5, y0: s.position.y - 1.2, y1: s.position.y + 1.6 });
    for (let i = 0; i < 2; i++) {
      // knee + thigh
      const k = this.knees[i].position, t = this.thighs[i].position;
      out.push({ x: k.x, z: k.z, r: 0.55, y0: k.y - 0.6, y1: k.y + 0.6 });
      out.push({ x: t.x, z: t.z, r: 0.75, y0: t.y - 1.6, y1: t.y + 1.8 });
    }
    // hips, belly, chest and head
    out.push({ x: this.pos.x, z: this.pos.z, r: 1.7, y0: 7.4, y1: 13.0 });
    out.push({ x: this.pos.x, z: this.pos.z, r: 1.0, y0: 13.0, y1: 15.3 });
  }

  updateVisuals() {
    const colors = { patrol: 0xfff2a8, investigate: 0xffb347, search: 0xff8c3a, alert: 0xff3b3b, panic: 0xb38cff };
    this.cone.mat.color.setHex(colors[this.state]);
    this.cone.mat.opacity = this.state === 'patrol' ? 0.07 : 0.13;
    this.cone.g.position.set(this.pos.x, 0.03, this.pos.z);
    this.cone.g.rotation.y = this.facing;
    this.icon.position.set(this.pos.x, 15.5, this.pos.z);
    if (this.state === 'panic') setIcon(this.icon, '!?', '#8a5cff');
    else if (this.state === 'alert') setIcon(this.icon, this.rage ? '!!' : '!', '#e02424');
    else if (this.suspicion > 0.03) setIcon(this.icon, '?', '#d99a00', 0.4 + 0.6 * this.suspicion);
    else this.icon.visible = false;
  }
}

// Shared helpers (used by cat.js)
export { walkTo, visionCone, makeIcon, setIcon, warningRing, M, shadowAll, angleDiff, hdist };

// ================================================================ Broom (the human's weapon)
export class Broom {
  constructor(scene, world, sfx) {
    this.world = world;
    this.sfx = sfx;
    // Penyapu lidi: a bundle of thin coconut-leaf ribs fanning out from a tied grip, swept along the floor
    this.g = new THREE.Group();
    const lidi = M(0xb08a4a, 0.8), dark = M(0x7a5a2a, 0.8);
    const tie = new THREE.Vector3(0, 4.2, -2.6); // where the sticks are bound together (held up and behind)
    const UPV = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 46; i++) {
      const tip = new THREE.Vector3(rand(-1.7, 1.7), rand(0.02, 0.12), rand(-0.25, 0.3));
      const top = tie.clone().add(new THREE.Vector3(rand(-0.15, 0.15), rand(0.0, 2.2), rand(-0.15, 0.15)).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.55));
      const dir = top.clone().sub(tip);
      const len = dir.length();
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, len, 4), i % 3 ? lidi : dark);
      s.position.copy(tip).addScaledVector(dir, 0.5);
      s.quaternion.setFromUnitVectors(UPV, dir.normalize());
      this.g.add(s);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12), M(0xc0392b, 0.6));
    band.position.copy(tie).add(new THREE.Vector3(0, 0.25, -0.15));
    band.rotation.x = -0.55;
    this.g.add(band);
    shadowAll(this.g);
    compactModel(this.g);
    this.g.visible = false;

    this.stripG = new THREE.Group();
    this.strip = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, depthWrite: false })
    );
    this.strip.rotation.x = -Math.PI / 2;
    this.stripG.add(this.strip);
    this.stripG.visible = false;
    scene.add(this.g, this.stripG);
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.t = 0;
    this.g.visible = this.stripG.visible = false;
  }

  trigger(roach, game) { if (this.state === 'idle') this.start(roach, game); }

  update(dt, roach, game) {
    const diff = game.difficulty;
    this.t += dt;
    if (this.state === 'warn') {
      const T = 0.95 - 0.3 * diff;
      const e = Math.min(1, this.t / T);
      this.g.position.copy(this.from);
      this.g.position.y = 3 * (1 - easeOut(e));
      this.strip.material.opacity = 0.18 + 0.15 * Math.sin(this.t * 25);
      if (this.t >= T) { this.state = 'sweep'; this.t = 0; this.hit = false; this.sfx.swish(); }
    } else if (this.state === 'sweep') {
      const dur = this.len / (20 + 8 * diff);
      const e = Math.min(1, this.t / dur);
      this.g.position.lerpVectors(this.from, this.to, e);
      this.g.position.y = 0;
      if (!this.hit && !roach.dead) {
        const rx = roach.pos.x - this.g.position.x, rz = roach.pos.z - this.g.position.z;
        const along = rx * this.dx + rz * this.dz;
        const across = rx * this.dz - rz * this.dx;
        if (Math.abs(along) < 0.6 && Math.abs(across) < 1.8 && roach.pos.y < 0.8 &&
            !this.world.coverAbove(roach.pos.x, roach.pos.z, roach.pos.y)) {
          this.hit = true;
          game.damage(34, 'Swept away by a broom', { kx: this.dx * 14, kz: this.dz * 14, ky: 6 });
        }
      }
      if (e >= 1) { this.state = 'leave'; this.t = 0; this.stripG.visible = false; }
    } else if (this.state === 'leave') {
      this.g.position.y += dt * 10;
      if (this.t > 0.7) { this.g.visible = false; this.state = 'idle'; }
    }
  }

  start(roach, game) {
    const a = Math.random() * Math.PI * 2;
    this.dx = Math.sin(a);
    this.dz = Math.cos(a);
    const c = roach.pos;
    this.from = new THREE.Vector3(clampX(c.x - this.dx * 11, 1.5), 0, clampZ(c.z - this.dz * 11, 1.5));
    this.to = new THREE.Vector3(clampX(c.x + this.dx * 11, 1.5), 0, clampZ(c.z + this.dz * 11, 1.5));
    this.len = this.from.distanceTo(this.to);
    if (this.len < 4) return;
    const heading = Math.atan2(this.dx, this.dz);
    this.g.rotation.y = heading;
    this.g.position.copy(this.from);
    this.g.visible = true;
    this.stripG.position.lerpVectors(this.from, this.to, 0.5);
    this.stripG.position.y = 0.02;
    this.stripG.rotation.y = heading;
    this.strip.scale.y = this.len;
    this.stripG.visible = true;
    this.state = 'warn';
    this.t = 0;
    game.warn('BROOM!');
    this.sfx.warn();
  }
}

// ================================================================ Bug spray (the human's weapon)
export class Spray {
  constructor(scene, world, sfx) {
    this.world = world;
    this.sfx = sfx;
    const red = M(0xd62f2f, 0.3, 0.5);
    this.can = new THREE.Group();
    this.can.rotation.order = 'YXZ';
    const add = (geo, mat, y, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(0, y, z); this.can.add(m); return m; };
    add(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 20), red, 1.1);
    add(new THREE.CylinderGeometry(0.565, 0.565, 0.8, 20), M(0xffd400, 0.5), 1.0);
    add(new THREE.SphereGeometry(0.55, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), red, 2.2).scale.y = 0.5;
    add(new THREE.CylinderGeometry(0.22, 0.25, 0.35, 12), M(0xffffff, 0.4), 2.55);
    add(new THREE.BoxGeometry(0.12, 0.12, 0.25), M(0x111111), 2.62, 0.2);
    this.nozzle = new THREE.Vector3(0, 2.62, 0.35);
    shadowAll(this.can);
    compactModel(this.can);
    this.can.visible = false;

    this.cloud = new THREE.Group();
    this.puffMat = new THREE.MeshBasicMaterial({ color: 0xa8e063, transparent: true, opacity: 0.25, depthWrite: false });
    this.puffs = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), this.puffMat);
      const off = new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.1, 0.6));
      m.userData = { off, s: rand(0.45, 0.8), ph: rand(0, 6) };
      this.cloud.add(m);
      this.puffs.push(m);
    }
    this.cloud.visible = false;

    this.stream = new THREE.Group();
    const pm = new THREE.MeshBasicMaterial({ color: 0xc8f28c, transparent: true, opacity: 0.6, depthWrite: false });
    this.particles = [];
    for (let i = 0; i < 40; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), pm);
      p.userData.j = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1));
      this.stream.add(p);
      this.particles.push(p);
    }
    this.stream.visible = false;

    this.ring = warningRing(0x7cff4a, 1.8, 2.2);
    scene.add(this.can, this.cloud, this.stream, this.ring);
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.t = 0;
    this.cloudLife = 99;
    this.can.visible = this.cloud.visible = this.stream.visible = this.ring.visible = false;
  }

  trigger(roach, game) { if (this.state === 'idle') this.start(roach, game); }

  update(dt, roach, game) {
    const diff = game.difficulty;
    this.t += dt;
    if (this.state === 'aim') {
      const T = 1.15 - 0.3 * diff;
      this.target.lerp(roach.pos, 1 - Math.exp(-3 * dt));
      this.ring.position.set(this.target.x, this.target.y + 0.03, this.target.z);
      this.ring.scale.setScalar(1 + Math.sin(this.t * 25) * 0.06);
      this.aimCan(Math.sin(this.t * 40) * 0.06);
      if (this.t >= T) {
        this.state = 'spray';
        this.t = 0;
        this.ring.visible = false;
        this.cloudLife = 0;
        this.cloudCenter = this.target.clone();
        this.cloudCenter.y += 0.5;
        this.cloud.position.copy(this.cloudCenter);
        this.cloud.visible = this.stream.visible = true;
        this.sfx.hiss(1.4);
      }
    } else if (this.state === 'spray') {
      this.aimCan(0);
      this.can.updateMatrixWorld();
      const n = this.can.localToWorld(this.nozzle.clone());
      this.particles.forEach((p, i) => {
        const k = (this.t * 2.2 + i / this.particles.length) % 1;
        p.position.lerpVectors(n, this.cloudCenter, k).addScaledVector(p.userData.j, k * 0.6);
      });
      if (this.t > 1.3) { this.state = 'leave'; this.t = 0; this.stream.visible = false; }
    } else if (this.state === 'leave') {
      this.can.position.y += dt * 6;
      if (this.t > 0.8) { this.can.visible = false; this.state = 'idle'; }
    }

    if (this.cloudLife < 6.5) {
      this.cloudLife += dt;
      const r = 0.4 + 2.4 * Math.min(1, this.cloudLife / 1.0) + this.cloudLife * 0.12;
      const fade = this.cloudLife > 4.5 ? Math.max(0, 1 - (this.cloudLife - 4.5) / 2) : 1;
      this.puffMat.opacity = 0.28 * fade;
      for (const p of this.puffs) {
        const u = p.userData;
        p.position.copy(u.off).multiplyScalar(r);
        p.position.y += Math.sin(this.cloudLife * 1.5 + u.ph) * 0.15;
        p.scale.setScalar(r * u.s * (1 + Math.sin(this.cloudLife * 2 + u.ph) * 0.08));
      }
      if (fade > 0.3 && !roach.dead) {
        const d = Math.hypot(roach.pos.x - this.cloudCenter.x, roach.pos.y + 0.1 - this.cloudCenter.y, roach.pos.z - this.cloudCenter.z);
        if (d < r * 0.85) {
          if (roach.high < 0.5) game.warn('Whoa... the spray is kicking in...');
          roach.high = Math.min(9, roach.high + 3 * dt); // get high: slow, wobbly, trippy screen
          game.damage(18 * dt, 'Choked on bug spray', { dot: true });
        }
      }
      if (this.cloudLife >= 6.5) this.cloud.visible = false;
    }
  }

  aimCan(wobble) {
    const dx = this.target.x - this.can.position.x, dz = this.target.z - this.can.position.z;
    this.can.rotation.y = Math.atan2(dx, dz);
    this.can.rotation.x = 0.6;
    this.can.rotation.z = wobble;
  }

  start(roach, game) {
    const a = Math.random() * Math.PI * 2;
    this.can.position.set(
      clampX(roach.pos.x + Math.sin(a) * 4.5, 1.5),
      Math.min(roach.pos.y + 3.2, ROOM.height - 4),
      clampZ(roach.pos.z + Math.cos(a) * 4.5, 1.5)
    );
    this.target = roach.pos.clone();
    this.can.visible = true;
    this.ring.visible = true;
    this.state = 'aim';
    this.t = 0;
    game.warn('SPRAY!');
    this.sfx.warn();
  }
}

// ================================================================ Toy car (patrols; chases only if its headlights catch you)
const CAR_RANGE = 7;
const CAR_FOV = THREE.MathUtils.degToRad(70);

export class Car {
  constructor(scene, world, sfx) {
    this.world = world;
    this.sfx = sfx;
    this.g = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.g.add(m); return m; };
    // Car body: a side profile extruded across the width (length runs along z)
    const profile = (pts) => {
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      return s;
    };
    const extrude = (shape, width, bevel) => {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
      geo.translate(0, 0, -width / 2);
      geo.rotateY(-Math.PI / 2);
      return geo;
    };
    const body = new THREE.Shape();
    body.moveTo(-1.0, 0.28);
    body.lineTo(0.98, 0.28);
    body.quadraticCurveTo(1.08, 0.3, 1.06, 0.48);
    body.quadraticCurveTo(1.0, 0.62, 0.55, 0.64);
    body.lineTo(0.25, 0.92);
    body.quadraticCurveTo(0.0, 0.98, -0.4, 0.94);
    body.lineTo(-0.72, 0.66);
    body.lineTo(-1.0, 0.62);
    body.lineTo(-1.0, 0.28);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xd62828, roughness: 0.25, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    add(extrude(body, 0.95, 0.06), paint, 0, 0, 0);
    // windows (slightly wider so they show on both sides)
    add(extrude(profile([[0.48, 0.64], [0.22, 0.9], [-0.38, 0.9], [-0.66, 0.66]]), 1.02, 0.02), M(0x0e1621, 0.1, 0.6), 0, 0.005, 0);
    // spoiler, bumpers, antenna
    add(new RoundedBoxGeometry(1.15, 0.06, 0.32, 2, 0.02), M(0x111111, 0.4), 0, 0.98, -0.92);
    for (const x of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.05, 0.3, 0.05), M(0x111111), x, 0.8, -0.92);
    add(new RoundedBoxGeometry(1.08, 0.14, 0.12, 2, 0.05), M(0x222222, 0.6), 0, 0.3, 1.1);
    add(new RoundedBoxGeometry(1.08, 0.14, 0.12, 2, 0.05), M(0x222222, 0.6), 0, 0.3, -1.08);
    add(new THREE.CylinderGeometry(0.015, 0.015, 1.0, 4), M(0x111111), 0.38, 1.2, -0.7);
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffee88, emissiveIntensity: 1.5 });
    const tail = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xaa0000, emissiveIntensity: 1 });
    for (const x of [-0.32, 0.32]) {
      add(new THREE.SphereGeometry(0.09, 10, 8), lamp, x, 0.5, 1.07);
      add(new RoundedBoxGeometry(0.22, 0.08, 0.04, 1, 0.02), tail, x, 0.52, -1.03);
    }
    // wheels: tire + rim
    this.wheels = [];
    for (const x of [-0.55, 0.55]) for (const z of [-0.62, 0.62]) {
      const w = new THREE.Group();
      w.position.set(x, 0.3, z);
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.1, 10, 20), M(0x151515, 0.95));
      tire.rotation.y = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 12), M(0xcfd2d6, 0.25, 0.9));
      rim.rotation.z = Math.PI / 2;
      w.add(tire, rim);
      this.g.add(w);
      this.wheels.push(w);
    }
    shadowAll(this.g);
    compactModel(this.g);
    this.cone = visionCone(CAR_RANGE, CAR_FOV, 0xaee7ff);
    scene.add(this.g, this.cone.g);
    this.reset();
  }

  reset() {
    this.pos = new THREE.Vector3(0, 0, 8);
    this.heading = Math.PI / 2;
    this.speed = 0;
    this.stuck = 0;
    this.cool = 0;
    this.state = 'patrol';
    this.chaseTimer = 0;
    this.seenNow = false;
    this.waypoint = new THREE.Vector3(-10, 0, 8);
    this.g.position.copy(this.pos);
  }

  colliders(out) {
    if (this.enabled === false) return;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const k of [-0.55, 0.55]) out.push({ x: this.pos.x + fx * k, z: this.pos.z + fz * k, r: 0.62, y0: 0, y1: 1.0 });
  }

  canSee(roach) {
    if (roach.dead || roach.inNest || roach.pos.y > 0.6) return false;
    const dx = roach.pos.x - this.pos.x, dz = roach.pos.z - this.pos.z;
    if (Math.hypot(dx, dz) > CAR_RANGE) return false;
    if (Math.abs(angleDiff(Math.atan2(dx, dz), this.heading)) > CAR_FOV / 2) return false;
    return this.world.lineOfSight(new THREE.Vector3(this.pos.x, 0.6, this.pos.z), new THREE.Vector3(roach.pos.x, roach.pos.y + 0.1, roach.pos.z));
  }

  pickWaypoint() {
    const rp = () => new THREE.Vector3(rand(-ROOM.hx + 2, ROOM.hx - 2), 0, rand(-ROOM.hz + 2, ROOM.hz - 2));
    for (let i = 0; i < 40; i++) {
      const c = rp();
      if (c.distanceTo(this.pos) > 4 && this.world.pathClear(this.pos, c, 1.0, 1.0)) { this.waypoint = c; return; }
    }
    this.waypoint = rp();
  }

  update(dt, roach, game) {
    // easy levels: the toy car is put away
    this.g.visible = this.cone.g.visible = this.enabled !== false;
    if (this.enabled === false) { this.seenNow = false; this.state = 'patrol'; this.sfx.setCar(0, 0); return; }
    const diff = game.difficulty;
    this.seenNow = this.canSee(roach);
    if (this.seenNow) {
      if (this.state !== 'chase') { this.sfx.beep(); game.warn('The toy car spotted you!'); }
      this.state = 'chase';
      this.chaseTimer = 3.5;
    }
    if (this.state === 'chase') {
      this.chaseTimer -= dt;
      this.waypoint.set(roach.pos.x, 0, roach.pos.z);
      if (this.chaseTimer <= 0 || roach.dead || roach.pos.y > 0.6) { this.state = 'patrol'; this.pickWaypoint(); }
    }
    const dx = this.waypoint.x - this.pos.x, dz = this.waypoint.z - this.pos.z;
    const da = angleDiff(Math.atan2(dx, dz), this.heading);
    this.heading += clamp(da, -2.8 * dt, 2.8 * dt);
    const base = this.state === 'chase' ? 10 + 3 * diff : 5.5;
    const top = base * (0.45 + 0.55 * Math.max(0, Math.cos(da)));
    this.speed += (top - this.speed) * (1 - Math.exp(-3 * dt));
    const before = this.pos.clone();
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.world.pushOut(this.pos, 0.95, 0.9);
    const blocked = this.pos.distanceTo(before) < this.speed * dt * 0.5;
    this.stuck += dt;
    if (this.state === 'patrol' && (Math.hypot(dx, dz) < 1.6 || this.stuck > 6 || blocked)) { this.pickWaypoint(); this.stuck = 0; }

    this.g.position.copy(this.pos);
    this.g.rotation.y = this.heading;
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.3;
    this.g.rotation.z = clamp(-da * 0.15, -0.12, 0.12) * Math.min(1, this.speed / 6); // body roll in turns
    this.cone.g.position.set(this.pos.x, 0.04, this.pos.z);
    this.cone.g.rotation.y = this.heading;
    this.cone.mat.color.setHex(this.state === 'chase' ? 0xff3b3b : 0xaee7ff);
    this.cone.mat.opacity = this.state === 'chase' ? 0.14 : 0.08;

    const rx = roach.pos.x - this.pos.x, rz = roach.pos.z - this.pos.z;
    this.sfx.setCar(Math.max(0, 1 - Math.hypot(rx, rz) / 16), this.speed);
    this.cool -= dt;
    if (roach.dead || this.cool > 0) return;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    if (Math.abs(lx) < 0.75 && Math.abs(lz) < 1.15 && roach.pos.y < 0.85) {
      this.cool = 1;
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      game.damage(30, 'Run over by a toy car', { kx: fx * 12 + Math.sign(lx || 1) * fz * 4, kz: fz * 12 - Math.sign(lx || 1) * fx * 4, ky: 5 });
    }
  }
}
