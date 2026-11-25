import * as THREE from 'three';
import { ROOM, clamp, rand, lerpAngle, compactModel } from './world.js';
import { walkTo, visionCone, makeIcon, setIcon, warningRing, M, shadowAll, angleDiff, hdist } from './hazards.js';

// The cat: the only one who can find you in deep hiding spots (under the sofa, TV cabinet, bench, kitchen cabinets).
// Once it has found you it keeps hunting: it tracks you by smell, waits at the edge of whatever you hide under
// and keeps reaching in with its paw. Only the nest and the wall crack are out of its reach.
const CAT_RANGE = 11;
const CAT_FOV = THREE.MathUtils.degToRad(140);
const HUNT_MEMORY = 40; // seconds the cat keeps hunting after it last sensed you
const SMELL_RANGE = 11; // while hunting it can track you this close, even hidden
const PAW_REACH = 3.0; // how far under furniture it can reach from the edge

// Orange tabby stripes, wrapped around the body spheres
function tabbyTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d98a3a';
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 22) {
    g.strokeStyle = 'rgba(140,70,20,0.75)';
    g.lineWidth = 7 + Math.random() * 4;
    g.beginPath();
    for (let y = 0; y <= 128; y += 8) g.lineTo(x + Math.sin(y / 18 + x) * 5, y);
    g.stroke();
  }
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,230,200,0)');
  grad.addColorStop(0.75, 'rgba(255,240,220,0)');
  grad.addColorStop(1, 'rgba(255,245,230,0.8)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Cat {
  constructor(scene, world, sfx) {
    this.world = world;
    this.sfx = sfx;
    // Orange tabby (kucing oren): smooth body from overlapping spheres, striped fur texture, proper face
    const fur = new THREE.MeshStandardMaterial({ map: tabbyTexture(), roughness: 0.95 });
    const plain = M(0xd98a3a, 0.95), white = M(0xfff3e0, 0.9), pink = M(0xe78fa0, 0.6), black = M(0x080808, 0.3);
    const sph = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
    this.g = new THREE.Group();
    this.body = new THREE.Group();
    this.g.add(this.body);
    const add = (geo, mat, x, y, z, parent = this.body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    add(sph(1), fur, 0, 2.05, 0.8).scale.set(0.8, 0.85, 0.95); // chest
    add(sph(1), fur, 0, 1.95, -0.1).scale.set(0.74, 0.78, 1.15); // belly
    add(sph(1), fur, 0, 2.0, -0.9).scale.set(0.8, 0.85, 0.9); // hips
    add(sph(1), white, 0, 1.72, 1.45).scale.set(0.45, 0.55, 0.35); // white chest patch
    add(sph(1), fur, 0, 2.6, 1.45).scale.set(0.5, 0.55, 0.55); // neck
    this.head = new THREE.Group();
    this.head.position.set(0, 3.0, 1.95);
    this.body.add(this.head);
    add(sph(0.62, 24, 18), fur, 0, 0, 0, this.head).scale.set(1.08, 0.92, 0.95);
    for (const s of [-1, 1]) {
      add(sph(0.3), plain, 0.33 * s, -0.2, 0.25, this.head); // cheeks
      add(sph(0.17), white, 0.1 * s, -0.24, 0.5, this.head); // muzzle
      // eye + slit pupil
      add(sph(0.13), new THREE.MeshStandardMaterial({ color: 0x9cd44a, emissive: 0x2a5a08, roughness: 0.2 }), 0.24 * s, 0.07, 0.49, this.head);
      add(sph(0.13), black, 0.24 * s, 0.07, 0.56, this.head).scale.set(0.22, 0.85, 0.4);
      // ears
      const ear = add(new THREE.ConeGeometry(0.25, 0.48, 3), plain, 0.34 * s, 0.52, -0.02, this.head);
      ear.rotation.set(-0.1, 0, -0.3 * s);
      const inner = add(new THREE.ConeGeometry(0.15, 0.32, 3), pink, 0.33 * s, 0.5, 0.06, this.head);
      inner.rotation.set(-0.1, 0, -0.3 * s);
      for (const k of [-1, 0, 1]) {
        const wh = add(new THREE.CylinderGeometry(0.006, 0.006, 0.95, 3), M(0xffffff, 0.5), 0.5 * s, -0.24 + k * 0.05, 0.5, this.head);
        wh.rotation.set(0, -0.25 * s, Math.PI / 2 + k * 0.12 * s);
      }
    }
    add(sph(0.12), white, 0, -0.35, 0.44, this.head); // chin
    add(sph(0.065), pink, 0, -0.12, 0.62, this.head).scale.set(1.2, 0.7, 0.8); // nose
    // legs: upper + lower + paw (back legs get a haunch)
    this.legs = [];
    for (const [x, z] of [[-0.42, 1.05], [0.42, 1.05], [-0.45, -1.0], [0.45, -1.0]]) {
      const front = z > 0;
      const p = new THREE.Group();
      p.position.set(x, 1.75, z);
      if (!front) add(sph(1), fur, 0, 0.05, -0.05, p).scale.set(0.38, 0.62, 0.55);
      add(new THREE.CylinderGeometry(0.21, 0.17, 1.05, 10), fur, 0, -0.5, 0, p);
      add(new THREE.CylinderGeometry(0.16, 0.14, 0.75, 10), fur, 0, -1.25, front ? 0.03 : -0.05, p);
      add(sph(0.2), white, 0, -1.66, 0.08, p).scale.set(1, 0.6, 1.3);
      this.body.add(p);
      this.legs.push({ p, front, s: x > 0 ? 1 : -1 });
    }
    // tail: chain of segments so it can curl and swish
    this.tail = new THREE.Group();
    this.tail.position.set(0, 2.25, -1.65);
    this.tail.rotation.x = -0.9;
    this.body.add(this.tail);
    this.tailSegs = [];
    let parent = this.tail;
    for (let i = 0; i < 9; i++) {
      const seg = new THREE.Group();
      seg.position.z = i === 0 ? 0 : -0.3;
      const r = 0.17 - i * 0.008;
      add(sph(r, 10, 8), i === 8 ? M(0x8a4a1a, 0.9) : fur, 0, 0, -0.15, seg).scale.set(1, 1, 1.6);
      parent.add(seg);
      this.tailSegs.push(seg);
      parent = seg;
    }
    shadowAll(this.g);
    compactModel(this.g); // fewer draw calls

    this.cone = visionCone(CAT_RANGE, CAT_FOV, 0xc9a0ff);
    this.icon = makeIcon();
    this.ring = warningRing(0xc04dff, 0.8, 1.15);
    scene.add(this.g, this.cone.g, this.icon, this.ring);
    this.reset();
  }

  reset() {
    if (this.sleepSolid) this.world.removeSolid(this.sleepSolid); // re-added each frame while she sleeps
    this.body.position.y = 0;
    const cs = this.world.layout?.catStart || [-6, 12];
    this.pos = new THREE.Vector3(cs[0], 0, cs[1]);
    this.facing = Math.PI / 2;
    this.move = 0;
    this.phase = 0;
    this.stuck = 0;
    this.state = 'wander'; // wander | sniff | hunt | pounce | paw | rest
    this.hunting = false;
    this.huntTimer = 0;
    this.lastKnown = new THREE.Vector3();
    this.target = this.pos.clone().add(new THREE.Vector3(2, 0, -4));
    this.wait = 1;
    this.suspicion = 0;
    this.sniff = 0;
    this.pawCool = 0;
    this.zoomCool = rand(8, 14);
    this.leapCool = 0;
    this.vy = 0;
    this.curSpeed = 0;
    this.goalLeap = null;
    this.meowCool = 0;
    this.t = 0;
    this.st = 0;
    this.hop = 0;
    this.crouch = 0;
    this.seenNow = false;
    this.ring.visible = false;
    this.legs[1].p.rotation.x = 0;
    this.updateVisuals();
  }

  canSee(roach) {
    if (roach.dead || roach.inNest) return false;
    const dx = roach.pos.x - this.pos.x, dz = roach.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > CAT_RANGE) return false;
    if (Math.abs(angleDiff(Math.atan2(dx, dz), this.facing)) > CAT_FOV / 2) return false;
    const eye = new THREE.Vector3(this.pos.x + Math.sin(this.facing) * 2.4, 2.7, this.pos.z + Math.cos(this.facing) * 2.4);
    return this.world.lineOfSight(eye, new THREE.Vector3(roach.pos.x, roach.pos.y + 0.12, roach.pos.z));
  }


  // Body, head and paws are solid to the roach (it can still run between the legs under the belly).
  colliders(out) {
    if (this.mode === 'sleep') return; // asleep: her body is a solid you can climb instead
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const sx = Math.cos(this.facing), sz = -Math.sin(this.facing);
    const y = this.pos.y, low = 1.2 - this.crouch * 0.7;
    out.push({ x: this.pos.x + fx * 0.8, z: this.pos.z + fz * 0.8, r: 0.8, y0: y + low, y1: y + 3.0 });
    out.push({ x: this.pos.x - fx * 0.8, z: this.pos.z - fz * 0.8, r: 0.8, y0: y + low, y1: y + 3.0 });
    out.push({ x: this.pos.x + fx * 1.95, z: this.pos.z + fz * 1.95, r: 0.62, y0: y + 2.3 - this.crouch * 0.7, y1: y + 3.6 });
    for (const [lx, lz] of [[-0.42, 1.05], [0.42, 1.05], [-0.45, -1.0], [0.45, -1.0]]) {
      out.push({ x: this.pos.x + sx * lx + fx * lz, z: this.pos.z + sz * lx + fz * lz, r: 0.24, y0: y, y1: y + 1.8 });
    }
  }

  startHunt(game, person, roach, msg) {
    if (!this.hunting) {
      this.sfx.meow();
      person.hear(roach.pos, 0.25);
      game.warn(msg);
    }
    this.hunting = true;
    this.huntTimer = HUNT_MEMORY;
    this.lastKnown.copy(roach.pos);
    this.setState('hunt');
  }

  // Best spot just outside the furniture the roach is hiding under, on the side closest to it (and not against a wall).
  edgeSpot(solid, p) {
    const out = 1.45;
    const sides = [
      { d: p.x - solid.minX, x: solid.minX - out, z: clamp(p.z, solid.minZ, solid.maxZ) },
      { d: solid.maxX - p.x, x: solid.maxX + out, z: clamp(p.z, solid.minZ, solid.maxZ) },
      { d: p.z - solid.minZ, x: clamp(p.x, solid.minX, solid.maxX), z: solid.minZ - out },
      { d: solid.maxZ - p.z, x: clamp(p.x, solid.minX, solid.maxX), z: solid.maxZ + out },
    ].sort((a, b) => a.d - b.d);
    for (const s of sides) {
      if (Math.abs(s.x) < ROOM.hx - 1.4 && Math.abs(s.z) < ROOM.hz - 1.4 && this.world.isFree(s.x, 1.0, s.z, 0.9)) return s;
    }
    return sides[0];
  }

  // Level difficulty: 'sleep' (level 1), 'lazy', 'normal', 'aggro'
  senseMul() { return { lazy: 0.5, normal: 0.85 }[this.mode] || 1; }
  speedMul() { return { lazy: 0.65, normal: 0.85 }[this.mode] || 1; }

  // Fast asleep, curled up on the rattan armchair cushion
  sleep(dt, roach, game, person) {
    // While asleep her body is a solid lump you can climb... but crawl on top of her and she wakes up!
    const s = this.sleepSolid || (this.sleepSolid = { minX: 18.4, maxX: 21.7, minY: 2.1, maxY: 3.15, minZ: -13.15, maxZ: -11.65 });
    this.world.addSolid(s);
    if (roach && !roach.dead) {
      const onTop = roach.pos.x > s.minX - 0.1 && roach.pos.x < s.maxX + 0.1 && roach.pos.z > s.minZ - 0.1 && roach.pos.z < s.maxZ + 0.1 && roach.pos.y > s.maxY - 0.3;
      const climbing = roach.climb && roach.climb.solid === s && roach.pos.y > s.minY + 0.5;
      if (onTop || climbing) return this.wake(roach, game, person);
    }
    this.t += dt;
    this.pos.set(20, 2.1, -12.4);
    this.facing = Math.PI / 2;
    this.move = 0;
    this.state = 'wander';
    this.hunting = false;
    this.seenNow = false;
    this.suspicion = this.sniff = 0;
    this.crouch = 1.35;
    this.head.rotation.x = 0.55;
    for (const L of this.legs) L.p.rotation.x = L.front ? -1.2 : 1.1;
    this.body.position.y = -0.95 + Math.sin(this.t * 1.6) * 0.03; // breathing
    this.tail.rotation.z = 1.2;
    this.g.position.copy(this.pos);
    this.g.rotation.y = this.facing;
    this.cone.g.visible = false;
    setIcon(this.icon, 'z', '#5b6cff', 0.6 + 0.4 * Math.sin(this.t * 2));
    this.icon.position.set(this.pos.x + 1.2, 4.6 + Math.sin(this.t) * 0.2, this.pos.z);
  }

  // Rudely woken: she jumps up, throws the roach off and hunts it
  wake(roach, game, person) {
    this.world.removeSolid(this.sleepSolid);
    this.mode = 'normal';
    this.icon.visible = false;
    this.body.position.y = 0;
    this.crouch = 0.5;
    this.head.rotation.x = 0;
    if (roach.climb) roach.detach(true);
    roach.vy = 4.5;
    roach.onGround = false;
    roach.vel.x += (roach.pos.x - this.pos.x) * 2;
    roach.vel.z += 3;
    game.shake(0.25);
    this.sfx.meow();
    this.sfx.meow();
    this.startHunt(game, person, roach, 'OYEN WOKE UP!!');
    this.pawCool = 0.4;
  }

  update(dt, roach, game, person) {
    if (this.mode === 'sleep') return this.sleep(dt, roach, game, person);
    this.cone.g.visible = true;
    this.t += dt;
    this.st += dt;
    this.pawCool -= dt;
    this.meowCool -= dt;
    this.zoomCool -= dt;
    this.leapCool -= dt;
    this.game = game;
    const dist = hdist(roach.pos, this.pos);
    const hidden = this.world.hidingSpot(roach.pos.x, roach.pos.z, roach.pos.y);
    this.seenNow = !hidden && this.canSee(roach);

    // Sniffing: only works near deep hiding spots
    if (hidden && !roach.dead && dist < 6 && this.state !== 'rest') this.sniff += dt * (0.45 + Math.min(roach.speed, 4) * 0.1 + (roach.eating ? 0.3 : 0)) * this.senseMul();
    else this.sniff = Math.max(0, this.sniff - dt * 0.15);
    if (this.seenNow && roach.pos.y < 6.5 && this.state !== 'rest') this.suspicion += dt * 1.6 * (roach.speed > 0.4 ? 1 : 0.5) * this.senseMul();
    else this.suspicion = Math.max(0, this.suspicion - dt * 0.2);

    // While hunting it tracks you by smell/hearing when you're close (except in the nest or the wall crack)
    if (this.hunting) {
      const senses = !roach.dead && !roach.inNest && (this.seenNow || dist < SMELL_RANGE);
      if (senses) { this.lastKnown.copy(roach.pos); this.huntTimer = HUNT_MEMORY; }
      else this.huntTimer -= dt;
      if (this.huntTimer <= 0 || roach.dead) {
        this.hunting = false;
        this.setState('wander');
        this.wait = 1;
        if (!roach.dead) game.warn('The cat lost interest... for now.');
      }
    }

    if (this.state === 'leap') {
      this.updateLeap(dt, game);
    } else switch (this.state) {
      case 'wander': {
        this.crouch += (0 - this.crouch) * 0.1;
        this.head.rotation.x = 0;
        if (this.zoomCool <= 0 && this.pos.y < 0.3 && this.mode !== 'lazy') {
          // ZOOMIES: sprint around the house, crashing into things
          this.setState('zoom');
          this.zoomTime = rand(3, 5);
          this.goalLeap = null;
          this.pickTarget();
          this.sfx.meow();
          break;
        }
        if (this.wait > 0) {
          this.wait -= dt;
          this.move += (0 - this.move) * 0.1;
          this.facing += Math.sin(this.t * 1.3) * dt * 0.8; // looks around
          if (this.wait <= 0) this.chooseWanderGoal();
        } else if (this.goalLeap) {
          if (this.walk(this.approach.x, this.approach.z, 4.5, dt, 0.8)) this.beginLeap(this.goalLeap);
        } else if (this.walk(this.target.x, this.target.z, 4.2, dt, 1.0)) {
          this.wait = rand(0.6, 2.2);
        }
        if (this.sniff > 0.25) this.setState('sniff');
        if (this.suspicion >= 1) this.startHunt(game, person, roach, 'The cat saw you!');
        break;
      }
      case 'zoom': {
        this.crouch += (0.3 - this.crouch) * 0.1;
        if (this.walk(this.target.x, this.target.z, 10, dt, 1.5)) this.pickTarget();
        this.zoomTime -= dt;
        if (this.zoomTime <= 0) { this.setState('wander'); this.wait = rand(1, 2); this.zoomCool = rand(14, 24) * (this.mode === 'aggro' ? 1 : 2.2); }
        if (this.sniff > 0.25) this.setState('sniff');
        if (this.suspicion >= 1) this.startHunt(game, person, roach, 'The cat saw you!');
        break;
      }
      case 'sniff': {
        this.crouch += (0.6 - this.crouch) * 0.1;
        const arrived = this.walk(roach.pos.x, roach.pos.z, 3.0, dt, 1.2);
        if (arrived || this.move < 0.2) this.facing = lerpAngle(this.facing, Math.atan2(roach.pos.x - this.pos.x, roach.pos.z - this.pos.z), 0.1);
        this.head.rotation.x = Math.sin(this.t * 14) * 0.08 + 0.3;
        if (this.sniff >= 1) this.startHunt(game, person, roach, 'The cat smelled you!');
        else if (this.sniff <= 0.05) this.setState('wander');
        if (!hidden && this.seenNow) this.startHunt(game, person, roach, 'The cat saw you!');
        break;
      }
      case 'hunt': {
        if (this.meowCool <= 0) { this.sfx.meow(); person.hear(this.lastKnown, 0.15); this.meowCool = rand(3, 5); }
        if (roach.inNest) {
          // camp as close to the nest / crack as it can get and wait
          const wz = this.lastKnown.z - Math.sign(this.lastKnown.z) * 3.2;
          if (this.walk(this.lastKnown.x, wz, 5, dt, 0.8)) {
            this.facing = lerpAngle(this.facing, Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z), 0.1);
            this.crouch += (0.8 - this.crouch) * 0.1;
          }
          break;
        }
        const cover = this.world.hidingSolid(this.lastKnown.x, this.lastKnown.z, this.lastKnown.y);
        if (cover) {
          // run to the edge closest to the roach, squash down low and keep reaching in
          const spot = this.edgeSpot(cover, this.lastKnown);
          const arrived = this.walk(spot.x, spot.z, 7, dt, 0.7);
          this.crouch += ((arrived ? 1.3 : 0.6) - this.crouch) * 0.12;
          this.head.rotation.x = 0.35 + Math.sin(this.t * 12) * 0.06;
          if (arrived || this.move < 0.25) {
            this.facing = lerpAngle(this.facing, Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z), 0.15);
            const reach = Math.hypot(roach.pos.x - spot.x, roach.pos.z - spot.z);
            if (this.pawCool <= 0 && reach < PAW_REACH + 1.4 && !roach.dead) this.beginPaw(roach, game);
          }
        } else {
          this.crouch += (0.7 - this.crouch) * 0.1;
          this.head.rotation.x = 0;
          // sprint at the roach; it can jump onto furniture or up a wall after it
          this.walk(this.lastKnown.x, this.lastKnown.z, this.seenNow ? 7.5 : 8, dt, this.seenNow ? 3.0 : 1.2);
          const reachable = roach.climb ? roach.pos.y < 4.5 : roach.pos.y < 6.5;
          if (this.seenNow && dist < 5.5 && reachable && this.leapCool <= 0) this.beginPounce(roach, game);
        }
        break;
      }
      case 'pounce': {
        if (this.hop === 0) {
          this.crouch = 1;
          this.body.rotation.z = Math.sin(this.st * 30) * 0.06;
          this.ring.scale.setScalar(1 + Math.sin(this.st * 30) * 0.08);
          if (this.st > 0.4) { this.hop = 1; this.st = 0; this.from = this.pos.clone(); this.sfx.swish(); }
        } else {
          const e = Math.min(1, this.st / 0.4);
          const rise = Math.max(0, this.pounceAt.y - this.from.y);
          this.pos.lerpVectors(this.from, this.pounceAt, e);
          this.pos.y = this.from.y + (this.pounceAt.y - this.from.y) * e + Math.sin(e * Math.PI) * (1.8 + rise * 0.6);
          this.body.rotation.z = 0;
          this.crouch = 0;
          if (e >= 1) {
            this.pos.y = this.pounceAt.y;
            this.world.pushOut(this.pos, 1.3, 3.2);
            this.ring.visible = false;
            game.shake(0.15);
            const dy = roach.pos.y - this.pounceAt.y;
            const hitH = roach.climb ? dy < 3.4 : Math.abs(dy) < 0.8; // can swat a roach low on a wall too
            if (!roach.dead && hdist(roach.pos, this.pounceAt) < 1.3 && dy > -0.5 && hitH) {
              if (roach.climb) roach.detach(true);
              game.damage(35, 'Caught by the cat', { kx: Math.sin(this.facing) * 8, kz: Math.cos(this.facing) * 8, ky: 5 });
            }
            this.knockNear(0.8, 0.7);
            this.sfx.meow();
            person.hear(this.pounceAt, 0.35);
            this.leapCool = 0.8;
            this.setState('rest');
          }
        }
        break;
      }
      case 'paw': {
        const swing = this.st < 0.5 ? 0 : Math.min(1, (this.st - 0.5) / 0.12);
        this.legs[1].p.rotation.x = this.st < 0.5 ? -0.4 - Math.sin(this.st * 20) * 0.15 : -1.5 * swing;
        this.legs[1].p.scale.y = 1 + swing * 0.6;
        this.ring.scale.setScalar(1 + Math.sin(this.st * 30) * 0.08);
        if (this.st >= 0.62 && !this.swiped) {
          this.swiped = true;
          this.ring.visible = false;
          this.sfx.swish();
          if (!roach.dead && hdist(roach.pos, this.pawAt) < 1.4 && roach.pos.y < 1) {
            const ax = this.pos.x - roach.pos.x, az = this.pos.z - roach.pos.z, al = Math.hypot(ax, az) || 1;
            game.damage(20, 'Swatted by the cat', { kx: (ax / al) * 9, kz: (az / al) * 9, ky: 2.5 });
            person.hear(this.pawAt, 0.5);
            game.warn('The cat got you! MEOW!');
            this.sfx.meow();
          }
        }
        if (this.st > 0.95) {
          this.legs[1].p.rotation.x = 0;
          this.legs[1].p.scale.y = 1;
          this.pawCool = rand(0.3, 0.8);
          this.setState(this.hunting ? 'hunt' : 'wander');
        }
        break;
      }
      case 'rest': {
        this.move += (0 - this.move) * 0.1;
        this.crouch += (0 - this.crouch) * 0.1;
        if (this.st > (this.hunting ? 0.5 : 3)) { this.setState(this.hunting ? 'hunt' : 'wander'); this.wait = 0; }
        break;
      }
    }
    // running into chairs, stools, the cupboard... knocks them over
    if (this.state !== 'leap' && this.move * this.curSpeed > 4) this.knockNear(0.35, 1, true);
    this.animate(dt);
    this.updateVisuals();
  }

  walk(x, z, speed, dt, arriveR) {
    this.curSpeed = speed;
    return walkTo(this, x, z, speed * this.speedMul(), dt, arriveR, 1.3, 3.2);
  }

  // Pick something to do: hop down from furniture, jump up onto furniture, or trot somewhere.
  chooseWanderGoal() {
    this.goalLeap = null;
    if (this.pos.y > 0.5) {
      for (let i = 0; i < 12; i++) {
        const a = this.facing + rand(-1.4, 1.4);
        const x = this.pos.x + Math.sin(a) * 3.8, z = this.pos.z + Math.cos(a) * 3.8;
        if (Math.abs(x) < ROOM.hx - 1.6 && Math.abs(z) < ROOM.hz - 1.6 && this.world.isFree(x, 1.5, z, 1.2) && this.world.groundAt(x, z, 0.5) < 0.3) {
          this.beginLeap({ x, y: 0, z });
          return;
        }
      }
    }
    if (Math.random() < 0.5) {
      const tops = this.world.surfaces.filter((s) => s.y > 1 && s.y < 5 && s.maxX - s.minX > 1.6 && s.maxZ - s.minZ > 1.6);
      const s = tops[Math.floor(Math.random() * tops.length)];
      if (s) {
        const L = { x: rand(s.minX + 0.5, s.maxX - 0.5), y: s.y, z: rand(s.minZ + 0.5, s.maxZ - 0.5) };
        const sides = [
          { d: L.x - s.minX, x: s.minX - 2.4, z: L.z },
          { d: s.maxX - L.x, x: s.maxX + 2.4, z: L.z },
          { d: L.z - s.minZ, x: L.x, z: s.minZ - 2.4 },
          { d: s.maxZ - L.z, x: L.x, z: s.maxZ + 2.4 },
        ].sort((a, b) => a.d - b.d);
        const side = sides.find((p) => Math.abs(p.x) < ROOM.hx - 1.5 && Math.abs(p.z) < ROOM.hz - 1.5 && this.world.isFree(p.x, 1.0, p.z, 1.0));
        if (side) { this.goalLeap = L; this.approach = side; return; }
      }
    }
    this.pickTarget();
  }

  beginLeap(to) {
    this.setState('leap');
    this.goalLeap = null;
    this.leapFrom = this.pos.clone();
    this.leapTo = new THREE.Vector3(to.x, to.y, to.z);
    const d = this.leapFrom.distanceTo(this.leapTo);
    this.leapDur = clamp(d / 9, 0.35, 0.7);
    this.facing = Math.atan2(this.leapTo.x - this.pos.x, this.leapTo.z - this.pos.z);
  }

  updateLeap(dt, game) {
    const e = Math.min(1, this.st / this.leapDur);
    const rise = Math.max(0, this.leapTo.y - this.leapFrom.y);
    this.pos.lerpVectors(this.leapFrom, this.leapTo, e);
    this.pos.y = this.leapFrom.y + (this.leapTo.y - this.leapFrom.y) * e + Math.sin(e * Math.PI) * (1.2 + rise * 0.5);
    this.crouch = 0;
    this.move = 0.6;
    if (e >= 1) {
      this.pos.y = this.leapTo.y;
      this.world.pushOut(this.pos, 1.3, 3.2);
      game.shake(0.06);
      this.knockNear(0.8, 0.7); // landing on furniture knocks stuff over
      this.setState(this.hunting ? 'hunt' : 'wander');
      this.wait = rand(1.5, 4);
      this.leapCool = 1.2;
    }
  }

  // Knock over props near the cat (chairs, stools, cupboard, TV).
  // radius = how far past the cat's body it reaches (cat body radius 1.3 + prop size are added)
  knockNear(radius, chance, frontOnly = false) {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    for (const p of this.world.props) {
      if (p.fallen || p.anim || Math.abs(p.base - this.pos.y) > 1.8) continue;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.3 + radius + p.radius) continue;
      if (frontOnly && dx * fx + dz * fz < 0) continue; // only what's in front when running
      if (Math.random() < chance && this.world.knock(p, dx || fx, dz || fz)) this.game?.mess(p, this);
    }
  }

  setState(s) {
    this.state = s;
    this.st = 0;
  }

  pickTarget() {
    const rp = () => new THREE.Vector3(rand(-ROOM.hx + 2.5, ROOM.hx - 2.5), 0, rand(-ROOM.hz + 2.5, ROOM.hz - 2.5));
    for (let i = 0; i < 30; i++) {
      const c = rp();
      if (this.world.pathClear(this.pos, c, 3.2, 1.3)) { this.target.copy(c); return; }
    }
    this.target.copy(rp());
  }

  beginPounce(roach, game) {
    this.setState('pounce');
    this.hop = 0;
    this.pounceAt = roach.pos.clone().addScaledVector(roach.vel, 0.25);
    this.pounceAt.y = this.world.groundAt(this.pounceAt.x, this.pounceAt.z, roach.pos.y + 0.3);
    this.facing = Math.atan2(this.pounceAt.x - this.pos.x, this.pounceAt.z - this.pos.z);
    this.ring.position.set(this.pounceAt.x, this.pounceAt.y + 0.03, this.pounceAt.z);
    this.ring.visible = true;
    game.warn('CAT POUNCE!');
    this.sfx.warn();
  }

  beginPaw(roach, game) {
    this.setState('paw');
    this.swiped = false;
    this.pawAt = roach.pos.clone();
    this.facing = Math.atan2(this.pawAt.x - this.pos.x, this.pawAt.z - this.pos.z);
    this.ring.position.set(this.pawAt.x, 0.03, this.pawAt.z);
    this.ring.visible = true;
    game.warn('The cat is reaching in!');
    this.sfx.warn();
  }

  animate(dt) {
    const sp = this.move;
    for (const L of this.legs) {
      if (this.state === 'paw' && L === this.legs[1]) continue;
      const ph = this.phase * 1.6 + (L.front ? 0 : Math.PI) + (L.s > 0 ? Math.PI / 2 : 0);
      L.p.rotation.x = Math.sin(ph) * 0.5 * sp;
    }
    // tail: curls up at rest, twitches fast when hunting
    const fast = this.hunting || this.state === 'sniff';
    this.tail.rotation.z = Math.sin(this.t * (fast ? 6 : 1.5)) * 0.3;
    this.tailSegs.forEach((s, i) => {
      s.rotation.x = -0.12 - (fast ? 0.02 : 0.06) * i * 0.6;
      s.rotation.y = Math.sin(this.t * (fast ? 7 : 2) - i * 0.5) * (fast ? 0.22 : 0.12);
    });
    this.body.position.y = -this.crouch * 0.7 + (this.state === 'pounce' ? 0 : Math.abs(Math.sin(this.phase * 1.6)) * 0.06 * sp);
    // gravity: the cat can stand on furniture and falls if it walks off the edge
    if (this.state !== 'pounce' && this.state !== 'leap') {
      const g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
      if (this.pos.y > g + 0.02) {
        this.vy -= 30 * dt;
        this.pos.y = Math.max(g, this.pos.y + this.vy * dt);
        if (this.pos.y === g) this.vy = 0;
      } else {
        this.pos.y = g;
        this.vy = 0;
      }
    }
    this.g.position.copy(this.pos);
    this.g.rotation.y = this.facing;
  }

  updateVisuals() {
    const hunting = this.hunting || this.state === 'pounce' || this.state === 'paw';
    this.cone.mat.color.setHex(hunting ? 0xff3b3b : this.state === 'sniff' ? 0xff9cf0 : 0xc9a0ff);
    this.cone.mat.opacity = hunting ? 0.13 : 0.07;
    this.cone.g.position.set(this.pos.x, 0.035, this.pos.z);
    this.cone.g.rotation.y = this.facing;
    this.icon.position.set(this.pos.x + Math.sin(this.facing) * 1.5, 4.6, this.pos.z + Math.cos(this.facing) * 1.5);
    if (hunting) setIcon(this.icon, '!', '#e02424');
    else if (this.state === 'sniff') setIcon(this.icon, '♪', '#c04dff', 0.5 + 0.5 * Math.min(1, this.sniff));
    else if (this.suspicion > 0.05) setIcon(this.icon, '?', '#d99a00', 0.4 + 0.6 * Math.min(1, this.suspicion));
    else this.icon.visible = false;
  }
}
