import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- Performance: merge static meshes
// Hundreds of small static meshes = hundreds of draw calls (twice, with shadows). Bake them into one mesh
// per (material look, shadow flags) bucket. Objects tagged userData.dynamic / .keep, or transparent ones, are left alone.
function matKey(m, mesh) {
  return [m.type, m.color?.getHexString(), m.roughness, m.metalness, m.map?.uuid, m.emissive?.getHexString(), m.emissiveIntensity,
    m.side, m.alphaTest, m.flatShading, m.clearcoat, m.opacity, mesh.castShadow, mesh.receiveShadow].join('|');
}
export function mergeStatic(meshes, parent, inverse = null) {
  const buckets = new Map();
  const done = [];
  for (const m of meshes) {
    if (!m.isMesh || Array.isArray(m.material) || m.material.transparent || m.userData.keep) continue;
    m.updateWorldMatrix(true, false);
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    if (!g.attributes.uv || !g.attributes.normal) continue;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.applyMatrix4(inverse ? inverse.clone().multiply(m.matrixWorld) : m.matrixWorld);
    const key = matKey(m.material, m);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: m.material, geos: [], cast: m.castShadow, recv: m.receiveShadow }));
    b.geos.push(g);
    done.push(m);
  }
  for (const m of done) m.parent?.remove(m);
  const merged = [];
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(b.geos), b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    parent.add(mesh);
    merged.push(mesh);
  }
  return { removed: done, merged };
}

// For animated models: inside every group/pivot, merge its rigid mesh children into one mesh.
// Animation keeps working because pivots (groups) are untouched; only their direct mesh children are baked.
export function compactModel(root) {
  root.updateWorldMatrix(true, true);
  const nodes = [];
  root.traverse((o) => { if (!o.isMesh) nodes.push(o); });
  for (const n of nodes) {
    const kids = n.children.filter((c) => c.isMesh && !c.userData.keep && c.children.length === 0);
    if (kids.length < 2) continue;
    mergeStatic(kids, n, n.matrixWorld.clone().invert());
  }
}

// World units: the roach is ~0.5 long. The condo is 56 (x) by 40 (z) with 16-high walls.
// Kitchen on the west (x < -4), living room on the east.
export const ROOM = { hx: 28, hz: 20, height: 16 };
export const STEP = 0.25; // height the roach can walk up without jumping
export const NEST = { x: 20, y: 10, z: 19.2 }; // hole in the wall just above the tall cupboard: start + escape point
export const CRACK = { x: -1, z: -19.45 }; // crack in the north wall: a second safe spot

const DOWN = new THREE.Vector3(0, -1, 0);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const clampX = (v, m) => clamp(v, -ROOM.hx + m, ROOM.hx - m);
export const clampZ = (v, m) => clamp(v, -ROOM.hz + m, ROOM.hz - m);
export function lerpAngle(a, b, t) {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

// ---------------------------------------------------------------- Procedural textures
function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${alpha * Math.random()})` : `rgba(255,255,255,${alpha * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

const woodTexture = (rx, ry) => canvasTex(512, 512, (g) => {
  const plankH = 64;
  for (let row = 0; row < 8; row++) {
    let x = -Math.random() * 200;
    while (x < 512) {
      const w = 180 + Math.random() * 220;
      g.fillStyle = `hsl(${26 + Math.random() * 6}, 42%, ${36 + Math.random() * 12}%)`;
      g.fillRect(x, row * plankH, w, plankH);
      g.strokeStyle = 'rgba(60,30,10,0.14)';
      for (let k = 0; k < 7; k++) {
        const yy = row * plankH + Math.random() * plankH;
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + w * 0.3, yy + (Math.random() - 0.5) * 8, x + w * 0.6, yy + (Math.random() - 0.5) * 8, x + w, yy);
        g.stroke();
      }
      g.fillStyle = 'rgba(30,15,5,0.55)';
      g.fillRect(x, row * plankH, 2, plankH);
      x += w;
    }
    g.fillStyle = 'rgba(30,15,5,0.55)';
    g.fillRect(0, row * plankH, 512, 2);
  }
  speckle(g, 512, 512, 1500, 0.08);
}, rx, ry);

const tileTexture = (rx, ry, base = [222, 218, 208]) => canvasTex(256, 256, (g) => {
  const n = 4, s = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = Math.random() * 14 - 7;
    g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v})`;
    g.fillRect(i * s, j * s, s, s);
  }
  g.strokeStyle = 'rgba(120,110,95,0.9)';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(256, i * s); g.stroke();
  }
  speckle(g, 256, 256, 600, 0.06);
}, rx, ry);

// Painted plaster: subtle noise, dirtier near the floor, scuffs above the baseboard.
const wallTexture = (rx) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#dccfb6';
  g.fillRect(0, 0, w, h);
  speckle(g, w, h, 5000, 0.05);
  const grad = g.createLinearGradient(0, h * 0.7, 0, h);
  grad.addColorStop(0, 'rgba(80,60,30,0)');
  grad.addColorStop(1, 'rgba(80,60,30,0.18)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(60,45,25,${0.05 + Math.random() * 0.08})`;
    g.beginPath();
    g.ellipse(Math.random() * w, h * (0.86 + Math.random() * 0.1), 10 + Math.random() * 40, 2 + Math.random() * 4, 0, 0, Math.PI * 2);
    g.fill();
  }
}, rx, 1);

const rugTexture = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#8c3b3b';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e8c58a';
  g.lineWidth = 10;
  g.strokeRect(24, 24, w - 48, h - 48);
  g.lineWidth = 4;
  g.strokeRect(48, 48, w - 96, h - 96);
  g.fillStyle = '#2f4a6b';
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    g.save();
    g.translate(110 + i * 73, 110 + j * 73);
    g.rotate(Math.PI / 4);
    g.fillRect(-14, -14, 28, 28);
    g.restore();
  }
  speckle(g, w, h, 8000, 0.12);
});

// ---------------------------------------------------------------- Leaf textures (painted, alpha-cut silhouettes)
// Canvas space: leaf base at the bottom centre, tip at the top.
function leafCanvas(w, h, draw) {
  const t = canvasTex(w, h, draw);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function heartPath(g, w, h, lobe = 0.18) {
  g.beginPath();
  g.moveTo(w / 2, h * 0.97);
  g.bezierCurveTo(w * (0.5 - lobe), h * 1.02, -w * 0.02, h * 0.72, w * 0.05, h * 0.45);
  g.bezierCurveTo(w * 0.1, h * 0.18, w * 0.38, h * 0.02, w / 2, 0);
  g.bezierCurveTo(w * 0.62, h * 0.02, w * 0.9, h * 0.18, w * 0.95, h * 0.45);
  g.bezierCurveTo(w * 1.02, h * 0.72, w * (0.5 + lobe), h * 1.02, w / 2, h * 0.97);
  g.closePath();
}
function veins(g, w, h, color, n, width = 2) {
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineWidth = width * 2;
  g.beginPath(); g.moveTo(w / 2, h * 0.97); g.quadraticCurveTo(w * 0.52, h * 0.5, w / 2, h * 0.03); g.stroke();
  g.lineWidth = width;
  for (let i = 1; i <= n; i++) {
    const y = h * (0.95 - (i / (n + 1)) * 0.88);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(w / 2, y);
      g.quadraticCurveTo(w / 2 + s * w * 0.2, y - h * 0.03, w / 2 + s * w * 0.44, y - h * 0.09);
      g.stroke();
    }
  }
}
let _leafTex = null;
function leafTextures() {
  if (_leafTex) return _leafTex;
  const green = (g, w, h, a, b) => { const gr = g.createLinearGradient(0, h, w, 0); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  _leafTex = {
    monstera: leafCanvas(256, 320, (g, w, h) => {
      heartPath(g, w, h, 0.2);
      g.fillStyle = green(g, w, h, '#1f5a26', '#3f8f3a');
      g.fill();
      veins(g, w, h, 'rgba(170,220,140,0.55)', 7, 2.5);
      // the famous splits and holes
      g.globalCompositeOperation = 'destination-out';
      g.lineCap = 'round';
      for (let i = 1; i <= 6; i++) {
        const y = h * (0.88 - (i / 7) * 0.78);
        for (const s of [-1, 1]) {
          g.lineWidth = 7;
          g.beginPath();
          g.moveTo(w / 2 + s * w * 0.6, y - h * 0.1);
          g.lineTo(w / 2 + s * w * 0.2, y - h * 0.035);
          g.stroke();
          g.beginPath();
          g.ellipse(w / 2 + s * w * 0.13, y - h * 0.02, 5, 9, s * 0.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalCompositeOperation = 'source-over';
    }),
    pothos: leafCanvas(192, 240, (g, w, h) => {
      heartPath(g, w, h, 0.22);
      g.fillStyle = green(g, w, h, '#2f7d32', '#5fb34a');
      g.fill();
      g.save();
      heartPath(g, w, h, 0.22);
      g.clip();
      g.strokeStyle = 'rgba(240,230,120,0.55)';
      g.lineWidth = 6;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(w * Math.random(), h); g.quadraticCurveTo(w * Math.random(), h * 0.5, w * Math.random(), 0); g.stroke(); }
      g.restore();
      veins(g, w, h, 'rgba(210,240,170,0.5)', 4, 2);
    }),
    palm: leafCanvas(256, 512, (g, w, h) => {
      // central rib with many slim leaflets, smaller toward the tip
      for (let i = 0; i < 26; i++) {
        const t = i / 26, y = h * (0.95 - t * 0.9), len = w * 0.46 * (1 - t * 0.55);
        for (const s of [-1, 1]) {
          g.save();
          g.translate(w / 2, y);
          g.rotate(s * (0.95 - t * 0.3));
          const gr = g.createLinearGradient(0, 0, 0, -len);
          gr.addColorStop(0, '#3d7a2e');
          gr.addColorStop(1, '#7cb342');
          g.fillStyle = gr;
          g.beginPath();
          g.ellipse(0, -len / 2, 6 - t * 2, len / 2, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
      g.strokeStyle = '#c6b25a';
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, h * 0.03); g.stroke();
    }),
    snake: leafCanvas(96, 512, (g, w, h) => {
      g.beginPath();
      g.moveTo(w * 0.12, h);
      g.quadraticCurveTo(w * 0.02, h * 0.4, w / 2, 0);
      g.quadraticCurveTo(w * 0.98, h * 0.4, w * 0.88, h);
      g.closePath();
      g.fillStyle = '#e8d44d'; // yellow margin
      g.fill();
      g.save();
      g.beginPath();
      g.moveTo(w * 0.2, h);
      g.quadraticCurveTo(w * 0.1, h * 0.4, w / 2, h * 0.04);
      g.quadraticCurveTo(w * 0.9, h * 0.4, w * 0.8, h);
      g.closePath();
      g.fillStyle = '#2e5b2a';
      g.fill();
      g.clip();
      g.strokeStyle = 'rgba(160,200,120,0.55)';
      g.lineWidth = 6;
      for (let y = 10; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y - 8, w * 0.7, y + 8, w, y - 4); g.stroke(); }
      g.restore();
    }),
    strap: leafCanvas(64, 512, (g, w, h) => {
      g.beginPath();
      g.moveTo(w * 0.15, h);
      g.lineTo(w * 0.1, h * 0.2);
      g.quadraticCurveTo(w / 2, -h * 0.02, w * 0.9, h * 0.2);
      g.lineTo(w * 0.85, h);
      g.closePath();
      g.fillStyle = green(g, w, h, '#2f8a2f', '#6cc04a');
      g.fill();
      g.strokeStyle = 'rgba(210,250,170,0.6)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, h * 0.08); g.stroke();
    }),
  };
  return _leafTex;
}
let _terracotta = null;
const terracottaTexture = () => _terracotta || (_terracotta = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b8653a';
  g.fillRect(0, 0, w, h);
  speckle(g, w, h, 4000, 0.12);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < h; y += 40) g.fillRect(0, y, w, 3);
}));
let _soil = null;
const soilTexture = () => _soil || (_soil = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#3b2a1c';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${60 + Math.random() * 40},${30},${Math.random() * 0.6})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}));

// Family photo: soft background + simple people silhouettes
const photoTexture = (i) => canvasTex(160, 200, (g, w, h) => {
  const bgs = [['#8ecae6', '#ffb703'], ['#f4a261', '#e9c46a'], ['#a8dadc', '#457b9d'], ['#ffcad4', '#f4acb7'], ['#b7e4c7', '#52b788']];
  const [a, b] = bgs[i % bgs.length];
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const n = 1 + (i % 3);
  for (let k = 0; k < n; k++) {
    const cx = w * (k + 1) / (n + 1), s = 0.8 + (k % 2) * 0.25;
    g.fillStyle = ['#5b3a29', '#8d5524', '#3d2b1f'][k % 3];
    g.beginPath(); g.arc(cx, h * 0.45, 16 * s, 0, Math.PI * 2); g.fill();
    g.fillStyle = ['#c1121f', '#1d3557', '#2a9d8f', '#f4a261'][(k + i) % 4];
    g.beginPath(); g.ellipse(cx, h * 0.82, 26 * s, 40 * s, 0, 0, Math.PI * 2); g.fill();
  }
});

// Wall calendar: header + date grid
const calendarTexture = () => canvasTex(160, 220, (g, w, h) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#d62828';
  g.fillRect(0, 0, w, 46);
  g.fillStyle = '#ffffff';
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.fillText('2026', w / 2, 33);
  g.fillStyle = '#333';
  g.font = '15px sans-serif';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
    const d = r * 7 + c + 1;
    if (d > 31) continue;
    g.fillStyle = c === 0 ? '#d62828' : '#333';
    g.fillText(String(d), 14 + c * 21, 76 + r * 32);
  }
});

