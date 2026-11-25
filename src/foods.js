import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from './world.js';

const M = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const rand = (a, b) => a + Math.random() * (b - a);

// Nasi lemak on a banana leaf: coconut rice, sambal, half egg, cucumber, peanuts, ikan bilis
function nasiLemak() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.05, 0.06, 30), M(0xf4f4f4, 0.3), 0, 0.03, 0));
  const leaf = mesh(new THREE.CircleGeometry(1.0, 24), M(0x3f8f3a, 0.5, 0, { side: THREE.DoubleSide }), 0, 0.07, 0);
  leaf.rotation.x = -Math.PI / 2;
  leaf.scale.set(1, 0.8, 1);
  g.add(leaf);
  const rice = mesh(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(0xfbf8ef, 0.95), -0.15, 0.07, 0);
  rice.scale.y = 0.9;
  g.add(rice);
  const sambal = mesh(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xa3200e, 0.35), 0.42, 0.07, 0.28);
  sambal.scale.set(1.2, 0.6, 1);
  g.add(sambal);
  const egg = mesh(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xffffff, 0.5), 0.42, 0.07, -0.3);
  egg.scale.set(1, 0.6, 1.3);
  g.add(egg, mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 12), M(0xf5b82e, 0.5), 0.42, 0.2, -0.3));
  for (let i = 0; i < 4; i++) {
    const c = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14), M(0x9bc45a, 0.5), -0.55 + i * 0.12, 0.1, 0.55);
    c.rotation.z = 0.25;
    g.add(c);
  }
  for (let i = 0; i < 14; i++) {
    g.add(mesh(new THREE.SphereGeometry(0.045, 6, 4), M(0xc08a4a, 0.6), 0.1 + rand(-0.15, 0.25), 0.11, 0.55 + rand(-0.08, 0.12)));
    const b = mesh(new THREE.CapsuleGeometry(0.02, 0.1, 2, 4), M(0xb98b4e, 0.5), 0.55 + rand(-0.12, 0.12), 0.1, -0.05 + rand(-0.15, 0.15));
    b.rotation.set(Math.PI / 2, 0, Math.random() * 3);
    g.add(b);
  }
  return g;
}

// A box of donuts: pink icing, chocolate with sprinkles, sugar
function donuts() {
  const g = new THREE.Group();
  const card = M(0xe9d5b0, 0.9);
  g.add(mesh(new THREE.BoxGeometry(1.7, 0.05, 1.3), card, 0, 0.03, 0));
  for (const [x, z, w, d] of [[0, -0.65, 1.7, 0.05], [0, 0.65, 1.7, 0.05], [-0.85, 0, 0.05, 1.3], [0.85, 0, 0.05, 1.3]]) g.add(mesh(new THREE.BoxGeometry(w, 0.35, d), card, x, 0.2, z));
  const dough = M(0xd9a05b, 0.7);
  const icings = [M(0xf48fb1, 0.35), M(0x5a3220, 0.3), M(0xf7f0e0, 0.6), M(0xf48fb1, 0.35)];
  const sprinkleCols = [0xffffff, 0x4fc3f7, 0xffeb3b, 0x81c784];
  [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]].forEach(([x, z], i) => {
    const d = mesh(new THREE.TorusGeometry(0.26, 0.13, 10, 20), dough, x, 0.18, z);
    d.rotation.x = Math.PI / 2;
    const ic = mesh(new THREE.TorusGeometry(0.26, 0.135, 10, 20, Math.PI * 2), icings[i], x, 0.22, z);
    ic.rotation.x = Math.PI / 2;
    ic.scale.z = 0.55;
    g.add(d, ic);
    if (i === 1) for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.12;
      const s = mesh(new THREE.CapsuleGeometry(0.015, 0.05, 2, 4), M(sprinkleCols[k % 4], 0.4), x + Math.cos(a) * r, 0.31, z + Math.sin(a) * r);
      s.rotation.set(Math.PI / 2, 0, Math.random() * 3);
      g.add(s);
    }
  });
  return g;
}

// A pile of rambutans
function rambutan() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.9, 0.75, 0.06, 26), M(0xf4f4f4, 0.3), 0, 0.03, 0));
  const red = M(0xc0172b, 0.55, 0, { flatShading: true }), hair = M(0x6a8f2a, 0.7);
  const spots = [[0, 0.25, 0], [-0.35, 0.22, 0.15], [0.35, 0.22, 0.1], [0.05, 0.22, -0.38], [-0.15, 0.5, -0.05], [0.2, 0.48, 0.12]];
  for (const [x, y, z] of spots) {
    const f = mesh(new THREE.IcosahedronGeometry(0.2, 1), red, x, y, z);
    f.scale.set(1, 1.1, 1);
    g.add(f);
    for (let k = 0; k < 7; k++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
      const h = mesh(new THREE.ConeGeometry(0.02, 0.12, 3), Math.random() < 0.6 ? red : hair, x + dir.x * 0.22, y + dir.y * 0.22, z + dir.z * 0.22);
      h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(h);
    }
  }
  return g;
}

