import * as THREE from 'three';
import { STEP, ROOM } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const v = (x, y, z) => new THREE.Vector3(x, y, z);

function seg(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, len, 6), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

export const ROACH_RADIUS = 0.22;
export const ROACH_HEIGHT = 0.2;

export class Roach {
  constructor(scene, world) {
    this.world = world;
    this.model = new THREE.Group();
    this.inner = new THREE.Group();
    this.model.add(this.inner);
    this.legs = [];
    this.wings = [];
    this.antennae = [];
    this.build();
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(this.model);
    this.reset();
  }

  build() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.5 });
    const pron = new THREE.MeshStandardMaterial({ color: 0xa0612a, roughness: 0.3, metalness: 0.1 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x7a3d16, roughness: 0.2, metalness: 0.25 });
    const sphere = new THREE.SphereGeometry(0.5, 24, 16);
    const g = this.inner;

    const abdomen = new THREE.Mesh(sphere, dark);
    abdomen.scale.set(0.3, 0.1, 0.5);
    abdomen.position.set(0, 0.09, -0.05);
    const pronotum = new THREE.Mesh(sphere, pron);
    pronotum.scale.set(0.27, 0.07, 0.17);
    pronotum.position.set(0, 0.125, 0.2);
    const head = new THREE.Mesh(sphere, dark);
    head.scale.set(0.11, 0.08, 0.08);
    head.position.set(0, 0.08, 0.3);
    g.add(abdomen, pronotum, head);

    for (const s of [-1, 1]) {
      // antennae
      const pivot = new THREE.Group();
      pivot.position.set(0.025 * s, 0.1, 0.32);
      const curve = new THREE.CatmullRomCurve3([v(0, 0, 0), v(0.08 * s, 0.07, 0.18), v(0.18 * s, 0.09, 0.42), v(0.28 * s, 0.03, 0.62)]);
      pivot.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.006, 4), dark));
      g.add(pivot);
      this.antennae.push({ pivot, s });

      // wings (hinged at the front)
      const wp = new THREE.Group();
      wp.position.set(0.01 * s, 0.145, 0.13);
      const wing = new THREE.Mesh(sphere, wingMat);
      wing.scale.set(0.17, 0.025, 0.44);
      wing.position.set(0.07 * s, 0, -0.2);
      wp.add(wing);
      g.add(wp);
      this.wings.push({ pivot: wp, s });

      // cerci
      const cerc = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.1, 5), dark);
      cerc.position.set(0.04 * s, 0.08, -0.32);
      cerc.rotation.x = -Math.PI / 2 - 0.2;
      cerc.rotation.z = 0.3 * s;
      g.add(cerc);

      // 3 legs per side
      const zs = [0.14, 0.03, -0.08];
      const footZ = [0.26, 0.04, -0.3];
      for (let i = 0; i < 3; i++) {
        const pivot2 = new THREE.Group();
        pivot2.position.set(0.09 * s, 0.07, zs[i]);
        const knee = v(0.17 * s, 0.07, footZ[i] * 0.45);
        const foot = v(0.31 * s, -0.07, footZ[i]);
        pivot2.add(seg(v(0, 0, 0), knee, 0.016, dark), seg(knee, foot, 0.011, dark));
        g.add(pivot2);
        this.legs.push({ pivot: pivot2, s, i, tripod: (i % 2 === 0) === (s === 1) });
      }
    }
  }

  reset() {
    this.pos = new THREE.Vector3(20, 10, 18.7); // in the nest, on top of the tall cupboard
    this.inNest = true;
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.heading = Math.PI;
    this.speed = 0;
    this.noise = 0;
    this.eating = false;
    this.landed = 0;
    this.bank = 0;
    this.onGround = true;
    this.flying = false;
    this.open = 0;
    this.health = 100;
    this.stamina = 100;
    this.invuln = 0;
    this.dead = false;
    this.deadTime = 0;
    this.squash = false;
    this.gait = 0;
    this.flap = 0;
    this.inner.rotation.set(0, 0, 0);
    this.inner.position.set(0, 0, 0);
    this.inner.scale.set(1, 1, 1);
    this.inner.visible = true;
    this.climb = null; // { n: wall normal, solid (null = room wall), top }
    this.mantle = null; // short hop up a ledge
    this.high = 0; // seconds of bug-spray high left
    this.model.position.copy(this.pos);
    this.model.quaternion.setFromAxisAngle(UP, this.heading);
  }

  // ---------------------------------------------------------------- Costumes (the roach family)
  // Dad's work tie: knot at the neck, blade lying back along his shell
  addTie() {
    const red = new THREE.MeshStandardMaterial({ color: 0xc1121f, roughness: 0.4 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.4 });
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.055), red);
    knot.position.set(0, 0.17, 0.29);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.28, 4), red);
    blade.rotation.set(Math.PI / 2, Math.PI / 4, 0);
    blade.scale.set(1, 1, 0.35);
    blade.position.set(0, 0.168, 0.14);
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.006, 0.012), stripe);
    s1.position.set(0, 0.182, 0.16);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    collar.position.set(0, 0.15, 0.3);
    collar.rotation.x = -Math.PI / 2 + 0.3;
    this.tieParts = [knot, blade, s1, collar];
    for (const m of this.tieParts) m.userData.keep = true; // shown/hidden separately: don't merge
    for (const m of this.tieParts) { m.castShadow = true; this.inner.add(m); }
  }
  // Dad only wears the tie in the cutscenes
  setTie(on) { for (const m of this.tieParts || []) m.visible = on; }

  // Mum's pink bow
  addBow() {
    const pink = new THREE.MeshStandardMaterial({ color: 0xff6fb1, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 8), pink);
      c.rotation.z = (Math.PI / 2) * s;
      c.position.set(0.045 * s, 0.165, 0.27);
      this.inner.add(c);
    }
    const mid = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), pink);
    mid.position.set(0, 0.165, 0.27);
    this.inner.add(mid);
  }

  // Animate without physics (cutscenes / the family waiting at home)
  pose(dt, time, walk = 0, hop = 0) {
    this.gait += dt * walk * 9;
    const amp = Math.min(1, walk / 2);
    for (const L of this.legs) {
      const ph = this.gait + (L.tripod ? 0 : Math.PI);
      L.pivot.rotation.y = Math.sin(ph) * 0.45 * amp * L.s;
      L.pivot.rotation.z = L.s * (Math.max(0, Math.cos(ph)) * 0.3 * amp + (hop > 0.02 ? 0.4 : 0));
    }
    for (const A of this.antennae) {
      A.pivot.rotation.y = Math.sin(time * (hop > 0.02 ? 14 : 6) + A.s) * 0.2;
      A.pivot.rotation.x = Math.sin(time * 4 + A.s * 2) * 0.12;
    }
    for (const W of this.wings) W.pivot.rotation.set(0, 0, 0);
    this.open = 0;
    this.inner.position.y = hop;
    this.inner.rotation.set(0, 0, 0);
    this.inner.visible = true;
    this.orient(dt);
  }

  die(squash) {
    this.climb = null;
    this.dead = true;
    this.squash = squash;
    this.deadTime = 0;
    this.vel.set(0, 0, 0);
    this.inner.visible = true;
  }

  update(dt, input, camYaw, time) {
    if (this.dead) return this.updateDead(dt, time);

    // Bug-spray high: slower, and steering drifts on its own
    this.high = Math.max(0, this.high - dt);
    const hk = Math.min(1, this.high / 4);

    // Steering controls (camera stays locked behind the bug):
    // W/S (or stick up/down) = forward/back, A/D (or stick left/right, or mouse) = turn.
    const f = Math.max(-1, Math.min(1, (input.fwd ? 1 : 0) - (input.back ? 1 : 0) + (input.ay || 0)));
    const s = Math.max(-1, Math.min(1, (input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.ax || 0)));
    if (this.mantle) return this.updateMantle(dt);
    if (this.climb) return this.updateClimb(dt, input, f, s, hk, time);

    const prevHeading = this.heading;
    const turnRate = (this.onGround ? 3.4 : 2.6) * (this.eating ? 0.5 : 1);
    this.heading -= s * turnRate * dt + (input.lookTurn || 0);
    this.heading += Math.sin(time * 1.7) * 1.4 * hk * dt; // wobbly when high
    const back = f < 0 ? 0.55 : 1; // crawling backwards is slower
    let wx = Math.sin(this.heading) * f * back, wz = Math.cos(this.heading) * f * back;
    const moving = Math.abs(f) > 0.05;

    const airborne = !this.onGround;
    const slow = (this.eating ? 0.35 : 1) * (1 - 0.5 * hk);
    const speed = (airborne ? 8 : input.sprint ? 8 : 4.5) * slow;
    const k = 1 - Math.exp(-(airborne ? 3.5 : 14) * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;
    // lean into turns
    const turned = (this.heading - prevHeading) / Math.max(dt, 1e-4);
    const maxBank = airborne ? 0.6 : 0.3;
    this.bank += (Math.max(-maxBank, Math.min(maxBank, -turned * 0.07 * (moving ? 1 : 0.4))) - this.bank) * (1 - Math.exp(-10 * dt));

    // Jump / fly
    if (input.jump && this.onGround && this.stamina > 8) {
      this.vy = 5.5;
      this.onGround = false;
      this.stamina -= 6;
    }
    this.flying = false;
    if (!this.onGround) {
      if (input.fly && this.stamina > 0) {
        this.vy += (3.4 - this.vy) * (1 - Math.exp(-5 * dt));
        this.stamina -= 20 * dt;
        this.flying = true;
      } else if (input.fly) {
        // out of stamina: glide down slowly
        this.vy = Math.max(this.vy - 16 * dt, -2.2);
      } else {
        this.vy -= 16 * dt;
      }
      this.vy = Math.max(this.vy, -14);
    } else {
      this.stamina += 16 * dt;
    }
    this.stamina = Math.max(0, Math.min(100, this.stamina));

    const fallVy = this.vy;
    const wasAir = !this.onGround;
    this.integrate(dt);
    if (wasAir && this.onGround && fallVy < -3) this.landed = Math.min(1, -fallVy / 12);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // how loud we are (the human and cat can hear this)
    this.noise = !this.onGround && this.open > 0.5 ? 1 : this.eating ? 0.5 : this.speed > 5 ? 0.45 : this.speed > 0.5 ? 0.1 : 0;
    // walking forward into a wall or the side of furniture: start climbing it
    if (f > 0.3) this.tryClimb(); // also works mid-flight: fly at a wall and grab on
    if (this.climb) return;

    // Animation
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.gait += dt * hs * 9;
    const amp = Math.min(1, hs / 2);
    for (const L of this.legs) {
      const ph = this.gait + (L.tripod ? 0 : Math.PI);
      if (this.onGround) {
        L.pivot.rotation.y = Math.sin(ph) * 0.45 * amp * L.s;
        L.pivot.rotation.z = L.s * Math.max(0, Math.cos(ph)) * 0.3 * amp;
      } else {
        L.pivot.rotation.y *= 0.9;
        L.pivot.rotation.z += (L.s * 0.5 - L.pivot.rotation.z) * 0.2;
      }
    }
    this.open += ((airborne ? 1 : 0) - this.open) * (1 - Math.exp(-14 * dt));
    this.flap += dt * (this.flying ? 55 : 20);
    for (const W of this.wings) {
      W.pivot.rotation.z = W.s * this.open * (0.55 + 0.35 * Math.sin(this.flap));
      W.pivot.rotation.y = -W.s * this.open * 0.5;
      W.pivot.rotation.x = this.open * 0.2;
    }
    for (const A of this.antennae) {
      A.pivot.rotation.y = Math.sin(time * 6 + A.s) * 0.15;
      A.pivot.rotation.x = Math.sin(time * 4 + A.s * 2) * 0.1 - this.open * 0.3;
    }
    this.inner.rotation.x = -this.open * 0.2 + (this.eating ? Math.sin(time * 18) * 0.08 + 0.08 : 0);
    this.inner.rotation.z = this.bank;
    this.inner.position.y = this.onGround ? Math.abs(Math.sin(this.gait)) * 0.012 * amp : 0;
    this.inner.visible = this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0;
    this.orient(dt);
  }

  // Which way the bug faces and which way is "up" for it (world up on the floor, the wall normal when climbing).
  frame() {
    if (this.climb) return { fwd: this.wallDir(), up: this.climb.n.clone() };
    const n = this.groundNormal || UP;
    const f = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    f.addScaledVector(n, -f.dot(n)).normalize();
    return { fwd: f, up: n.clone() };
  }

  // Face the model along its frame (tilts to match leaves and walls).
  orient(dt) {
    const { fwd, up } = this.frame();
    const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    this.model.quaternion.slerp(q, 1 - Math.exp(-18 * dt));
    this.model.position.copy(this.pos);
    if (this.climb) this.model.position.addScaledVector(this.climb.n, -0.2); // feet on the wall
  }

  // ---------------------------------------------------------------- Wall climbing (Spider-Man style)
  // On a wall the bug keeps steering like on the floor: W crawls the way it faces, A/D turn.
  // climb.a = facing angle on the wall (0 = straight up, +PI/2 = to the right).
  wallTangent() { const n = this.climb.n; return new THREE.Vector3(n.z, 0, -n.x); }
  wallDir() {
    const a = this.climb.a;
    return new THREE.Vector3(0, Math.cos(a), 0).addScaledVector(this.wallTangent(), Math.sin(a));
  }

  tryClimb() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (Math.max(Math.abs(fx), Math.abs(fz)) < 0.6) return; // facing the surface (even at an angle)
    const n = Math.abs(fx) > Math.abs(fz) ? new THREE.Vector3(-Math.sign(fx), 0, 0) : new THREE.Vector3(0, 0, -Math.sign(fz));
    const reach = ROACH_RADIUS + 0.14;
    const px = this.pos.x - n.x * reach, pz = this.pos.z - n.z * reach, py = this.pos.y + 0.1;
    let solid = null;
    const roomWall = Math.abs(px) > ROOM.hx - 0.2 || Math.abs(pz) > ROOM.hz - 0.2;
    if (!roomWall) {
      solid = this.world.solids.find((s) => px > s.minX && px < s.maxX && pz > s.minZ && pz < s.maxZ && py > s.minY && py < s.maxY && s.maxY > this.pos.y + STEP + 0.05);
      if (!solid) return;
    }
    // Everything taller than a tiny step gets properly climbed (short boxes too); the camera only rolls once you're high up
    this.climb = { n, solid, top: solid ? solid.maxY : ROOM.height - 0.5, a: 0, y0: this.pos.y };
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.onGround = false;
    this.flying = false;
    this.snapToSurface();
  }

  // Quick hop up a short ledge (small arc), then carry on walking.
  updateMantle(dt) {
    const m = this.mantle;
    m.t += dt / m.dur;
    const e = Math.min(1, m.t);
    this.pos.lerpVectors(m.from, m.to, e);
    this.pos.y = m.from.y + (m.to.y - m.from.y) * Math.sin(e * Math.PI / 2) + Math.sin(e * Math.PI) * 0.12;
    this.speed = 3;
    this.gait += dt * 30;
    if (e >= 1) {
      this.pos.copy(m.to);
      this.mantle = null;
      this.onGround = true;
      this.groundNormal = null;
    }
    this.orient(dt);
  }

  snapToSurface() {
    const c = this.climb, n = c.n;
    if (c.solid) {
      if (n.x < 0) this.pos.x = c.solid.minX - ROACH_RADIUS;
      else if (n.x > 0) this.pos.x = c.solid.maxX + ROACH_RADIUS;
      else if (n.z < 0) this.pos.z = c.solid.minZ - ROACH_RADIUS;
      else this.pos.z = c.solid.maxZ + ROACH_RADIUS;
    } else {
      // Room wall. Crawl *over* anything thin hung on it (frames, clock, aircon...) instead of through it.
      const off = ROACH_RADIUS + 0.15;
      const axis = n.x !== 0 ? 'x' : 'z', other = axis === 'x' ? 'z' : 'x';
      const half = axis === 'x' ? ROOM.hx : ROOM.hz;
      const sign = n[axis]; // +1: wall is at -half
      let prot = 0;
      for (const s of this.world.solids) {
        const lo = axis === 'x' ? s.minX : s.minZ, hi = axis === 'x' ? s.maxX : s.maxZ;
        const p = sign > 0 ? (lo < -half + 0.3 ? hi + half : -1) : (hi > half - 0.3 ? half - lo : -1);
        if (p <= 0 || p > 1.0) continue;
        const olo = other === 'x' ? s.minX : s.minZ, ohi = other === 'x' ? s.maxX : s.maxZ;
        if (this.pos[other] < olo - 0.1 || this.pos[other] > ohi + 0.1 || this.pos.y < s.minY - 0.15 || this.pos.y > s.maxY + 0.05) continue;
        prot = Math.max(prot, p);
      }
      this.pos[axis] = -sign * (half - off - prot);
    }
  }

  // Leave the wall; heading = the direction we were crawling, flattened (or away from the wall).
  detach(jump) {
    const n = this.climb.n;
    const d = this.wallDir();
    const hx = d.x + n.x * 0.6, hz = d.z + n.z * 0.6;
    this.heading = Math.atan2(hx, hz);
    this.pos.addScaledVector(n, 0.06);
    if (jump) {
      this.vel.set(n.x * 4.5, 0, n.z * 4.5);
      this.vy = 3;
    }
    this.onGround = false;
    this.climb = null;
  }

  updateClimb(dt, input, f, s, hk, time) {
    const c = this.climb;
    this.flying = false;
    this.stamina = Math.min(100, this.stamina + 10 * dt);
    if (input.jump) { this.detach(true); this.orient(dt); return; }
    // steer on the wall exactly like on the floor
    c.a += s * 3.4 * dt + (input.lookTurn || 0) + Math.sin(time * 1.7) * 1.4 * hk * dt;
    const speed = (input.sprint ? 5.5 : 3.6) * (1 - 0.5 * hk) * (f < 0 ? 0.55 : 1);
    const dir = this.wallDir();
    this.pos.addScaledVector(dir, f * speed * dt);
    this.snapToSurface();

    // ----- sideways edges: wrap around corners (outer corners of furniture, inner corners of the room)
    const t = this.wallTangent();
    if (c.solid) {
      const s0 = c.solid;
      const along = t.x !== 0 ? this.pos.x * Math.sign(t.x) : this.pos.z * Math.sign(t.z);
      const lo = t.x !== 0 ? (t.x > 0 ? s0.minX : -s0.maxX) : (t.z > 0 ? s0.minZ : -s0.maxZ);
      const hi = t.x !== 0 ? (t.x > 0 ? s0.maxX : -s0.minX) : (t.z > 0 ? s0.maxZ : -s0.minZ);
      const oldN = c.n.clone();
      let wrapped = false;
      if (along > hi) { c.n = t.clone(); wrapped = true; }
      else if (along < lo) { c.n = t.clone().negate(); wrapped = true; }
      if (wrapped) {
        // keep the turn continuous: what was "right" along the old face continues round the corner
        if (oldN.x !== 0) this.pos.x = oldN.x > 0 ? s0.maxX - 0.05 : s0.minX + 0.05;
        else this.pos.z = oldN.z > 0 ? s0.maxZ - 0.05 : s0.minZ + 0.05;
        this.snapToSurface();
      }
    } else {
      const off = ROACH_RADIUS + 0.15;
      const lim = (axis) => (axis === 'x' ? ROOM.hx : ROOM.hz) - off;
      for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
        if (c.n[axis] !== 0) continue; // that's the wall we're on
        if (this.pos[axis] * sign > lim(axis)) {
          // inner corner: hop onto the wall in front
          const oldN = c.n.clone();
          c.n = new THREE.Vector3(axis === 'x' ? -sign : 0, 0, axis === 'z' ? -sign : 0);
          const other = oldN.x !== 0 ? 'x' : 'z';
          this.pos[other] = -oldN[other] * (lim(other) - 0.05);
          this.snapToSurface();
          break;
        }
      }
    }

    // ----- top edge
    if (this.pos.y >= c.top - 0.02) {
      const n = c.n;
      const probe = { x: this.pos.x - n.x * (ROACH_RADIUS + 0.3), z: this.pos.z - n.z * (ROACH_RADIUS + 0.3) };
      const stacked = c.solid && this.world.solids.find((s) => s !== c.solid && Math.abs(s.minY - c.top) < 0.08 && probe.x > s.minX && probe.x < s.maxX && probe.z > s.minZ && probe.z < s.maxZ);
      if (stacked) {
        // something sits on top (e.g. a countertop): keep climbing its face if it's flush, else we're stuck under it
        const faceNow = n.x !== 0 ? (n.x < 0 ? c.solid.minX : c.solid.maxX) : (n.z < 0 ? c.solid.minZ : c.solid.maxZ);
        const faceNew = n.x !== 0 ? (n.x < 0 ? stacked.minX : stacked.maxX) : (n.z < 0 ? stacked.minZ : stacked.maxZ);
        if (Math.abs(faceNow - faceNew) < 0.6) { c.solid = stacked; c.top = stacked.maxY; this.snapToSurface(); }
        else this.pos.y = c.top - 0.02;
      } else if (c.solid && dir.y * f > 0.1) {
        // crawl over the edge onto the top, still facing the way we were going
        this.pos.y = c.top;
        this.pos.x -= n.x * (ROACH_RADIUS + 0.3);
        this.pos.z -= n.z * (ROACH_RADIUS + 0.3);
        this.heading = Math.atan2(-n.x + t.x * Math.sin(c.a), -n.z + t.z * Math.sin(c.a));
        this.climb = null;
        this.onGround = true;
        this.orient(dt);
        return;
      } else {
        this.pos.y = c.top - 0.02;
      }
    }
    // ----- bottom edge
    if (c.solid && c.solid.minY > 0.05 && this.pos.y < c.solid.minY) {
      // furniture standing on something / legs: continue onto a flush face below, else drop off
      const n = c.n;
      const probe = { x: this.pos.x - n.x * (ROACH_RADIUS + 0.1), z: this.pos.z - n.z * (ROACH_RADIUS + 0.1) };
      const below = this.world.solids.find((s) => s !== c.solid && Math.abs(s.maxY - c.solid.minY) < 0.08 && probe.x > s.minX - 0.6 && probe.x < s.maxX + 0.6 && probe.z > s.minZ - 0.6 && probe.z < s.maxZ + 0.6);
      if (below) { c.solid = below; c.top = below.maxY; this.snapToSurface(); }
      else { this.detach(false); this.orient(dt); return; }
    }
    const g = this.world.groundAt(this.pos.x + c.n.x * 0.3, this.pos.z + c.n.z * 0.3, this.pos.y + 0.05);
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (dir.y * f < -0.1) { this.detach(false); this.onGround = true; this.orient(dt); return; } // walked down onto the floor
    }
    // other furniture can push us off the wall
    const before = this.pos.clone();
    this.world.pushOut(this.pos, ROACH_RADIUS * 0.6, ROACH_HEIGHT);
    if (before.distanceTo(this.pos) > 0.25) { this.detach(false); this.orient(dt); return; }
    this.pos.copy(before);

    this.vel.set(0, 0, 0);
    const moveAmt = Math.min(1, Math.abs(f) + Math.abs(s) * 0.5);
    this.speed = Math.abs(f) * speed;
    this.noise = moveAmt > 0.1 ? 0.1 : 0;
    this.gait += dt * Math.max(this.speed, Math.abs(s) * 2) * 9;
    for (const L of this.legs) {
      const ph = this.gait + (L.tripod ? 0 : Math.PI);
      L.pivot.rotation.y = Math.sin(ph) * 0.45 * moveAmt * L.s;
      L.pivot.rotation.z = L.s * Math.max(0, Math.cos(ph)) * 0.3 * moveAmt;
    }
    this.open += (0 - this.open) * (1 - Math.exp(-14 * dt));
    for (const W of this.wings) W.pivot.rotation.z *= 0.8;
    this.bank *= 0.9;
    this.inner.rotation.set(0, 0, 0);
    this.inner.visible = this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0;
    this.orient(dt);
  }

  integrate(dt) {
    const steps = Math.ceil(dt / 0.01);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const prevY = this.pos.y;
      const sx = this.vel.x * h, sz = this.vel.z * h;
      if (this.world.leafBlock(this.pos, sx, sz)) {
        // bumped into the side of a leaf: stop instead of passing through it
        this.vel.x *= 0.2;
        this.vel.z *= 0.2;
      } else {
        this.pos.x += sx;
        this.pos.z += sz;
      }
      this.pos.y += this.vy * h;
      if (this.world.ceiling(this.pos, ROACH_HEIGHT, prevY)) this.vy = Math.min(this.vy, 0);
      let g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
      let normal = null;
      // plant leaves: stand on the real (tilted) leaf surface
      const mg = this.world.meshGroundAt(this.pos.x, this.pos.z, this.pos.y);
      if (mg && mg.y > g) { g = mg.y; normal = mg.normal; }
      if (this.pos.y <= g) {
        this.pos.y = g;
        if (this.vy < 0) this.vy = 0;
        this.onGround = this.vy <= 0;
        this.groundNormal = normal;
      } else if (this.onGround && this.vy <= 0 && this.pos.y - g < STEP * 0.5) {
        this.pos.y = g; // walk down tiny steps / follow the leaf
        this.groundNormal = normal;
      } else {
        this.onGround = false;
        this.groundNormal = null;
      }
      this.world.pushOut(this.pos, ROACH_RADIUS, ROACH_HEIGHT);
      this.world.pushOutDynamic(this.pos, ROACH_RADIUS, ROACH_HEIGHT);
    }
  }

  updateDead(dt, time) {
    this.deadTime += dt;
    // fall to the ground
    this.vy -= 16 * dt;
    this.pos.y += this.vy * dt;
    const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1);
    if (this.pos.y < g) { this.pos.y = g; this.vy = 0; }
    const e = Math.min(1, this.deadTime * 4);
    if (this.squash) {
      this.inner.scale.set(1 + 0.4 * e, 1 - 0.75 * e, 1 + 0.2 * e);
    } else {
      // classic belly-up
      this.inner.rotation.z = Math.PI * e;
      this.inner.position.y = 0.2 * e;
    }
    const twitch = Math.max(0, 1 - this.deadTime / 3);
    for (const L of this.legs) {
      L.pivot.rotation.y = Math.sin(time * 30 + L.i * 2 + L.s) * 0.5 * twitch;
      L.pivot.rotation.z = L.s * (0.3 + Math.sin(time * 23 + L.i) * 0.3 * twitch);
    }
    for (const W of this.wings) W.pivot.rotation.z *= 0.9;
    this.inner.visible = true;
    this.model.position.copy(this.pos);
  }
}