// Gold flowing calligraphy-style swirls on deep green
const swirlTexture = () => canvasTex(340, 220, (g, w, h) => {
  g.fillStyle = '#0f3d2e';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d4af37';
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    g.lineWidth = 3 + Math.random() * 5;
    g.beginPath();
    let x = 30 + Math.random() * 40, y = h * (0.35 + Math.random() * 0.35);
    g.moveTo(x, y);
    for (let i = 0; i < 6; i++) {
      const nx = x + 30 + Math.random() * 30, ny = h * (0.3 + Math.random() * 0.4);
      g.quadraticCurveTo((x + nx) / 2, y - 40 + Math.random() * 80, nx, ny);
      x = nx; y = ny;
    }
    g.stroke();
  }
  for (let i = 0; i < 12; i++) { g.fillStyle = '#d4af37'; g.beginPath(); g.arc(30 + Math.random() * (w - 60), 30 + Math.random() * (h - 60), 3, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#d4af37';
  g.lineWidth = 4;
  g.strokeRect(10, 10, w - 20, h - 20);
});

// Smashed TV screen: dark glass with cracks radiating from the impact point
const crackedScreenTexture = () => {
  const t = canvasTex(512, 280, (g, w, h) => {
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, w, h);
    const cx = w * 0.42, cy = h * 0.55;
    g.strokeStyle = 'rgba(220,235,255,0.8)';
    for (let i = 0; i < 22; i++) {
      let x = cx, y = cy, a = (i / 22) * Math.PI * 2;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 12; k++) { a += (Math.random() - 0.5) * 0.5; x += Math.cos(a) * 26; y += Math.sin(a) * 26; g.lineTo(x, y); }
      g.stroke();
    }
    for (let r = 20; r < 120; r += 30) { g.beginPath(); g.arc(cx, cy, r + Math.random() * 10, 0, Math.PI * 2); g.stroke(); }
    // dead pixels / colour bleed
    for (let i = 0; i < 6; i++) { g.fillStyle = ['#ff00aa', '#00ffd0', '#ffffff'][i % 3]; g.fillRect(Math.random() * w, 0, 2 + Math.random() * 4, h); }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

// Woven rattan
const rattanTexture = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b8894f';
  g.fillRect(0, 0, w, h);
  const s = 16;
  for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
    const horiz = ((x + y) / s) % 2 === 0;
    const grad = horiz ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y);
    grad.addColorStop(0, '#8a6230');
    grad.addColorStop(0.5, '#dcb77c');
    grad.addColorStop(1, '#8a6230');
    g.fillStyle = grad;
    g.fillRect(x + 1, y + 1, s - 2, s - 2);
  }
}, 2, 2);