function rubbish() {
  const g = new THREE.Group();
  const bag = mesh(new THREE.DodecahedronGeometry(0.7, 1), M(0x2d2d2d, 0.35), 0, 0.5, 0);
  bag.scale.set(1, 0.75, 0.9);
  g.add(bag);
  const pink = mesh(new THREE.DodecahedronGeometry(0.35, 1), M(0xe57399, 0.4), 0.6, 0.25, -0.4); // plastic bag
  g.add(pink);
  const peel = mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), M(0xf2d13b, 0.6), 0.75, 0.12, 0.35);
  peel.rotation.z = Math.PI / 2;
  peel.rotation.y = 0.6;
  g.add(peel);
  const cup = mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.45, 12), M(0xffffff, 0.6), -0.7, 0.12, 0.3); // teh tarik cup
  cup.rotation.z = Math.PI / 2;
  g.add(cup);
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.15, 0), M(0xf2f2f2, 0.9), Math.cos(i * 1.7) * 0.85, 0.12, Math.sin(i * 1.7) * 0.85));
  return g;
}

function rotiCanai() {
  const g = new THREE.Group();
  const r = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16, 1), M(0xe3b064, 0.85, 0, { flatShading: true }), 0, 0.04, 0);
  r.scale.set(1, 1, 0.8);
  const fold = mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.06, 14), M(0xc98d3e, 0.85, 0, { flatShading: true }), 0.15, 0.09, 0.05);
  g.add(r, fold);
  return g;
}

function chocMalt() {
  const g = new THREE.Group();
  const spill = mesh(new THREE.CircleGeometry(0.9, 18), M(0x6b4226, 1), 0, 0.012, 0);
  spill.rotation.x = -Math.PI / 2;
  spill.scale.set(1.2, 0.8, 1);
  g.add(spill);
  for (let i = 0; i < 10; i++) g.add(mesh(new THREE.SphereGeometry(rand(0.05, 0.12), 6, 4), M(0x5a361e, 1), rand(-0.7, 0.7), 0.03, rand(-0.5, 0.5)));
  const tin = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 18), M(0x2f7d32, 0.3, 0.5), -0.75, 0.35, -0.3);
  tin.rotation.z = Math.PI / 2;
  tin.rotation.y = 0.4;
  g.add(tin);
  return g;
}

// half = solid half-width, h = solid height (so you can't walk through the food)
const DEFS = [
  { name: 'Nasi lemak', protein: 35, x: -15, y: 3.2, z: 11, r: 1.1, half: 0.85, h: 0.5, labelY: 1.3, build: nasiLemak },
  { name: 'Donuts', protein: 20, x: 20, y: 1.8, z: 1.2, r: 0.95, half: 0.8, h: 0.45, labelY: 1.1, build: donuts },
  { name: 'Rubbish', protein: 20, x: -9.5, y: 0, z: -13.2, r: 0.9, half: 0.7, h: 1.0, labelY: 1.6, build: rubbish },
  { name: 'Rambutan', protein: 15, x: -13, y: 4.1, z: -4.5, r: 0.85, half: 0.6, h: 0.6, labelY: 1.2, build: rambutan },
  { name: 'Roti canai', protein: 10, x: 11.2, y: 0, z: -2, r: 0.6, half: 0.45, h: 0.12, labelY: 0.9, build: rotiCanai },
  { name: 'Choc malt spill', protein: 10, x: -20, y: 0, z: -8, r: 0.95, half: 0.45, h: 0.5, labelY: 1.0, build: chocMalt },
];

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,12,6,0.7)';
  g.beginPath();
  g.roundRect(8, 16, 496, 96, 48);
  g.fill();
  g.fillStyle = '#ffd38a';
  g.font = 'bold 50px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Foods {
  constructor(scene, world) {
    this.world = world;
    this.items = DEFS.map((d) => {
      const group = d.build();
      group.position.set(d.x, d.y, d.z);
      group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(group);
      // dozens of little parts (peanuts, sprinkles, rambutan hairs) -> a handful of meshes
      group.updateWorldMatrix(true, true);
      mergeStatic([...group.children], group, group.matrixWorld.clone().invert());
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true, sizeAttenuation: false }));
      label.scale.set(0.3, 0.075, 1);
      label.renderOrder = 9;
      scene.add(label);
      const solid = { minX: 0, maxX: 0, minY: d.y, maxY: d.y, minZ: 0, maxZ: 0 };
      return { ...d, group, label, solid, remaining: d.protein, shown: -1 };
    });
    this.reset();
  }

  // Move the snacks to this room's spots (same order as DEFS)
  place(spots) {
    this.items.forEach((f, i) => {
      const s = spots?.[i];
      if (!s) return;
      [f.x, f.y, f.z] = s;
      f.group.position.set(f.x, f.y, f.z);
    });
  }

  reset() {
    for (const f of this.items) {
      f.remaining = f.protein;
      f.group.visible = f.label.visible = true;
      f.shown = -1;
      this.world.addSolid(f.solid);
      this.refresh(f);
    }
  }

  refresh(f) {
    const k = 0.35 + 0.65 * (f.remaining / f.protein);
    f.group.scale.setScalar(k);
    // the collider shrinks with the food
    Object.assign(f.solid, { minX: f.x - f.half * k, maxX: f.x + f.half * k, minZ: f.z - f.half * k, maxZ: f.z + f.half * k, minY: f.y, maxY: f.y + f.h * k });
    f.label.visible = false; // snacks are just health now: no floating labels
    if (f.remaining <= 0.01) {
      f.group.visible = false;
      this.world.removeSolid(f.solid);
    }
  }

  update() {}

  // Food the roach is close enough to eat (next to it, or standing on it).
  reachable(roach) {
    for (const f of this.items) {
      if (f.remaining <= 0.01) continue;
      const d = Math.hypot(roach.pos.x - f.x, roach.pos.z - f.z);
      if (d < f.r + 0.4 && roach.pos.y - f.y > -0.3 && roach.pos.y - f.y < f.h + 0.4) return f;
    }
    return null;
  }
}