// Batik: wavy bands + flower motifs
const batikTexture = (variant) => canvasTex(512, 384, (g, w, h) => {
  const pal = [
    ['#7a1f1f', '#e8a33d', '#f5e6c8', '#2c4a6e'],
    ['#1f4e5f', '#f2c14e', '#f7f3e3', '#b5432a'],
    ['#4a2c5e', '#e07a5f', '#f4f1de', '#3d8a5a'],
  ][variant % 3];
  g.fillStyle = pal[0];
  g.fillRect(0, 0, w, h);
  g.lineWidth = 6;
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = i % 2 ? pal[1] : pal[3];
    g.beginPath();
    for (let x = 0; x <= w; x += 8) g.lineTo(x, 40 + i * 60 + Math.sin(x / 40 + i) * 14);
    g.stroke();
  }
  for (let k = 0; k < 9; k++) {
    const cx = 60 + (k % 3) * 190, cy = 70 + Math.floor(k / 3) * 120;
    for (let p = 0; p < 6; p++) {
      g.fillStyle = p % 2 ? pal[1] : pal[2];
      g.beginPath();
      g.ellipse(cx + Math.cos((p / 6) * Math.PI * 2) * 18, cy + Math.sin((p / 6) * Math.PI * 2) * 18, 16, 8, (p / 6) * Math.PI * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = pal[3];
    g.beginPath();
    g.arc(cx, cy, 9, 0, Math.PI * 2);
    g.fill();
  }
  speckle(g, w, h, 3000, 0.1);
});

// A jagged crack with branches, transparent background.
const crackTexture = () => {
  const t = canvasTex(256, 768, (g, w, h) => {
    // Zig-zag that keeps heading in its base direction, with thinner branches
    const paths = [];
    const line = (x, y, len, base, width, depth) => {
      const pts = [[x, y]];
      let angle = base;
      for (let i = 0; i < len; i++) {
        angle = base + (angle - base) * 0.5 + (Math.random() - 0.5) * 1.3;
        x = Math.max(6, Math.min(w - 6, x + Math.sin(angle) * 10));
        y -= Math.cos(angle) * 10;
        pts.push([x, y]);
        if (depth > 0 && Math.random() < 0.1) line(x, y, Math.floor(len * 0.3), base + (Math.random() < 0.5 ? -1 : 1) * rand(0.6, 1.1), width * 0.5, depth - 1);
        if (y < 10) break;
      }
      paths.push({ pts, width });
    };
    line(w / 2, h - 30, 70, 0.05, 8, 2);
    g.lineCap = g.lineJoin = 'round';
    for (const [color, extra, dx] of [['rgba(255,250,240,0.55)', 2, 2], ['rgba(30,20,12,0.95)', 0, 0]]) {
      for (const p of paths) {
        g.strokeStyle = color;
        g.lineWidth = p.width + extra;
        g.beginPath();
        p.pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dx) : g.moveTo(x + dx, y + dx)));
        g.stroke();
      }
    }
    // gap at the floor that the roach can squeeze into
    g.fillStyle = '#0a0604';
    g.beginPath();
    g.moveTo(w / 2 - 28, h);
    g.lineTo(w / 2 - 4, h - 46);
    g.lineTo(w / 2 + 8, h - 40);
    g.lineTo(w / 2 + 30, h);
    g.fill();
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

// ---------------------------------------------------------------- World
export class World {
  constructor(scene) {
    this.scene = scene;
    this.solids = []; // AABBs used for collision
    this.occluders = []; // meshes the camera should not go through
    this.surfaces = []; // tops where crumbs can spawn
    this.lamps = []; // {x, y, z, color} for point lights
    this.fans = []; // spinning fan blades {obj, axis, speed}
    this.props = []; // things the cat can knock over
    this.onCrash = null; // set by the game: called when a prop hits the floor
    this.dynamic = []; // moving colliders (characters), refreshed each frame
    this.walkGroups = []; // plant leaves you can stand on (exact surface, not boxes)
    this._ray = new THREE.Raycaster();
    this.build();
    this.optimize();
  }

  mat(color, rough = 0.8, metal = 0, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  }

  // Solid furniture block (rounded edges). Pass solid:false for decoration.
  box({ x, z, w, d, y0, h, color, solid = true, rough = 0.8, metal = 0, surface = false, emissive, round = 0.06, map, mat }) {
    const r = Math.min(round, Math.min(w, h, d) * 0.45);
    const geo = r > 0.01 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
    const material = mat || this.mat(color, rough, metal, map ? { map } : {});
    if (emissive) material.emissive = new THREE.Color(emissive);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (solid) {
      this.solids.push({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2 });
      this.occluders.push(mesh);
    }
    if (surface) {
      this.surfaces.push({ minX: x - w / 2 + 0.3, maxX: x + w / 2 - 0.3, minZ: z - d / 2 + 0.3, maxZ: z + d / 2 - 0.3, y: y0 + h });
    }
    return mesh;
  }

  // Extra object. Solid by default so the roach can't walk through it (its bounding box becomes a collider).
  deco(geo, material, x, y, z, rot = [0, 0, 0], solid = true) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.set(...rot);
    // only things big enough to matter cast shadows (each shadow caster costs every frame)
    geo.computeBoundingBox();
    const sz = geo.boundingBox.getSize(new THREE.Vector3());
    m.castShadow = sz.x * sz.y * sz.z > 0.6 || Math.max(sz.x, sz.y, sz.z) > 2.5;
    m.receiveShadow = true;
    this.scene.add(m);
    if (solid) this.solidFrom(m);
    return m;
  }

  solidFrom(obj) {
    obj.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(obj);
    const s = { minX: b.min.x, maxX: b.max.x, minY: Math.max(0, b.min.y), maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
    this.solids.push(s);
    obj.traverse((o) => { if (o.isMesh) this.occluders.push(o); });
    return s;
  }

  addSolid(s) { if (!this.solids.includes(s)) this.solids.push(s); }
  removeSolid(s) { const i = this.solids.indexOf(s); if (i >= 0) this.solids.splice(i, 1); }

  // Moving bodies (human feet/legs, cat, car) as vertical cylinders, refreshed every frame.
  pushOutDynamic(pos, radius, height) {
    for (const c of this.dynamic) {
      if (pos.y + height <= c.y0 || pos.y >= c.y1 - 0.05) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d >= min) continue;
      if (d > 1e-5) { pos.x += (dx / d) * (min - d); pos.z += (dz / d) * (min - d); }
      else pos.x += min;
    }
  }

  // A potted plant with smooth, realistic leaves. kind: 'palm' | 'monstera' | 'snake' | 'pothos' | 'pandan'
  // Leaves are curved, bent planes with a painted leaf texture (alpha-cut silhouette, veins, variegation).
  plant(x, z, kind, y = 0, scale = 1) {
    const small = kind === 'pothos' || kind === 'pandan';
    const potH = (small ? 0.9 : 2.4) * scale;
    const potR = (small ? 0.55 : 1.2) * scale;
    // rounded pot from a lathe profile, with a lip
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      prof.push(new THREE.Vector2(potR * (0.74 + 0.26 * Math.sin(t * Math.PI * 0.55)) , t * potH));
    }
    prof.push(new THREE.Vector2(potR * 1.06, potH), new THREE.Vector2(potR * 1.06, potH + 0.08 * scale), new THREE.Vector2(potR * 0.94, potH + 0.08 * scale));
    const potMat = kind === 'snake'
      ? new THREE.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.25, clearcoat: 0.8 })
      : this.mat(0xc0703f, 0.75, 0, { map: terracottaTexture() });
    const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), potMat);
    pot.position.set(x, y, z);
    pot.castShadow = pot.receiveShadow = true;
    this.scene.add(pot);
    this.solidFrom(pot);
    this.surfaces.push({ minX: x - potR * 0.5, maxX: x + potR * 0.5, minZ: z - potR * 0.5, maxZ: z + potR * 0.5, y: y + potH });
    const soil = new THREE.Mesh(new THREE.CircleGeometry(potR * 0.93, 40), this.mat(0xffffff, 1, 0, { map: soilTexture() }));
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(x, y + potH - 0.04, z);
    soil.receiveShadow = true;
    this.scene.add(soil);

    const top = new THREE.Vector3(x, y + potH - 0.05, z);
    const soft = []; // leaves: no box collider, the roach walks on their real surface instead
    const tex = leafTextures();
    const stemMat = this.mat(kind === 'palm' ? 0x6f8f3a : 0x3e6b2a, 0.6);

    // One leaf: stem (smooth tube) from the soil out to the leaf base, then a curved leaf blade
    const leaf = ({ angle, reach, height, len, wid, droop, cup = 0.12, twist = 0, map, pitch = 0.25, stem = true }) => {
      const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const base = top.clone().addScaledVector(dir, reach * scale);
      base.y += height * scale;
      if (stem) {
        const mid = top.clone().addScaledVector(dir, reach * scale * 0.35);
        mid.y += height * scale * 0.75;
        const curve = new THREE.CatmullRomCurve3([top.clone().add(new THREE.Vector3(0, -0.05, 0)), mid, base]);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035 * scale, 6), stemMat);
        tube.castShadow = true;
        this.scene.add(tube);
      }
      const L = len * scale, W = wid * scale;
      const geo = new THREE.PlaneGeometry(W, L, 8, 18);
      geo.translate(0, L / 2, 0);
      geo.rotateX(Math.PI / 2); // lies flat, pointing +z
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vz = p.getZ(i);
        const t = vz / L, sx = vx / (W / 2);
        let vy = -droop * t * t * L + cup * sx * sx * W; // arch down towards the tip, cup the sides up
        const tw = twist * t;
        p.setXYZ(i, vx * Math.cos(tw), vy + vx * Math.sin(tw), vz);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0 });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(base);
      m.rotation.order = 'YXZ';
      m.rotation.y = angle;
      m.rotation.x = -pitch;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      m.userData.keep = true; // stays separate: the roach walks on it
      m.updateWorldMatrix(true, true);
      soft.push(m);
      return m;
    };

    if (kind === 'monstera') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
        leaf({ angle: a, reach: rand(0.3, 0.9), height: rand(1.6, 3.6), len: rand(1.8, 2.4), wid: rand(1.6, 2.0), droop: rand(0.25, 0.4), cup: 0.08, map: tex.monstera, pitch: rand(0.05, 0.35) });
      }
    } else if (kind === 'palm') {
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + rand(-0.15, 0.15);
        leaf({ angle: a, reach: rand(0.2, 0.5), height: rand(3.2, 5.2), len: rand(3.2, 4.2), wid: 1.6, droop: rand(0.45, 0.7), cup: -0.05, twist: rand(-0.3, 0.3), map: tex.palm, pitch: rand(0.35, 0.7) });
      }
    } else if (kind === 'snake') {
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2;
        // upright blades: pitch them almost straight up
        leaf({ angle: a, reach: rand(0, 0.35), height: 0.05, len: rand(2.6, 4.2), wid: 0.42, droop: -0.02, cup: 0.25, twist: rand(-0.5, 0.5), map: tex.snake, pitch: Math.PI / 2 - rand(0.05, 0.25), stem: false });
      }
    } else if (kind === 'pandan') {
      for (let i = 0; i < 10; i++) {
        leaf({ angle: (i / 10) * Math.PI * 2, reach: 0.05, height: 0.05, len: rand(1.1, 1.5), wid: 0.2, droop: 0.55, cup: 0.3, map: tex.strap, pitch: rand(0.7, 1.1), stem: false });
      }
    } else {
      // pothos: heart leaves spilling over the rim on trailing vines
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
        leaf({ angle: a, reach: rand(0.35, 0.75), height: rand(-0.15, 0.35), len: rand(0.38, 0.5), wid: rand(0.32, 0.42), droop: 0.3, cup: 0.15, map: tex.pothos, pitch: rand(-0.3, 0.4) });
      }
    }
    // merge this plant's leaves into one mesh (one draw call); the roach still walks on the merged surface
    for (const m of soft) m.userData.keep = false;
    const { merged } = mergeStatic(soft, this.scene);
    for (const m of merged) { m.userData.keep = true; m.castShadow = true; m.receiveShadow = true; }
    const box = new THREE.Box3();
    for (const m of merged) box.expandByObject(m);
    box.expandByScalar(0.3);
    this.walkGroups.push({ meshes: merged, box });
  }

  // Would moving (sx, sz) push the roach through the side of a leaf?
  leafBlock(pos, sx, sz) {
    const len = Math.hypot(sx, sz);
    if (len < 1e-6) return false;
    for (const grp of this.walkGroups) {
      const b = grp.box;
      if (pos.x < b.min.x - 0.5 || pos.x > b.max.x + 0.5 || pos.z < b.min.z - 0.5 || pos.z > b.max.z + 0.5 || pos.y > b.max.y || pos.y + 0.3 < b.min.y) continue;
      this._ray.set(new THREE.Vector3(pos.x, pos.y + 0.1, pos.z), new THREE.Vector3(sx / len, 0, sz / len));
      this._ray.far = len + 0.25;
      for (const h of this._ray.intersectObjects(grp.meshes, false)) {
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (Math.abs(n.y) < 0.75) return true;
      }
    }
    return false;
  }

  // Exact surface under (x, z) on walkable meshes (plant leaves), or null. Returns height + surface normal.
  meshGroundAt(x, z, y) {
    let best = null;
    for (const grp of this.walkGroups) {
      const b = grp.box;
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || y > b.max.y + 0.6 || y + STEP < b.min.y) continue;
      this._ray.set(new THREE.Vector3(x, y + STEP + 0.05, z), DOWN);
      this._ray.far = STEP + 0.65;
      for (const h of this._ray.intersectObjects(grp.meshes, false)) {
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y < 0) n.negate();
        if (n.y < 0.35) continue; // too steep to stand on
        if (!best || h.point.y > best.y) best = { y: h.point.y, normal: n };
        break;
      }
    }
    return best;
  }

  table(x, z, w, d, topY, color, legColor) {
    this.box({ x, z, w, d, y0: topY - 0.3, h: 0.3, color, surface: true, rough: 0.5 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.box({ x: x + sx * (w / 2 - 0.35), z: z + sz * (d / 2 - 0.35), w: 0.3, d: 0.3, y0: 0, h: topY - 0.3, color: legColor });
    }
  }

  // A dining chair the cat can knock over
  chair(x, z, backSide, color) {
    const m = this.mat(color, 0.7);
    this.prop('chair', x, 0, z, (add) => {
      add(new RoundedBoxGeometry(2.2, 0.25, 2.2, 2, 0.06), m, 0, 1.925, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.22, 1.8, 0.22), m, sx * 0.95, 0.9, sz * 0.95);
      add(new RoundedBoxGeometry(2.2, 2.6, 0.22, 2, 0.06), m, 0, 3.35, backSide * 1.0);
    });
  }

  // ---------------------------------------------------------------- Knock-over props
  // build(add) adds meshes in local coords (origin = bottom centre). Each mesh gets its own collider.
  prop(name, x, y, z, build, opts = {}) {
    const g = new THREE.Group();
    g.userData.dynamic = true; // can be knocked over: don't merge
    build((geo, mat, px, py, pz, rot) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      if (rot) m.rotation.set(...rot);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    });
    g.position.set(x, y, z);
    this.scene.add(g);
    g.traverse((o) => { if (o.isMesh) this.occluders.push(o); });
    const b = new THREE.Box3().setFromObject(g);
    const p = {
      name, group: g, base: y, x, z,
      radius: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2,
      home: { pos: g.position.clone(), quat: g.quaternion.clone() },
      solids: this.meshSolids(g), fallen: false, anim: null, ...opts,
    };
    this.props.push(p);
    return p;
  }

  meshSolids(g) {
    g.updateWorldMatrix(true, true);
    const out = [];
    for (const m of g.children) {
      if (!m.isMesh || m.userData.noCollide) continue;
      const b = new THREE.Box3().setFromObject(m);
      const s = { minX: b.min.x, maxX: b.max.x, minY: Math.max(0, b.min.y), maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
      this.solids.push(s);
      out.push(s);
    }
    return out;
  }

  // Tip a prop over in the direction (dx, dz). Returns true if it starts falling.
  knock(p, dx, dz) {
    if (p.fallen || p.anim) return false;
    if (p.fallDir) [dx, dz] = p.fallDir;
    const dir = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx) || 1, 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz) || 1);
    const b = new THREE.Box3().setFromObject(p.group);
    const edge = new THREE.Vector3(
      dir.x > 0 ? b.max.x : dir.x < 0 ? b.min.x : (b.min.x + b.max.x) / 2,
      b.min.y,
      dir.z > 0 ? b.max.z : dir.z < 0 ? b.min.z : (b.min.z + b.max.z) / 2
    );
    const pivot = new THREE.Group();
    pivot.position.copy(edge);
    this.scene.add(pivot);
    pivot.attach(p.group);
    p.anim = { pivot, axis: new THREE.Vector3(dir.z, 0, -dir.x), t: 0, vy: 0, crashed: false };
    for (const s of p.solids) this.removeSolid(s);
    p.solids = [];
    return true;
  }

  updateProps(dt) {
    for (const p of this.props) {
      const a = p.anim;
      if (!a) continue;
      a.t += dt;
      const T = p.fallTime || 0.55;
      const ang = a.t < T
        ? (a.t / T) ** 2 * (Math.PI / 2)
        : Math.PI / 2 - Math.abs(Math.sin((a.t - T) * 14)) * 0.12 * Math.exp(-(a.t - T) * 6);
      a.pivot.quaternion.setFromAxisAngle(a.axis, ang);
      if (a.t >= T) {
        if (!a.crashed) {
          a.crashed = true;
          p.onBreak?.();
          this.onCrash?.(p);
        }
        // keep falling onto whatever is underneath (e.g. the TV slides off its cabinet to the floor)
        a.pivot.updateWorldMatrix(true, true);
        const b = new THREE.Box3().setFromObject(p.group);
        const ground = this.groundAt((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, b.min.y + 0.05);
        if (b.min.y > ground + 0.01) {
          a.vy -= 30 * dt;
          a.pivot.position.y += Math.max(a.vy * dt, ground - b.min.y);
        }
      }
      if (a.t > 1.5) {
        p.anim = null;
        p.fallen = true;
        p.solids = this.meshSolids(p.group);
      }
    }
  }

  resetProps() {
    for (const p of this.props) {
      const parent = p.group.parent;
      if (parent !== this.scene) {
        this.scene.attach(p.group);
        this.scene.remove(parent);
      }
      p.group.position.copy(p.home.pos);
      p.group.quaternion.copy(p.home.quat);
      for (const s of p.solids) this.removeSolid(s);
      p.solids = this.meshSolids(p.group);
      p.anim = null;
      p.fallen = false;
      p.onReset?.();
    }
  }

  build() {
    const { hx, hz, height: RH } = ROOM;
    const S = this.scene;

    // ---------- Floors: big glossy porcelain tiles in the living room, smaller grey tiles in the kitchen (typical Malaysian condo)
    const living = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), this.mat(0xffffff, 0.22, 0, { map: tileTexture((hx * 2) / 8, (hz * 2) / 8, [226, 214, 192]) }));
    living.rotation.x = -Math.PI / 2;
    living.receiveShadow = true;
    S.add(living);
    const kitchenW = 24;
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(kitchenW, hz * 2), this.mat(0xffffff, 0.35, 0, { map: tileTexture(kitchenW / 3, (hz * 2) / 3, [190, 192, 190]) }));
    tiles.rotation.x = -Math.PI / 2;
    tiles.position.set(-hx + kitchenW / 2, 0.004, 0);
    tiles.receiveShadow = true;
    S.add(tiles);

    // ---------- Ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), this.mat(0xf4f1ea, 0.95));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = RH;
    S.add(ceil);

    // ---------- Walls (planes facing inward) + baseboards
    const walls = [
      { x: 0, z: -hz, ry: 0, len: hx * 2 },
      { x: 0, z: hz, ry: Math.PI, len: hx * 2 },
      { x: -hx, z: 0, ry: Math.PI / 2, len: hz * 2 },
      { x: hx, z: 0, ry: -Math.PI / 2, len: hz * 2 },
    ];
    const baseMat = this.mat(0xf5f2ea, 0.5);
    for (const W of walls) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W.len, RH), this.mat(0xffffff, 0.95, 0, { map: wallTexture(W.len / 16) }));
      m.position.set(W.x, RH / 2, W.z);
      m.rotation.y = W.ry;
      m.receiveShadow = true;
      S.add(m);
      this.occluders.push(m);
      const bb = new THREE.Mesh(new THREE.BoxGeometry(W.len, 0.6, 0.15), baseMat);
      bb.position.set(W.x - Math.sign(W.x) * 0.075, 0.3, W.z - Math.sign(W.z) * 0.075);
      bb.rotation.y = W.ry;
      bb.receiveShadow = true;
      S.add(bb);
    }

    // ---------- The crack in the north wall (floor gap = hiding spot)
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 7.8), new THREE.MeshStandardMaterial({ map: crackTexture(), transparent: true, roughness: 1, depthWrite: false }));
    crack.position.set(CRACK.x, 3.9, -hz + 0.17);
    crack.renderOrder = 1;
    S.add(crack);
    // a few plaster chips on the floor under it
    const chipMat = this.mat(0xe6dcc6, 1);
    for (let i = 0; i < 6; i++) {
      this.deco(new THREE.DodecahedronGeometry(0.06 + Math.random() * 0.06, 0), chipMat, CRACK.x + rand(-0.9, 0.9), 0.05, -hz + rand(0.3, 1.1));
    }

    // ---------- The nest: a tall old cupboard (almari) against the south wall, with a hole in the wall just above it
    const almari = this.mat(0x5e3b22, 0.55);
    this.box({ x: 20, z: 18.4, w: 5.2, d: 3.0, y0: 0, h: 9.7, mat: almari, round: 0.05 });
    this.box({ x: 20, z: 18.4, w: 5.6, d: 3.3, y0: 9.7, h: 0.3, mat: almari, surface: false, round: 0.04 });
    const panel = this.mat(0x6e4a2c, 0.5);
    for (const dx of [-1.28, 1.28]) {
      this.deco(new RoundedBoxGeometry(2.4, 6.2, 0.08, 2, 0.04), panel, 20 + dx, 6.2, 16.88, [0, 0, 0], false);
      this.deco(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), this.mat(0xc9a227, 0.25, 0.9), 20 + dx * 0.15, 6.2, 16.8, [0, 0, 0], false);
    }
    for (const y of [1.0, 2.4]) {
      this.deco(new RoundedBoxGeometry(5.0, 1.2, 0.08, 2, 0.04), panel, 20, y, 16.88, [0, 0, 0], false);
      this.deco(new THREE.BoxGeometry(0.9, 0.12, 0.12), this.mat(0xc9a227, 0.25, 0.9), 20, y, 16.8, [0, 0, 0], false);
    }
    // junk on top: old box and newspapers (roach paradise)
    this.deco(new THREE.BoxGeometry(1.8, 1.1, 1.4), this.mat(0xb08a5a, 0.95), 18.4, 10.55, 18.6, [0, 0.2, 0]);
    this.deco(new THREE.BoxGeometry(1.4, 0.25, 0.9), this.mat(0xd8d2c0, 1), 22.0, 10.12, 17.3, [0, -0.3, 0]); // newspapers (front corner, out of the cutscene)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050302 }));
    hole.position.set(NEST.x, NEST.y + 0.01, hz - 0.02);
    hole.rotation.y = Math.PI;
    S.add(hole);
    this.nestGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.95, 24, 1, 0, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.9 })
    );
    this.nestGlow.position.set(NEST.x, NEST.y + 0.01, hz - 0.03);
    this.nestGlow.rotation.y = Math.PI;
    this.nestGlow.visible = false;
    S.add(this.nestGlow);

    // ================================================================ KITCHEN (west)
    const cabinet = 0x6f8f8a, top = 0xd8d6d0, steel = 0xc9ccd0;
    // Fridge
    this.box({ x: -25.95, z: -17.95, w: 3.9, d: 3.9, y0: 0, h: 10, color: steel, rough: 0.25, metal: 0.6, surface: true, round: 0.2 });
    this.deco(new THREE.BoxGeometry(0.15, 3, 0.15), this.mat(0x444444, 0.3, 0.8), -24.6, 6.5, -15.95);
    // North counter run (0.5 gap under = toe-kick hiding spot)
    this.box({ x: -13.9, z: -18.5, w: 19.8, d: 3, y0: 0.5, h: 3.3, color: cabinet, rough: 0.6 });
    this.box({ x: -13.9, z: -18.4, w: 19.8, d: 3.2, y0: 3.8, h: 0.3, color: top, rough: 0.3, surface: true, round: 0.04 });
    for (let x = -22.8; x < -4; x += 2.5) this.deco(new THREE.BoxGeometry(0.9, 0.1, 0.1), this.mat(0x333333, 0.3, 0.8), x, 3.3, -16.95);
    // Backsplash tiles
    const splash = new THREE.Mesh(new THREE.PlaneGeometry(19.8, 3.9), this.mat(0xffffff, 0.3, 0, { map: tileTexture(10, 2, [200, 215, 220]) }));
    splash.position.set(-13.9, 6.05, -hz + 0.02);
    S.add(splash);
    // Sink + faucet
    this.deco(new THREE.BoxGeometry(3, 0.05, 2), this.mat(0x9aa0a6, 0.2, 0.8), -17, 4.12, -18.3);
    this.deco(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), this.mat(steel, 0.2, 0.9), -17, 4.9, -19.5);
    this.deco(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8), this.mat(steel, 0.2, 0.9), -17, 5.65, -19.05, [Math.PI / 2, 0, 0]);
    // Cooktop + burners + range hood
    this.deco(new THREE.BoxGeometry(3.2, 0.06, 2.4), this.mat(0x111111, 0.2, 0.3), -9, 4.13, -18.4);
    for (const [bx, bz] of [[-9.8, -17.8], [-8.2, -17.8], [-9.8, -19], [-8.2, -19]]) {
      this.deco(new THREE.TorusGeometry(0.4, 0.05, 6, 20), this.mat(0x555555, 0.4, 0.6), bx, 4.17, bz, [Math.PI / 2, 0, 0]);
    }
    this.box({ x: -9, z: -18.9, w: 3.4, d: 2.2, y0: 7, h: 1, color: steel, rough: 0.3, metal: 0.6, surface: true });
    // Pot on the stove
    this.deco(new THREE.CylinderGeometry(0.6, 0.55, 0.8, 18), this.mat(0x8a8f96, 0.3, 0.8), -8.2, 4.56, -17.8);
    // Upper cabinets
    this.box({ x: -15, z: -19.3, w: 10.6, d: 1.4, y0: 8, h: 4, color: cabinet, rough: 0.6, surface: true });
    this.box({ x: -5.4, z: -19.3, w: 2.8, d: 1.4, y0: 8, h: 4, color: cabinet, rough: 0.6, surface: true });
    // West counter
    this.box({ x: -26.5, z: -6.75, w: 3, d: 17.5, y0: 0.5, h: 3.3, color: cabinet, rough: 0.6 });
    this.box({ x: -26.4, z: -6.75, w: 3.2, d: 17.5, y0: 3.8, h: 0.3, color: top, rough: 0.3, surface: true, round: 0.04 });
    // Microwave + kettle + dish rack
    this.box({ x: -26.4, z: -10, w: 1.8, d: 3, y0: 4.1, h: 1.8, color: 0x222222, rough: 0.3, metal: 0.4, surface: true });
    this.deco(new THREE.PlaneGeometry(2.2, 1.3), this.mat(0x0d1a22, 0.1, 0.5), -25.48, 5.0, -10.3, [0, Math.PI / 2, 0]);
    this.deco(new THREE.CylinderGeometry(0.45, 0.55, 1.1, 16), this.mat(0xe85d4a, 0.3, 0.2), -26.4, 4.65, -3);
    this.deco(new THREE.BoxGeometry(1.8, 0.6, 1.4), this.mat(0xcccccc, 0.4, 0.6), -26.4, 4.4, 0);
    // Kitchen island + stools
    this.box({ x: -15, z: -4, w: 7, d: 3, y0: 0, h: 3.8, color: 0x3e5560, rough: 0.6 });
    this.box({ x: -15, z: -3.5, w: 7.6, d: 4.6, y0: 3.8, h: 0.3, color: 0xefeeea, rough: 0.25, surface: true, round: 0.04 });
    const stoolSeat = this.mat(0x2a2a2a, 0.5), chrome = this.mat(0x888888, 0.3, 0.8);
    for (const x of [-17, -15, -13]) {
      this.prop('bar stool', x, 0, -0.3, (add) => {
        add(new THREE.CylinderGeometry(0.7, 0.65, 0.25, 18), stoolSeat, 0, 3.02, 0);
        add(new THREE.CylinderGeometry(0.12, 0.12, 2.9, 10), chrome, 0, 1.45, 0);
        add(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 16), chrome, 0, 0.04, 0);
      });
    }
    // Tall slim cupboard by the dining area (the cat can topple it!)
    const cup = this.mat(0x8a6240, 0.55), cupDoor = this.mat(0x9c7350, 0.5);
    this.prop('cupboard', -2.4, 0, 18.3, (add) => {
      add(new RoundedBoxGeometry(2.6, 8, 1.8, 2, 0.05), cup, 0, 4, 0);
      const d1 = add(new RoundedBoxGeometry(1.2, 7.2, 0.06, 2, 0.02), cupDoor, -0.62, 4.1, -0.92);
      const d2 = add(new RoundedBoxGeometry(1.2, 7.2, 0.06, 2, 0.02), cupDoor, 0.62, 4.1, -0.92);
      const vase = add(new THREE.CylinderGeometry(0.3, 0.45, 1.2, 14), this.mat(0x2e86ab, 0.2, 0.2), 0.4, 8.6, 0);
      for (const m of [d1, d2, vase]) m.userData.noCollide = true;
    }, { fallDir: [0, -1], fallTime: 0.8 });
    // Dining table + chairs + pendant
    this.table(-15, 11, 7.5, 4.5, 3.2, 0x8b5a2b, 0x5e3a1a);
    for (const x of [-17, -13]) {
      this.chair(x, 7.6, -1, 0x7b4a22);
      this.chair(x, 14.4, 1, 0x7b4a22);
    }
    this.deco(new THREE.CylinderGeometry(0.03, 0.03, 4, 6), this.mat(0x222222), -15, 14, 11);
    this.deco(new THREE.ConeGeometry(1.1, 1.0, 20, 1, true), this.mat(0x2b2b2b, 0.5, 0.3, { side: THREE.DoubleSide }), -15, 11.6, 11);
    this.lamps.push({ x: -15, y: 11.2, z: 11, color: 0xffd9a0, power: 1 });
    // Trash bin
    this.box({ x: -6, z: -15, w: 2, d: 2, y0: 0, h: 3, color: 0x7d8b7d, rough: 0.4, metal: 0.4, surface: true, round: 0.15 });

    // ================================================================ LIVING ROOM (east)
    const fabric = 0x4d6b8a, fabric2 = 0x3f5a75;
    // L-shaped sofa facing the TV (0.5 gap under = hiding spot)
    this.box({ x: 11.25, z: 0, w: 3.5, d: 12, y0: 0.5, h: 1.1, color: fabric2, rough: 1 });
    for (const z of [-4, 0, 4]) this.box({ x: 11.4, z, w: 3.3, d: 3.9, y0: 1.6, h: 0.5, color: fabric, rough: 1, surface: true, round: 0.2 });
    this.box({ x: 9.1, z: 0, w: 1.2, d: 12, y0: 0.5, h: 4.2, color: fabric2, rough: 1, round: 0.3 });
    for (const z of [-3, 3]) this.deco(new RoundedBoxGeometry(0.9, 2.2, 6.0, 2, 0.35), this.mat(fabric, 1), 10.1, 3.0, z, [0, 0, -0.15]);
    this.box({ x: 10.75, z: -6.45, w: 4.5, d: 0.9, y0: 0.5, h: 2.6, color: fabric2, rough: 1, surface: true, round: 0.3 });
    this.box({ x: 10.75, z: 6.45, w: 4.5, d: 0.9, y0: 0.5, h: 2.6, color: fabric2, rough: 1, surface: true, round: 0.3 });
    this.box({ x: 15, z: 4.25, w: 4, d: 3.5, y0: 0.5, h: 1.1, color: fabric2, rough: 1 });
    this.box({ x: 15, z: 4.25, w: 3.8, d: 3.3, y0: 1.6, h: 0.5, color: fabric, rough: 1, surface: true, round: 0.2 });
    this.deco(new RoundedBoxGeometry(1.4, 1.4, 0.5, 2, 0.2), this.mat(0xe8a45c, 1), 9.9, 2.6, -5.2, [0, 0.3, -0.2]);
    // Rug, coffee table, cookies plate
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(11, 15), this.mat(0xffffff, 1, 0, { map: rugTexture() }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(19, 0.008, 0);
    rug.receiveShadow = true;
    S.add(rug);
    this.table(20, -1, 3.5, 6.5, 1.8, 0x3b2a1e, 0x2a1d14);
    // TV cabinet (gap under) + TV standing on it (the cat can knock it off and break it) + soundbar
    this.box({ x: 26.6, z: 0, w: 2.6, d: 10, y0: 0.45, h: 2.2, color: 0x4a3426, surface: true });
    for (const z of [-4.7, 4.7]) for (const x of [25.5, 27.7]) this.box({ x, z, w: 0.22, d: 0.22, y0: 0, h: 0.45, color: 0x222222 });
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0b1830, emissive: 0x1b3a6a, emissiveIntensity: 0.6, roughness: 0.15 });
    const blackTV = this.mat(0x111111, 0.3);
    this.prop('TV', 27.0, 2.65, 0, (add) => {
      add(new RoundedBoxGeometry(1.2, 0.12, 2.6, 2, 0.05), blackTV, 0, 0.06, 0);
      add(new THREE.BoxGeometry(0.25, 0.7, 0.4), blackTV, 0.1, 0.45, 0);
      add(new RoundedBoxGeometry(0.3, 4.4, 8, 2, 0.06), blackTV, 0.15, 2.95, 0);
      const scr = add(new THREE.PlaneGeometry(7.6, 4.0), screenMat, -0.01, 2.95, 0, [0, -Math.PI / 2, 0]);
      scr.userData.noCollide = true;
    }, {
      fallDir: [-1, 0],
      onBreak: () => { screenMat.map = crackedScreenTexture(); screenMat.color.setHex(0xffffff); screenMat.emissive.setHex(0x000000); screenMat.needsUpdate = true; },
      onReset: () => { screenMat.map = null; screenMat.color.setHex(0x0b1830); screenMat.emissive.setHex(0x1b3a6a); screenMat.needsUpdate = true; },
    });
    this.deco(new RoundedBoxGeometry(0.6, 0.4, 3, 2, 0.15), this.mat(0x1a1a1a, 0.4), 25.9, 2.85, 0);
    // Rattan armchair with a cushion
    const rattan = this.mat(0xffffff, 0.85, 0, { map: rattanTexture() });
    this.box({ x: 20, z: -12.5, w: 3.5, d: 3, y0: 0.5, h: 1.2, mat: rattan, round: 0.25 });
    this.box({ x: 20, z: -12.4, w: 3.1, d: 2.8, y0: 1.7, h: 0.4, color: 0xc84b31, rough: 1, surface: true, round: 0.18 });
    this.box({ x: 20, z: -14.45, w: 3.5, d: 0.9, y0: 0.5, h: 4, mat: rattan, round: 0.3 });
    this.box({ x: 17.9, z: -12.95, w: 0.7, d: 3.9, y0: 0.5, h: 2.6, mat: rattan, surface: true, round: 0.25 });
    this.box({ x: 22.1, z: -12.95, w: 0.7, d: 3.9, y0: 0.5, h: 2.6, mat: rattan, surface: true, round: 0.25 });
    for (const x of [17.9, 22.1]) for (const z of [-14.7, -11.2]) this.box({ x, z, w: 0.3, d: 0.3, y0: 0, h: 0.5, mat: rattan, round: 0.1 });
    // Bookshelf (you can climb the shelves)
    const shelfC = 0xa57a52;
    this.box({ x: 2.12, z: -19.2, w: 0.25, d: 1.6, y0: 0, h: 10.5, color: shelfC, round: 0.02 });
    this.box({ x: 7.88, z: -19.2, w: 0.25, d: 1.6, y0: 0, h: 10.5, color: shelfC, round: 0.02 });
    const bookColors = [0xb23a48, 0x2e86ab, 0xf6ae2d, 0x33658a, 0x86bbd8, 0x758e4f, 0xe4572e, 0x4a4e69];
    for (const y of [0, 2.5, 5.0, 7.5, 10.0]) {
      this.box({ x: 5, z: -19.2, w: 5.5, d: 1.6, y0: y, h: 0.3, color: shelfC, surface: true, round: 0.02 });
      if (y >= 10) continue;
      let bx = 2.5;
      while (bx < 6.2 + (y === 5.0 ? -1.5 : 0)) {
        const bw = rand(0.25, 0.5), bh = rand(1.3, 1.9);
        this.deco(new THREE.BoxGeometry(bw, bh, 1.1), this.mat(bookColors[Math.floor(Math.random() * bookColors.length)], 0.8), bx + bw / 2, y + 0.3 + bh / 2, -19.45, [0, 0, Math.random() < 0.1 ? 0.2 : 0]);
        bx += bw + 0.03;
      }
    }
    // Side table + lamp by the sofa
    this.table(11, -9.5, 2, 2, 2.4, 0x3b2a1e, 0x2a1d14);
    this.deco(new THREE.CylinderGeometry(0.15, 0.3, 1.2, 10), this.mat(0xd9c7a7, 0.5), 11, 3.0, -9.5);
    this.deco(new THREE.CylinderGeometry(0.5, 0.75, 0.9, 16, 1, true), this.mat(0xfff1d6, 0.9, 0, { side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.4 }), 11, 4.0, -9.5);
    this.lamps.push({ x: 11, y: 4.0, z: -9.5, color: 0xffc98a, power: 0.35 });
    // Floor lamp in the corner
    this.box({ x: 26, z: -17, w: 1.2, d: 1.2, y0: 0, h: 0.2, color: 0x222222, round: 0.1 });
    this.deco(new THREE.CylinderGeometry(0.06, 0.06, 9, 8), this.mat(0x222222, 0.3, 0.8), 26, 4.7, -17);
    this.deco(new THREE.CylinderGeometry(0.8, 1.2, 1.6, 18, 1, true), this.mat(0xfff1d6, 0.9, 0, { side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.5 }), 26, 9.6, -17);
    this.lamps.push({ x: 26, y: 9.4, z: -17, color: 0xffc98a, power: 0.6 });
    // Plants: areca palm, monstera by the window, snake plant by the door, pothos ("pokok duit") on the bookshelf, pandan in the kitchen
    this.plant(26, 16.5, 'palm');
    this.plant(13.4, -17.2, 'monstera');
    this.plant(1.6, 17.6, 'snake', 0, 0.8);
    this.plant(5, -19.2, 'pothos', 10.3, 1.2);
    this.plant(-26.4, 1, 'pandan', 4.1, 1);
    this.plant(-26.5, 16.5, 'palm', 0, 0.85);
    // Entrance: door, doormat, shoe bench (gap under), shoes
    this.deco(new THREE.PlaneGeometry(5, 10.5), this.mat(0x6b4630, 0.6), 5.5, 5.25, hz - 0.03, [0, Math.PI, 0]);
    this.deco(new THREE.BoxGeometry(5.6, 0.4, 0.2), this.mat(0xf5f2ea, 0.5), 5.5, 10.7, hz - 0.1);
    this.deco(new THREE.SphereGeometry(0.2, 10, 8), this.mat(0xd4af37, 0.2, 0.9), 3.6, 5, hz - 0.2);
    this.deco(new THREE.BoxGeometry(4.5, 0.06, 2.4), this.mat(0x6b5b3e, 1), 5.5, 0.03, hz - 1.6);
    this.box({ x: 12.5, z: 18.6, w: 5, d: 1.8, y0: 0.6, h: 0.35, color: 0x9c6b3e, surface: true });
    for (const x of [10.2, 14.8]) for (const z of [17.9, 19.3]) this.box({ x, z, w: 0.25, d: 0.25, y0: 0, h: 0.6, color: 0x5a3a1a });
    const shoeMat = this.mat(0x2b2b2b, 0.6);
    this.box({ x: 8.6, z: 17.6, w: 1.0, d: 2.3, y0: 0, h: 0.7, mat: shoeMat, round: 0.25 });
    this.box({ x: 7.3, z: 17.9, w: 1.0, d: 2.3, y0: 0, h: 0.7, mat: shoeMat, round: 0.25 });
    // Window with curtains + framed pictures
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 6.6), this.mat(0xffffff, 0.5));
    frame.position.set(21, 9, -hz + 0.02);
    S.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshBasicMaterial({ color: 0xcfeaff }));
    glass.position.set(21, 9, -hz + 0.04);
    S.add(glass);
    this.deco(new THREE.PlaneGeometry(0.2, 6), this.mat(0xffffff), 21, 9, -hz + 0.06);
    // Window grilles (very Malaysian)
    for (let gx = 16.6; gx <= 25.5; gx += 0.9) this.deco(new THREE.BoxGeometry(0.08, 6, 0.08), this.mat(0xf2f2f2, 0.4, 0.3), gx, 9, -hz + 0.12, [0, 0, 0], false);
    for (const gy of [7, 9, 11]) this.deco(new THREE.BoxGeometry(10, 0.08, 0.08), this.mat(0xf2f2f2, 0.4, 0.3), 21, gy, -hz + 0.12, [0, 0, 0], false);
    for (const cx of [15.4, 26.6]) this.deco(new THREE.BoxGeometry(1.6, 10, 0.3), this.mat(0xc9b38a, 1), cx, 8.5, -hz + 0.4);
    // Batik art in frames
    const art = [[13.5, 7.5, 0], [12, 11.2, 1]];
    for (const [ax, ay, v] of art) {
      this.deco(new THREE.BoxGeometry(3.2, 2.4, 0.12), this.mat(0x3a2414, 0.5), ax, ay, hz - 0.08, [0, 0, 0], false);
      this.deco(new THREE.PlaneGeometry(2.8, 2.0), this.mat(0xffffff, 0.9, 0, { map: batikTexture(v) }), ax, ay, hz - 0.15, [0, Math.PI, 0], false);
    }
    this.deco(new THREE.BoxGeometry(0.12, 3, 4.2), this.mat(0x3a2414, 0.5), -hx + 0.08, 9, 8, [0, 0, 0], false);
    this.deco(new THREE.PlaneGeometry(3.8, 2.6), this.mat(0xffffff, 0.9, 0, { map: batikTexture(2) }), -hx + 0.15, 9, 8, [0, Math.PI / 2, 0], false);
    // Wall clock in the kitchen
    this.deco(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 28), this.mat(0xffffff, 0.4), -3, 11, -hz + 0.08, [Math.PI / 2, 0, 0], false);
    this.deco(new THREE.BoxGeometry(0.06, 0.6, 0.04), this.mat(0x111111), -3, 11.25, -hz + 0.16, [0, 0, 0], false);
    this.deco(new THREE.BoxGeometry(0.45, 0.06, 0.04), this.mat(0x111111), -2.8, 11, -hz + 0.16, [0, 0, 0.3], false);

    // ---------- Malaysian kitchen bits: rice cooker, tiffin carrier (mangkuk tingkat), soy sauce, sambal jar
    const white = this.mat(0xf4f2ee, 0.35), steelM = this.mat(steel, 0.2, 0.85);
    this.deco(new THREE.CylinderGeometry(0.75, 0.7, 1.0, 22), white, -26.4, 4.6, -6);
    this.deco(new THREE.SphereGeometry(0.75, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, -26.4, 5.1, -6, [0, 0, 0]).scale.y = 0.4;
    this.deco(new THREE.BoxGeometry(0.3, 0.15, 0.2), this.mat(0xd04040, 0.4), -25.75, 4.7, -6, [0, 0, 0], false);
    for (let i = 0; i < 3; i++) this.deco(new THREE.CylinderGeometry(0.55, 0.5, 0.45, 20), steelM, -21, 4.35 + i * 0.47, -18.2);
    this.deco(new THREE.TorusGeometry(0.4, 0.05, 6, 16, Math.PI), steelM, -21, 5.75, -18.2);
    this.deco(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 10), this.mat(0x1a0d05, 0.2), -22.6, 4.6, -18.9);
    this.deco(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 14), this.mat(0xb3261e, 0.3), -23.2, 4.35, -18.6);
    // Flip-flops (selipar) at the door: everyone is barefoot inside
    const slip = this.mat(0x2e6cd1, 0.6);
    for (const [sx, sz, r] of [[4.6, 18.6, 0.2], [5.6, 18.8, -0.15], [6.8, 18.3, 0.5]]) {
      this.deco(new RoundedBoxGeometry(0.85, 0.12, 2.2, 2, 0.05), slip, sx, 0.06, sz, [0, r, 0]);
    }
    // Ceiling fan (living room) and a standing fan by the sofa
    const fan = (x, y, z) => {
      this.deco(new THREE.CylinderGeometry(0.08, 0.08, ROOM.height - y, 6), this.mat(0xeeeeee, 0.4), x, (ROOM.height + y) / 2, z, [0, 0, 0], false);
      this.deco(new THREE.CylinderGeometry(0.55, 0.45, 0.45, 18), this.mat(0xf2f2f2, 0.3, 0.2), x, y, z, [0, 0, 0], false);
      const blades = new THREE.Group();
      blades.position.set(x, y - 0.1, z);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.06, 0.65, 2, 0.03), this.mat(0xf5f5f0, 0.5));
        b.position.x = 2.1;
        const arm = new THREE.Group();
        arm.rotation.y = (i / 3) * Math.PI * 2;
        b.rotation.x = 0.12;
        arm.add(b);
        blades.add(arm);
      }
      blades.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      S.add(blades);
      blades.updateWorldMatrix(true, true);
      const fb = new THREE.Box3().setFromObject(blades);
      // solid disc for the blades (a roach can land on the fan!)
      this.solids.push({ minX: x - 3.6, maxX: x + 3.6, minY: fb.min.y, maxY: fb.max.y, minZ: z - 3.6, maxZ: z + 3.6 });
      blades.userData.dynamic = true; // spins: don't merge
      this.fans.push({ obj: blades, axis: 'y', speed: 6 });
    };
    fan(17, 14.3, 0);
    fan(-15, 14.3, 9);
    // standing fan
    this.deco(new THREE.CylinderGeometry(0.9, 1.0, 0.2, 22), this.mat(0xeeeeee, 0.4), 5.5, 0.1, -9);
    this.deco(new THREE.CylinderGeometry(0.1, 0.1, 6, 8), this.mat(0xdddddd, 0.3, 0.5), 5.5, 3.1, -9);
    this.deco(new THREE.SphereGeometry(0.45, 14, 10), this.mat(0xeeeeee, 0.4), 5.5, 6.3, -9);
    this.deco(new THREE.TorusGeometry(1.3, 0.04, 6, 36), this.mat(0xcccccc, 0.3, 0.6), 5.5, 6.3, -8.4); // guard (solid)
    this.solids.push({ minX: 4.2, maxX: 6.8, minY: 5.0, maxY: 7.6, minZ: -9.0, maxZ: -8.3 }); // fan head + blades
    const sBlades = new THREE.Group();
    sBlades.position.set(5.5, 6.3, -8.45);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), this.mat(0x8ecae6, 0.4, 0, { transparent: true, opacity: 0.85 }));
      b.scale.set(0.55, 0.32, 0.04);
      b.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.6, Math.sin((i / 3) * Math.PI * 2) * 0.6, 0);
      b.rotation.z = (i / 3) * Math.PI * 2;
      sBlades.add(b);
    }
    S.add(sBlades);
    sBlades.userData.dynamic = true;
    this.fans.push({ obj: sBlades, axis: 'z', speed: 14 });

    this.wallDecor();
    this.floorHazards();

    // Ceiling lights
    for (const [x, z] of [[-15, -4], [-2, 8], [22, 8]]) {
      this.deco(new THREE.CylinderGeometry(1.2, 1.2, 0.15, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 1.2 }), x, ROOM.height - 0.08, z);
      this.lamps.push({ x, y: ROOM.height - 0.8, z, color: 0xfff0d8, power: 1 });
    }
  }

  // Ubat gegat (mothballs) in sneaky spots, and baited roach traps on the floor
  floorHazards() {
    this.mothballs = [];
    this.traps = [];
    const ball = new THREE.MeshPhysicalMaterial({ color: 0xf8f8f4, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.4 });
    const hazeTex = canvasTex(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(225,255,235,0.55)');
      r.addColorStop(1, 'rgba(225,255,235,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    });
    for (const [x, z] of [[-18.6, -17.7], [-27.2, -14.6], [27.2, 19.2]]) {
      for (let i = 0; i < 6; i++) {
        const r = 0.11 + Math.random() * 0.05;
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), ball);
        m.position.set(x + rand(-0.35, 0.35), r, z + rand(-0.35, 0.35));
        m.castShadow = m.receiveShadow = true;
        this.scene.add(m);
      }
      // faint fumes hanging over them
      const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, transparent: true, depthWrite: false, opacity: 0.6 }));
      haze.position.set(x, 0.35, z);
      haze.scale.setScalar(2.2);
      this.scene.add(haze);
      this.mothballs.push({ x, z, r: 1.25, haze });
    }

    // Roach trap ("roach hotel"): a little cardboard house with open ends, sticky glue floor and bait inside
    const card = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#f2c14e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#c0392b';
      g.fillRect(0, h * 0.62, w, h * 0.2);
      g.fillStyle = '#2b1a0e';
      g.font = 'bold 34px sans-serif';
      g.textAlign = 'center';
      g.fillText('BUG TRAP', w / 2, h * 0.45);
      g.fillStyle = '#ffffff';
      g.font = 'bold 18px sans-serif';
      g.fillText('CHECK IN... NO CHECK OUT', w / 2, h * 0.77);
    });
    const cardMat = this.mat(0xffffff, 0.85, 0, { map: card });
    const inside = this.mat(0x6b4a2a, 0.9);
    const glue = new THREE.MeshPhysicalMaterial({ color: 0xffe9a3, roughness: 0.05, clearcoat: 1, transmission: 0, transparent: true, opacity: 0.9 });
    for (const [x, z, alongX] of [[-5, -11, false], [7, 7.2, true], [23.6, 9.5, false]]) {
      const L = 2.2, W = 1.3, H = 0.85;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      if (alongX) g.rotation.y = Math.PI / 2;
      const add = (geo, mat, px, py, pz, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.set(rx, 0, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      // roof panels meeting at a ridge
      const slope = Math.atan2(H - 0.35, W / 2);
      const panelW = Math.hypot(W / 2, H - 0.35) + 0.04;
      add(new THREE.BoxGeometry(panelW, 0.04, L), cardMat, -W / 4, 0.35 + (H - 0.35) / 2, 0, 0, slope);
      add(new THREE.BoxGeometry(panelW, 0.04, L), cardMat, W / 4, 0.35 + (H - 0.35) / 2, 0, 0, -slope);
      add(new THREE.BoxGeometry(0.05, 0.35, L), cardMat, -W / 2, 0.175, 0);
      add(new THREE.BoxGeometry(0.05, 0.35, L), cardMat, W / 2, 0.175, 0);
      add(new THREE.BoxGeometry(W, 0.02, L), inside, 0, 0.01, 0);
      add(new THREE.BoxGeometry(W - 0.1, 0.012, L - 0.3), glue, 0, 0.025, 0);
      add(new THREE.SphereGeometry(0.12, 14, 10), this.mat(0xb5651d, 0.8), 0, 0.09, 0); // bait
      this.scene.add(g);
      // colliders: the two low walls and the roof (you can walk in through the open ends... don't)
      const wall = (side) => {
        const o = side * (W / 2);
        return alongX
          ? { minX: x - L / 2, maxX: x + L / 2, minY: 0, maxY: 0.35, minZ: z + o - 0.04, maxZ: z + o + 0.04 }
          : { minX: x + o - 0.04, maxX: x + o + 0.04, minY: 0, maxY: 0.35, minZ: z - L / 2, maxZ: z + L / 2 };
      };
      this.solids.push(wall(-1), wall(1));
      this.solids.push(alongX
        ? { minX: x - L / 2, maxX: x + L / 2, minY: 0.36, maxY: H, minZ: z - W / 2, maxZ: z + W / 2 }
        : { minX: x - W / 2, maxX: x + W / 2, minY: 0.36, maxY: H, minZ: z - L / 2, maxZ: z + L / 2 });
      this.traps.push({ x, z, hx: alongX ? L / 2 - 0.2 : W / 2 - 0.12, hz: alongX ? W / 2 - 0.12 : L / 2 - 0.2 });
    }
  }

  // Things on the walls so they don't look bare: aircon, shelves, mirror, sideboard, photos, calendar...
  wallDecor() {
    const { hx, hz } = ROOM;
    const white = this.mat(0xf6f6f2, 0.35), wood = this.mat(0x8a5a34, 0.6), dark = this.mat(0x2a1d14, 0.5), gold = this.mat(0xc9a227, 0.3, 0.8);
    const frame = (x, y, z, w, h, ry, tex, color = 0x3a2414) => {
      // a picture frame flat against a wall (ry = which wall it faces)
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = ry;
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), this.mat(color, 0.5));
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 0.3), tex ? this.mat(0xffffff, 0.8, 0, { map: tex }) : this.mat(0xcfc3a8, 0.9));
      p.position.z = 0.06;
      g.add(f, p);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      this.solidFrom(f);
    };

    // --- Split aircon high on the TV wall (very Malaysian), with louvre and a little blue LED
    this.deco(new RoundedBoxGeometry(0.9, 1.1, 4.0, 3, 0.25), white, hx - 0.45, 12.05, 0);
    for (let i = 0; i < 3; i++) this.deco(new THREE.BoxGeometry(0.04, 0.05, 3.6), this.mat(0xcfcfcf, 0.5), hx - 0.92, 11.65 + i * 0.12, 0, [0, 0, 0], false);
    this.deco(new THREE.SphereGeometry(0.04, 6, 4), new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x3399ff, emissiveIntensity: 2 }), hx - 0.91, 12.3, 1.6, [0, 0, 0], false);

    // --- Sideboard in the dining area with a lamp, photo frames, vase; family photos above it
    this.box({ x: -8, z: 19.15, w: 4.6, d: 1.6, y0: 0.3, h: 2.9, mat: wood, surface: true, round: 0.06 });
    for (const x of [-9.6, -6.4]) this.box({ x, z: 19.15, w: 0.2, d: 0.2, y0: 0, h: 0.3, color: 0x222222 });
    this.deco(new THREE.BoxGeometry(2.0, 0.06, 0.06), gold, -8, 2.2, 18.32, [0, 0, 0], false);
    this.deco(new THREE.CylinderGeometry(0.18, 0.3, 1.1, 12), this.mat(0x2e86ab, 0.3), -9.6, 3.75, 19.2);
    this.deco(new THREE.CylinderGeometry(0.45, 0.6, 0.8, 16, 1, true), this.mat(0xfff1d6, 0.9, 0, { side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.4 }), -9.6, 4.6, 19.2);
    this.lamps.push({ x: -9.6, y: 4.5, z: 19.2, color: 0xffc98a, power: 0.25 });
    for (const [x, r] of [[-7.8, 0.1], [-6.6, -0.2]]) this.deco(new THREE.BoxGeometry(0.7, 0.9, 0.08), this.mat(0x5a3a1a, 0.5), x, 3.65, 19.5, [-0.15, r, 0]);
    this.deco(new THREE.SphereGeometry(0.3, 14, 10), this.mat(0xd94f4f, 0.3), -8.6, 3.5, 19.0);
    [[-9.4, 6.6], [-7.6, 6.9], [-6.2, 6.4], [-8.5, 8.4], [-6.9, 8.3]].forEach(([x, y], i) => frame(x, y, hz - 0.05, 1.2 + (i % 2) * 0.3, 1.5, Math.PI, photoTexture(i)));

    // --- Mirror by the door (reflects the room's light)
    this.deco(new RoundedBoxGeometry(2.6, 4.4, 0.14, 2, 0.06), gold, 0.3, 7.2, hz - 0.07, [0, 0, 0]);
    this.deco(new THREE.PlaneGeometry(2.3, 4.1), new THREE.MeshStandardMaterial({ color: 0xdfe8ee, metalness: 1, roughness: 0.04 }), 0.3, 7.2, hz - 0.15, [0, Math.PI, 0], false);
    // --- Coat hooks with a tote bag and a cap, next to the door
    this.deco(new THREE.BoxGeometry(2.0, 0.25, 0.12), wood, 9.5, 8.6, hz - 0.06);
    for (const x of [8.8, 9.5, 10.2]) this.deco(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), gold, x, 8.5, hz - 0.25, [Math.PI / 2, 0, 0], false);
    this.deco(new RoundedBoxGeometry(1.1, 1.4, 0.3, 2, 0.12), this.mat(0xe9c46a, 0.9), 8.8, 7.5, hz - 0.3);
    this.deco(new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0xc0392b, 0.8), 10.2, 8.1, hz - 0.35, [-Math.PI / 2, 0, 0]);
    // light switch by the door
    this.deco(new RoundedBoxGeometry(0.45, 0.7, 0.06, 2, 0.03), white, 1.9, 5.2, hz - 0.04);

    // --- Floating shelves on the dining wall: jars, a little plant, a photo
    for (const y of [9, 11]) this.box({ x: -27.4, z: 13.5, w: 1.2, d: 4, y0: y, h: 0.18, mat: wood, surface: true, round: 0.03 });
    [[13, 0xe76f51], [13.7, 0xf4a261], [14.4, 0x2a9d8f]].forEach(([z, c]) => this.deco(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12), this.mat(c, 0.3, 0, { transparent: true, opacity: 0.85 }), -27.4, 9.48, z));
    this.plant(-27.4, 12.2, 'pothos', 11.18, 0.8);
    this.deco(new THREE.BoxGeometry(0.08, 0.8, 0.65), this.mat(0x5a3a1a, 0.5), -27.6, 11.6, 14.6, [0, 0, 0.12]);

    // --- Plate rack shelf above the side counter
    this.box({ x: -27.5, z: -8, w: 1.0, d: 5, y0: 7.4, h: 0.15, mat: wood, surface: true, round: 0.03 });
    for (let i = 0; i < 7; i++) this.deco(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), this.mat(i % 2 ? 0xffffff : 0xa8d8ea, 0.25), -27.55, 7.98, -10 + i * 0.6, [0, 0, Math.PI / 2 - 0.15]);

    // --- Utensil rail on the backsplash (ladle, spatula, sieve)
    this.deco(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8), gold, -12.6, 7.4, -hz + 0.15, [0, 0, Math.PI / 2], false);
    [[-13.8, 0.9], [-12.8, 1.1], [-11.6, 0.8]].forEach(([x, l]) => {
      this.deco(new THREE.BoxGeometry(0.08, l, 0.04), this.mat(0x777777, 0.3, 0.8), x, 7.3 - l / 2, -hz + 0.17, [0, 0, 0], false);
      this.deco(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0x999999, 0.3, 0.8), x, 7.25 - l, -hz + 0.25, [Math.PI, 0, 0]);
    });

    // --- Kitchen calendar + calligraphy-style art in the living room + power sockets near the floor
    frame(1.0, 8.6, -hz + 0.05, 1.3, 1.8, 0, calendarTexture(), 0xffffff);
    frame(10.6, 10.4, -hz + 0.05, 3.4, 2.2, 0, swirlTexture(), 0x6b4a1a);
    for (const [x, z, ry] of [[-22, -hz + 0.04, 0], [12, -hz + 0.04, 0], [hx - 0.04, -8, -Math.PI / 2], [-hx + 0.04, 5, Math.PI / 2], [-14, hz - 0.04, Math.PI]]) {
      this.deco(new RoundedBoxGeometry(0.6, 0.6, 0.06, 2, 0.04), white, x, 1.3, z, [0, ry, 0], false);
      for (const dx of [-0.12, 0.12]) this.deco(new THREE.BoxGeometry(0.05, 0.12, 0.02), dark, x + Math.cos(ry) * dx, 1.38, z - Math.sin(ry) * dx + (Math.abs(ry) > 3 ? -0.04 : ry === 0 ? 0.04 : 0), [0, ry, 0], false);
    }
  }

  // Highest surface under (x, z) that the roach at height y can stand on.
  groundAt(x, z, y) {
    let g = 0;
    for (const s of this.solids) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.maxY <= y + STEP && s.maxY > g) g = s.maxY;
    }
    return g;
  }

  // Is something solid directly above this spot (table, sofa...)?
  coverAbove(x, z, y) {
    return this.solids.some((s) => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ && s.minY > y + 0.1);
  }

  // The low solid right above the roach in a deep hiding spot (sofa, TV cabinet, bench, kitchen cabinets), or null.
  hidingSolid(x, z, y) {
    return this.solids.find((s) => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ && s.minY > y + 0.1 && s.minY < y + 1.0) || null;
  }
  hidingSpot(x, z, y) { return !!this.hidingSolid(x, z, y); }

  ceiling(pos, height, prevY) {
    for (const s of this.solids) {
      if (prevY + height <= s.minY + 1e-4 && pos.y + height > s.minY &&
          pos.x > s.minX && pos.x < s.maxX && pos.z > s.minZ && pos.z < s.maxZ) {
        pos.y = s.minY - height;
        return true;
      }
    }
    if (pos.y + height > ROOM.height - 0.1) {
      pos.y = ROOM.height - 0.1 - height;
      return true;
    }
    return false;
  }

  // Push a vertical cylinder (radius, height) out of solids and walls.
  pushOut(pos, radius, height) {
    for (const s of this.solids) {
      if (pos.y + height <= s.minY || pos.y >= s.maxY - STEP) continue;
      const cx = clamp(pos.x, s.minX, s.maxX);
      const cz = clamp(pos.z, s.minZ, s.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (radius - d);
        pos.z += (dz / d) * (radius - d);
      } else {
        const pen = [pos.x - s.minX, s.maxX - pos.x, pos.z - s.minZ, s.maxZ - pos.z];
        const m = Math.min(...pen);
        if (m === pen[0]) pos.x = s.minX - radius;
        else if (m === pen[1]) pos.x = s.maxX + radius;
        else if (m === pen[2]) pos.z = s.minZ - radius;
        else pos.z = s.maxZ + radius;
      }
    }
    pos.x = clampX(pos.x, radius + 0.15);
    pos.z = clampZ(pos.z, radius + 0.15);
  }

  // Merge every static mesh of the house into a few big ones (draw calls: ~900 -> ~100)
  optimize() {
    const list = [];
    for (const c of this.scene.children) {
      if (c.userData.dynamic) continue;
      if (c.isMesh) list.push(c);
      else if (c.isGroup) c.traverse((o) => { if (o.isMesh) list.push(o); });
    }
    const { removed } = mergeStatic(list, this.scene);
    const gone = new Set(removed);
    this.occluders = this.occluders.filter((o) => !gone.has(o));
  }

  // Distance along a ray to the first furniture box (for the camera), or `far` if nothing is hit.
  raySolids(o, d, far) {
    let best = far;
    for (const s of this.solids) {
      if (o.x > s.minX && o.x < s.maxX && o.y > s.minY && o.y < s.maxY && o.z > s.minZ && o.z < s.maxZ) continue;
      let t0 = 0, t1 = best, hit = true;
      for (const [oo, dd, mn, mx] of [[o.x, d.x, s.minX, s.maxX], [o.y, d.y, s.minY, s.maxY], [o.z, d.z, s.minZ, s.maxZ]]) {
        if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) { hit = false; break; } continue; }
        let ta = (mn - oo) / dd, tb = (mx - oo) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 < best) best = t0;
    }
    return best;
  }

  // Is the straight line from a to b free of furniture?
  lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    for (const s of this.solids) {
      let t0 = 0, t1 = 1, hit = true;
      for (const [o, d, mn, mx] of [[a.x, dx, s.minX, s.maxX], [a.y, dy, s.minY, s.maxY], [a.z, dz, s.minZ, s.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) { hit = false; break; }
        } else {
          let ta = (mn - o) / d, tb = (mx - o) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) { hit = false; break; }
        }
      }
      if (hit) return false;
    }
    return true;
  }

  isFree(x, y, z, margin = 0) {
    return !this.solids.some((s) =>
      x > s.minX - margin && x < s.maxX + margin && z > s.minZ - margin && z < s.maxZ + margin && y > s.minY && y < s.maxY);
  }

  randomSpawn() {
    for (let i = 0; i < 60; i++) {
      let x, z, y;
      if (Math.random() < 0.6 || !this.surfaces.length) {
        x = clampX(rand(-ROOM.hx, ROOM.hx), 1.5); z = clampZ(rand(-ROOM.hz, ROOM.hz), 1.5); y = 0;
      } else {
        const s = this.surfaces[Math.floor(Math.random() * this.surfaces.length)];
        x = rand(s.minX, s.maxX); z = rand(s.minZ, s.maxZ); y = s.y;
      }
      if (this.isFree(x, y + 0.05, z, 0.25)) return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(0, 0, 0);
  }

  // Can something low (maxY tall) travel in a straight line from a to b?
  pathClear(a, b, maxY, margin) {
    const n = 32;
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const z = a.z + ((b.z - a.z) * i) / n;
      if (Math.abs(x) > ROOM.hx - 1.2 || Math.abs(z) > ROOM.hz - 1.2) return false;
      for (const s of this.solids) {
        if (s.minY < maxY && x > s.minX - margin && x < s.maxX + margin && z > s.minZ - margin && z < s.maxZ + margin) return false;
      }
    }
    return true;
  }
}
