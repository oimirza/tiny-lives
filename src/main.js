import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { World, ROOM, NEST, CRACK, clamp, clampX, clampZ, rand, lerpAngle, compactModel } from './world.js';
import { Roach } from './roach.js';
import { Person, Broom, Spray, Car } from './hazards.js';
import { Cat } from './cat.js';
import { Foods } from './foods.js';
import { Sfx } from './sfx.js';

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------------------------------------------------------------- Renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // fast soft-ish shadows
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);
const canvas = renderer.domElement;
// Mouse lock can be refused (e.g. tab in the background): ignore that quietly
function lockPointer() { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ignore */ } }

const BASE_FOV = 82; // wide angle; widens more when scurrying or flying
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1410);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.03, 200);

// Soft image-based lighting gives everything subtle reflections and fills in the shadows
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
renderer.toneMappingExposure = 0.95;

const hemiLight = new THREE.HemisphereLight(0xfff4e0, 0x5a4532, 0.6);
scene.add(hemiLight);
// Daylight coming in through the north window
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
sun.position.set(14, 34, -26);
sun.target.position.set(4, 0, 4);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 30, bottom: -30, near: 1, far: 100 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.fog = new THREE.Fog(0x2a2018, 45, 110);

const sfx = new Sfx();
const world = new World(scene);

// Post-processing: only used for the "High" graphics preset (soft glow) and the bug-spray "high" effect.
const rtSize = new THREE.Vector2();
renderer.getDrawingBufferSize(rtSize);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { type: THREE.HalfFloatType, samples: isTouch ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.55, 0.92);
bloomPass.enabled = false;
composer.addPass(bloomPass);
// "High on bug spray" screen effect: wobbly waves, colour-split double vision, rainbow tint and a pulsing vignette.
const highPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      uv.x += sin(uv.y * 9.0 + time * 2.1) * 0.012 * amount;
      uv.y += cos(uv.x * 7.0 + time * 1.6) * 0.010 * amount;
      vec2 c = uv - 0.5;
      uv = 0.5 + c * (1.0 - 0.05 * amount * (0.5 + 0.5 * sin(time * 1.3)));
      vec2 off = vec2(sin(time * 1.1), cos(time * 0.9)) * 0.016 * amount;
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      vec3 ghost = texture2D(tDiffuse, uv + vec2(0.035 * sin(time * 0.7), 0.02) * amount).rgb;
      col = mix(col, ghost, 0.3 * amount);
      vec3 tint = 0.5 + 0.5 * cos(time * 0.8 + vec3(0.0, 2.0, 4.0));
      col = mix(col, col * tint * 1.5, 0.35 * amount);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.0 + 0.9 * amount);
      col *= mix(1.0, smoothstep(0.9, 0.25, length(c)) * (0.85 + 0.15 * sin(time * 3.0)), 0.6 * amount);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(highPass);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- Graphics quality
// auto = medium settings + dynamic resolution that drops when the frame rate dips (and climbs back up).
const QUALITY = {
  low: { pr: 0.85, shadow: 1024, bloom: false },
  medium: { pr: 1.25, shadow: 2048, bloom: false },
  high: { pr: 2, shadow: 4096, bloom: true },
};
const QUALITY_NAMES = ['auto', 'high', 'medium', 'low'];
let qualityMode = (() => { try { return localStorage.getItem('aku-quality') || 'auto'; } catch { return 'auto'; } })();
let maxPR = 1, curPR = 1, useComposer = false;
function setPR(pr) {
  curPR = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(pr);
  composer.setSize(window.innerWidth, window.innerHeight);
}
function applyQuality() {
  const q = QUALITY[qualityMode === 'auto' ? (isTouch ? 'low' : 'medium') : qualityMode];
  maxPR = Math.min(window.devicePixelRatio || 1, q.pr);
  setPR(maxPR);
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.setScalar(q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // re-created at the new size
  }
  bloomPass.enabled = q.bloom;
  useComposer = q.bloom;
  for (const el of document.querySelectorAll('.qualityBtn')) el.textContent = `GRAPHICS: ${qualityMode.toUpperCase()}`;
}
function cycleQuality() {
  qualityMode = QUALITY_NAMES[(QUALITY_NAMES.indexOf(qualityMode) + 1) % QUALITY_NAMES.length];
  try { localStorage.setItem('aku-quality', qualityMode); } catch { /* ignore */ }
  applyQuality();
}
for (const el of document.querySelectorAll('.qualityBtn')) el.addEventListener('click', (e) => { e.stopPropagation(); cycleQuality(); });
applyQuality();
// dynamic resolution for "auto": measure the frame rate once a second
const perf = { t: 0, frames: 0 };
function autoResolution(dt) {
  if (qualityMode !== 'auto' || document.hidden) return;
  perf.t += dt;
  perf.frames++;
  if (perf.t < 1) return;
  const fps = perf.frames / perf.t;
  perf.t = 0;
  perf.frames = 0;
  if (fps < 48 && curPR <= 0.61 && sun.shadow.mapSize.x > 1024) {
    // already at the lowest resolution: make the shadows cheaper too
    sun.shadow.mapSize.setScalar(1024);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  } else if (fps < 48 && curPR > 0.6) setPR(Math.max(0.6, curPR - 0.15));
  else if (fps > 58 && curPR < maxPR - 0.01) setPR(Math.min(maxPR, curPR + 0.1));
}


const roach = new Roach(scene, world);
const broom = new Broom(scene, world, sfx);
const spray = new Spray(scene, world, sfx);
const person = new Person(scene, world, sfx);
person.setTools(broom, spray);
const cat = new Cat(scene, world, sfx);
const car = new Car(scene, world, sfx);
const foods = new Foods(scene, world);

// ---------------------------------------------------------------- Crumbs (fixed set: eat them all)
// A few hand-placed ones in sneaky spots, the rest scattered.
const CRUMB_SPOTS = [
  [11, 0, 3], [12, 0, -4], [15, 0, 4.3],        // under the sofa
  [26.6, 0, -3], [26.6, 0, 3],                  // under the TV cabinet
  [11.5, 0, 18.6], [13.8, 0, 18.5],             // under the shoe bench
  [-12, 0, -18.6], [-20, 0, -18.6], [-26.5, 0, -6], // under the kitchen cabinets
  [-26, 10, -18], [-14, 12, -19.3],             // fridge top, upper cabinets
  [5, 5.3, -18.62], [3.5, 7.8, -18.62],         // bookshelf (in front of the books)
  [-16.5, 4.1, -3], [-15, 0, 11],               // island, under the dining table
  [19.2, 1.8, -3], [20, 2.1, -12.5],            // coffee table, armchair
  [-6, 3, -15], [-1, 0, -18.6], [26.6, 2.65, 4], // bin lid, by the wall crack, TV cabinet
];
// ---------------------------------------------------------------- Levels
// hidden = how many crumbs go in sneaky spots; big = crumb size; beacon = glowing light beam above each crumb
// loc = which room, time = lighting preset, traps/mothballs = how many hazards, sleeper = the human is asleep (night)
const LEVELS = [
  { name: 'Easy', place: 'Living room · Morning', loc: 'living', time: 'morning', traps: 3, mothballs: 3, crumbs: 10, hidden: 0, big: 2.4, beacon: false, human: 0.45, speed: 0.75, cat: 'sleep', car: false, tip: 'Good morning! 10 big crumbs. Oyen the cat is fast asleep.' },
  { name: 'Medium', place: 'Living room · Evening', loc: 'living', time: 'evening', traps: 4, mothballs: 3, crumbs: 14, hidden: 2, big: 1.8, beacon: false, human: 0.7, speed: 0.85, cat: 'lazy', car: false, tip: 'Evening. 14 crumbs. Oyen is awake... but lazy.' },
  { name: 'Hard', place: 'Living room · Night', loc: 'living', time: 'night', traps: 5, mothballs: 4, sleeper: true, crumbs: 18, hidden: 5, big: 1.5, beacon: false, human: 1, speed: 1, cat: 'normal', car: true, tip: "Night. He fell asleep watching cartoons. Don't wake him! Oyen is prowling." },
  { name: 'Expert', place: 'Bedroom · Late night', loc: 'bedroom', time: 'lamp', traps: 7, mothballs: 5, crumbs: 22, hidden: 9, big: 1.3, beacon: false, human: 1.2, speed: 1.1, cat: 'aggro', car: true, tip: "The bedroom. He can't sleep... and there are traps everywhere." },
  { name: 'Master', place: 'Toilet & shower', loc: 'bathroom', time: 'bathroom', traps: 10, mothballs: 6, crumbs: 26, hidden: 12, big: 1.15, beacon: false, human: 1.4, speed: 1.2, cat: 'aggro', car: false, tip: 'The toilet. Slippery floor, 10 traps, and he is NOT happy.' },
];

// ---------------------------------------------------------------- Time of day (lighting per level)
const ENVS = {
  morning: { glass: 0xcfeaff, hemi: [0xfff4e0, 0x5a4532, 0.65], sun: [0xfff0dc, 2.6], sunPos: [14, 34, -26], ceil: 0, lamps: 0, exposure: 1.0, envI: 0.32, fog: 0x2a2018 },
  evening: { glass: 0xff9f55, hemi: [0xffcf9e, 0x4a3020, 0.42], sun: [0xff8a3d, 2.1], sunPos: [34, 12, -28], ceil: 0.45, lamps: 0.9, exposure: 0.95, envI: 0.2, fog: 0x2a1810 },
  night: { glass: 0x0a1330, hemi: [0x5f78c0, 0x0c0c14, 0.12], sun: [0x7d98ff, 0.35], sunPos: [-10, 30, -30], ceil: 0, lamps: 0.35, exposure: 1.1, envI: 0.04, fog: 0x05060c, tv: true },
  lamp: { glass: 0x0a1330, hemi: [0x5f78c0, 0x0c0c14, 0.15], sun: [0x8aa2ff, 0.45], sunPos: [44, 26, 2], ceil: 0, lamps: 1.1, exposure: 1.2, envI: 0.05, fog: 0x05060c },
  bathroom: { glass: 0x1b2a48, hemi: [0xeaf4ff, 0x40505a, 0.55], sun: [0x9fb4ff, 0.25], sunPos: [-40, 30, -10], ceil: 1.1, lamps: 0, exposure: 1.0, envI: 0.34, fog: 0x1a2024 },
};
let envLights = [];
let tvLight = null;
function applyEnv(name) {
  const E = ENVS[name];
  hemiLight.color.setHex(E.hemi[0]);
  hemiLight.groundColor.setHex(E.hemi[1]);
  hemiLight.intensity = E.hemi[2];
  sun.color.setHex(E.sun[0]);
  sun.intensity = E.sun[1];
  sun.position.set(...E.sunPos);
  renderer.toneMappingExposure = E.exposure;
  scene.environmentIntensity = E.envI;
  scene.fog.color.setHex(E.fog);
  scene.background.setHex(E.fog);
  for (const m of world.windows) m.color.setHex(m.userData.frosted ? new THREE.Color(E.glass).lerp(new THREE.Color(0xffffff), 0.35).getHex() : E.glass);
  for (const m of world.ceilingMats) m.emissiveIntensity = m.userData.on * E.ceil + 0.03;
  // real point lights: ceiling lights when they're on, small table/floor lamps in the evening and at night
  for (const l of envLights) scene.remove(l);
  envLights = [];
  let small = 0;
  for (const L of world.lamps) {
    const ceiling = L.y >= ROOM.height - 2;
    const k = ceiling ? E.ceil : E.lamps;
    if (k <= 0 || (!ceiling && small >= 3)) continue;
    if (!ceiling) small++;
    const pl = new THREE.PointLight(L.color, (ceiling ? 110 : 70) * L.power * k, ceiling ? 32 : 20, 1.6);
    pl.position.set(L.x, L.y - (ceiling ? 0 : 0.3), L.z);
    scene.add(pl);
    envLights.push(pl);
  }
  // the TV left on, showing cartoons (lights the room in flickering colours)
  if (tvLight) { scene.remove(tvLight); tvLight = null; }
  if (E.tv && world.tvMat) {
    tvLight = new THREE.PointLight(0x8fb6ff, 14, 22, 1.6);
    tvLight.position.set(24.2, 5.2, 0);
    scene.add(tvLight);
  }
  tvOn = !!(E.tv && world.tvMat);
  setTVPicture();
}

// ---------------------------------------------------------------- Cartoon on the TV (drawn live on a canvas)
const tvCanvas = document.createElement('canvas');
tvCanvas.width = 256;
tvCanvas.height = 144;
const tvTex = new THREE.CanvasTexture(tvCanvas);
tvTex.colorSpace = THREE.SRGBColorSpace;
let tvOn = false, tvT = 0, tvDraw = 0;
function setTVPicture() {
  const m = world.tvMat;
  if (!m) return;
  const tvProp = world.props.find((p) => p.name === 'TV');
  if (tvOn && !(tvProp && (tvProp.fallen || tvProp.anim))) {
    m.map = tvTex;
    m.emissiveMap = tvTex;
    m.color.setHex(0xffffff);
    m.emissive.setHex(0xffffff);
    m.emissiveIntensity = 1.0;
    m.needsUpdate = true;
  }
}
function drawCartoon(t) {
  const g = tvCanvas.getContext('2d'), W = 256, H = 144;
  const scene = Math.floor(t / 4) % 3;
  g.fillStyle = ['#6ec3ff', '#ffd36e', '#9be07a'][scene];
  g.fillRect(0, 0, W, H);
  g.fillStyle = ['#5fbf5a', '#e89a3c', '#3f8f4f'][scene];
  g.fillRect(0, H * 0.72, W, H * 0.28);
  // sun with a face
  g.fillStyle = '#ffe14d';
  g.beginPath(); g.arc(214, 30, 18 + Math.sin(t * 3) * 2, 0, 7); g.fill();
  // a bouncing cartoon blob character chasing a smaller one
  const x1 = ((t * 60) % (W + 80)) - 40, x2 = x1 - 60 - Math.sin(t * 2) * 10;
  const y1 = H * 0.72 - 22 - Math.abs(Math.sin(t * 6)) * 26, y2 = H * 0.72 - 28 - Math.abs(Math.sin(t * 5 + 1)) * 34;
  for (const [x, y, r, c] of [[x1, y1, 16, '#ff5d8f'], [x2, y2, 24, '#7a5cff']]) {
    g.fillStyle = c; g.beginPath(); g.ellipse(x, y, r, r * (0.9 + Math.sin(t * 12) * 0.08), 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.2, r * 0.28, 0, 7); g.arc(x + r * 0.3, y - r * 0.2, r * 0.28, 0, 7); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.2, r * 0.12, 0, 7); g.arc(x + r * 0.35, y - r * 0.2, r * 0.12, 0, 7); g.fill();
  }
  // big "BOING!" now and then
  if (Math.sin(t * 1.3) > 0.85) { g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.fillText('BOING!', 90, 40); }
  tvTex.needsUpdate = true;
  return ['#6ec3ff', '#ffd36e', '#9be07a'][scene];
}
function updateTV(dt) {
  if (!tvOn) return;
  const tvProp = world.props.find((p) => p.name === 'TV');
  if (tvProp && (tvProp.fallen || tvProp.anim)) { if (tvLight) tvLight.intensity = 0; return; }
  tvT += dt;
  tvDraw -= dt;
  if (tvDraw <= 0) {
    tvDraw = 1 / 15;
    const col = drawCartoon(tvT);
    if (tvLight) { tvLight.color.set(col).lerp(new THREE.Color(0x7fa8ff), 0.55); tvLight.intensity = 10 + Math.random() * 7; }
  }
}
let levelIdx = 0;
let CRUMB_COUNT = 10;
const MAX_CRUMBS = 40;
const crumbGeo = new THREE.DodecahedronGeometry(0.09, 0);
const crumbMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.9, emissive: 0x5a3500 });
const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const beaconGeo = new THREE.CylinderGeometry(0.05, 0.28, 6, 10, 1, true);
const crumbs = [];
for (let i = 0; i < MAX_CRUMBS; i++) {
  const c = new THREE.Mesh(crumbGeo, crumbMat);
  c.castShadow = true;
  const beam = new THREE.Mesh(beaconGeo, beaconMat);
  beam.renderOrder = 3;
  scene.add(c, beam);
  c.userData.beam = beam;
  crumbs.push(c);
}
// A crumb spot out in the open (easy levels: nothing on top of it, not too high, not right by the nest)
function openSpot(maxY) {
  let p = null;
  for (let k = 0; k < 80; k++) {
    p = world.randomSpawn();
    if (Math.hypot(p.x - NEST.x, p.z - NEST.z) < 4.5) continue;
    if (p.y > maxY || world.coverAbove(p.x, p.z, p.y)) continue;
    // keep crumbs away from the traps and the mothball fumes
    if (world.traps.some((t) => Math.hypot(p.x - t.x, p.z - t.z) < 2.2) || world.mothballs.some((m) => Math.hypot(p.x - m.x, p.z - m.z) < 2)) continue;
    return p;
  }
  return p;
}
function scatterCrumbs() {
  const L = LEVELS[levelIdx];
  const hidden = [...world.layout.crumbSpots].sort(() => Math.random() - 0.5).slice(0, L.hidden);
  crumbs.forEach((c, i) => {
    const beam = c.userData.beam;
    if (i >= CRUMB_COUNT) { c.visible = false; beam.visible = false; return; }
    const p = i < hidden.length ? new THREE.Vector3(...hidden[i]) : openSpot(L.beacon ? 4.5 : 12);
    c.position.set(p.x, p.y + 0.08 * L.big, p.z);
    c.userData.base = p.y + 0.08 * L.big;
    c.userData.ph = Math.random() * 6;
    c.rotation.set(rand(0, 6), rand(0, 6), 0);
    c.scale.set(L.big, 0.7 * L.big, 1.3 * L.big);
    c.visible = true;
    beam.position.set(p.x, p.y + 3, p.z);
    beam.visible = L.beacon;
  });
}

// ---------------------------------------------------------------- The roach family (waiting at home on top of the cupboard)
roach.addTie(); // Dad goes to "work" (only worn in the cutscenes)
roach.setTie(false);
compactModel(roach.model); // fewer draw calls
const wife = new Roach(scene, world);
wife.addBow();
compactModel(wife.model);
const kids = [0, 1, 2].map(() => { const k = new Roach(scene, world); k.model.scale.setScalar(0.55); compactModel(k.model); return k; });
// cartoon faces (only shown in the cutscenes)
for (const m of [roach, wife, ...kids]) m.addFace();
const FAMILY = { wife: [21.35, 19.35], kids: [[19.75, 19.6], [20.4, 19.75], [21.0, 19.6]] };
// The family lives *inside* the nest hole: they only come out for the goodbye and the homecoming.
const family = [wife, ...kids];
const famSpot = (i) => (i === 0 ? FAMILY.wife : FAMILY.kids[i - 1]);
const famInside = (i) => new THREE.Vector3(20 + (famSpot(i)[0] - 20) * 0.35, NEST.y, ROOM.hz + 0.6); // behind the wall = out of sight
function setFamilyVisible(v) { for (const m of family) m.model.visible = v; }
function placeFamily(inside = false) {
  family.forEach((m, i) => {
    if (inside) m.pos.copy(famInside(i));
    else m.pos.set(famSpot(i)[0], NEST.y, famSpot(i)[1]);
    m.heading = Math.PI + (i === 0 ? -0.3 : (i - 2) * 0.25);
    m.orient(1);
  });
}
// Walk the family out of the hole to their spots, or back in
function famWalk(dt, time, toInside) {
  family.forEach((m, i) => {
    const target = toInside ? famInside(i) : new THREE.Vector3(famSpot(i)[0], NEST.y, famSpot(i)[1]);
    const d = target.clone().sub(m.pos);
    d.y = 0;
    const len = d.length();
    let walk = 0;
    if (len > 0.03) {
      m.heading = lerpAngle(m.heading, Math.atan2(d.x, d.z), 1 - Math.exp(-10 * dt));
      m.pos.addScaledVector(d.normalize(), Math.min(len, (i ? 1.6 : 1.3) * dt));
      walk = 1.4;
    } else {
      m.heading = lerpAngle(m.heading, Math.PI, 1 - Math.exp(-6 * dt));
    }
    m.pose(dt, time, walk, 0);
  });
}
placeFamily(true);
setFamilyVisible(false);
// mood: 'idle' | 'wave' | 'party'
function animateFamily(dt, time, mood = 'idle') {
  wife.pose(dt, time, 0, mood === 'party' ? Math.abs(Math.sin(time * 6)) * 0.08 : 0);
  kids.forEach((k, i) => {
    const hop = mood === 'party' ? Math.abs(Math.sin(time * 9 + i * 1.7)) * 0.18 : mood === 'wave' ? Math.abs(Math.sin(time * 7 + i)) * 0.06 : 0;
    k.pose(dt, time, mood === 'party' ? 1.5 : 0, hop);
  });
}

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), hp: $('hp'), st: $('st'), time: $('time'), crumbs: $('crumbs'), foods: $('foods'),
  score: $('score'), progFill: $('progFill'), pstars: [$('ps1'), $('ps2'), $('ps3')], popups: $('popups'),
  tileCrumbs: $('tileCrumbs'),
  stealthLabel: $('stealthLabel'), sus: $('sus'), objective: $('objective'), compass: $('compass'), prompt: $('prompt'),
  warn: $('warn'), flash: $('flash'), poison: $('poison'), vignette: $('vignette'),
  over: $('over'), paused: $('paused'), cause: $('cause'), final: $('final'),
  title: $('title'), select: $('select'), map: $('map'), cine: $('cine'), countdown: $('countdown'),
  touch: $('touch'), btnEat: $('btnEat'),
};
let warnTimer = 0;
let flashAmt = 0;
let poisonAmt = 0;

function loadBest() { try { return Number(localStorage.getItem('roach-best-time') || 0); } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem('roach-best-time', String(v)); } catch { /* ignore */ } }

// ---------------------------------------------------------------- Game state
const game = {
  state: 'title', // title | select | map | intro | countdown | playing | paused | outro | over
  time: 0,
  protein: 0,
  crumbsEaten: 0,
  spotted: 0,
  difficulty: 0,
  shakeAmt: 0,
  deathTimer: 0,
  cause: '',
  won: false,
  warn(text) {
    ui.warn.textContent = text;
    ui.warn.classList.add('show');
    warnTimer = 1.4;
  },
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); },
  spot() { this.spotted++; },
  mess() { this.messes++; },
  damage(amount, cause, o = {}) {
    if (roach.dead || this.state !== 'playing') return;
    if (!o.dot && roach.invuln > 0) return;
    roach.health -= amount;
    if (o.kx !== undefined) {
      roach.vel.x += o.kx;
      roach.vel.z += o.kz;
      roach.vy = Math.max(roach.vy, o.ky || 0);
      roach.onGround = false;
    }
    if (o.dot) {
      poisonAmt = Math.min(1, poisonAmt + 0.15);
    } else {
      roach.invuln = 1.2;
      flashAmt = 0.8;
      sfx.hurt();
      this.shake(0.2);
    }
    if (roach.health <= 0) {
      roach.health = 0;
      roach.die(!!o.squash);
      sfx.death();
      this.cause = cause;
      this.deathTimer = 1.8;
    }
  },
};
// When something the cat knocked over hits the floor: crash sound, shake, and the human comes running
world.onCrash = (p) => {
  sfx.crash(p.name === 'TV' || p.name === 'cupboard');
  game.shake(p.name === 'cupboard' || p.name === 'TV' ? 0.35 : 0.15);
  const b = new THREE.Box3().setFromObject(p.group);
  const c = b.getCenter(new THREE.Vector3());
  person.hear(c, 0.5);
  if (game.state === 'playing') game.warn(p.name === 'TV' ? 'CRASH! The cat broke the TV!' : `CRASH! The cat knocked over the ${p.name}!`);
};

// ---------------------------------------------------------------- Score + pop-ups (candy style)
let lastScore = -1;
const score = () => Math.round(game.protein * 10);
const progress = () => {
  return Math.min(1, game.crumbsEaten / CRUMB_COUNT); // only crumbs count towards the goal
};
const CHEERS = ['Sweet!', 'Delicious!', 'Tasty!', 'Divine!', 'Yummy!'];
function popup(text, cls = '', x = 50, y = 55) {
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.textContent = text;
  el.style.left = `${x + (Math.random() - 0.5) * 8}%`;
  el.style.top = `${y + (Math.random() - 0.5) * 6}%`;
  ui.popups.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}

const allFoodEaten = () => foods.items.every((f) => f.remaining <= 0.01);
const allClear = () => game.crumbsEaten >= CRUMB_COUNT; // snacks are optional health refills

function resetGame() {
  roach.reset();
  for (const h of [person, cat, broom, spray, car]) h.reset();
  world.resetProps();
  foods.reset();
  scatterCrumbs();
  Object.assign(game, { lastFind: 0, time: 0, protein: 0, crumbsEaten: 0, spotted: 0, messes: 0, difficulty: 0, deathTimer: 0, won: false });
  cam.yaw = 0;
  cam.pitch = 0.25;
  cam.fwd.set(0, 0, -1);
  cam.up.set(0, 1, 0);
  cam.target.copy(roach.pos);
  flashAmt = poisonAmt = 0;
  lastScore = -1;
  ui.popups.innerHTML = '';
  world.nestGlow.visible = false;
  placeFamily(true);
  setFamilyVisible(false);
  setFaces(false);
  if (LEVELS[levelIdx].sleeper) person.goSleep();
  setTVPicture();
}

// ---------------------------------------------------------------- Screens, saved progress
const isMenu = () => game.state === 'title' || game.state === 'select' || game.state === 'map';
function loadProgress() { try { return JSON.parse(localStorage.getItem('aku-progress')) || { unlocked: 1, stars: [] }; } catch { return { unlocked: 1, stars: [] }; } }
function saveProgress(p) { try { localStorage.setItem('aku-progress', JSON.stringify(p)); } catch { /* ignore */ } }

function showScreen(name) {
  for (const k of ['title', 'select', 'map', 'over', 'paused']) ui[k].classList.toggle('hidden', k !== name);
  ui.hud.classList.add('hidden');
  ui.touch.classList.add('hidden');
  ui.cine.classList.add('hidden');
  ui.countdown.classList.add('hidden');
  if (name) game.state = name === 'over' ? 'over' : name;
  if (name === 'map') buildMap();
}

function buildMap() {
  const prog = loadProgress();
  const box = $('mapNodes');
  box.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const locked = i + 1 > prog.unlocked;
    const s = prog.stars[i] || 0;
    const node = document.createElement('button');
    node.className = `node${locked ? ' locked' : ''}${i + 1 === prog.unlocked ? ' current' : ''}`;
    node.style.setProperty('--off', `${[0, 38, -10, 30, -6][i]}px`);
    node.innerHTML = `<span class="num">${locked ? '🔒' : i + 1}</span><span class="nstars">${'★'.repeat(s)}${'☆'.repeat(3 - s)}</span><span class="nname">${L.name}</span><span class="ntip">${L.crumbs} crumbs</span>`;
    if (!locked) node.addEventListener('click', () => beginLevel(i));
    box.appendChild(node);
  });
}

// Apply the level's difficulty to everyone in the house
function applyLevel() {
  const L = LEVELS[levelIdx];
  CRUMB_COUNT = L.crumbs;
  if (world.setLocation(L.loc, { traps: L.traps, mothballs: L.mothballs, sleeper: !!L.sleeper })) foods.place(world.layout.foods);
  applyEnv(L.time);
  person.sense = L.human;
  person.speedMul = L.speed;
  cat.mode = L.cat;
  car.enabled = L.car;
}

function beginLevel(i, quick = false) {
  sfx.init();
  levelIdx = i;
  applyLevel();
  resetGame();
  showScreen(null);
  if (quick) { roach.pos.copy(DAD_OUT); roach.heading = Math.PI; startCountdown(); } // restart: skip the cutscene
  else startIntro(i === 0);
}

// ---------------------------------------------------------------- Cutscenes (intro: Dad leaves for "work"; outro: he comes home)
const cine = { t: 0, lines: [], line: -1, kind: 'intro', full: true };
const DAD_HOME = new THREE.Vector3(20, NEST.y, 18.7);
const DAD_OUT = new THREE.Vector3(20, NEST.y, 17.9);
// Each line cuts to a shot: 'wide' (establishing), a close-up on the speaker ('kids' | 'mak' | 'ayah'),
// or 'follow' (behind Dad as he leaves). Close-ups slowly push in, like an in-game movie.
// mood = facial expression for each of them on that line (see Roach.updateFace); sob = cry instead of babble
const INTRO_FULL = [
  { t: 0, shot: 'wide', who: 'Anak-anak', ms: 'Ayah... kami lapar...', en: '', mood: { kids: 'sad', mak: 'sad', ayah: 'worried' } },
  { t: 2.6, shot: 'kids', who: 'Anak-anak', ms: 'Dah tiga hari tak makan!', en: '', sob: true, mood: { kids: 'cry', mak: 'sad', ayah: 'sad' } },
  { t: 5.0, shot: 'mak', who: 'Mak', ms: 'Hati-hati, bang. Manusia tu garang... si Oyen pun ada.', en: '', mood: { kids: 'worried', mak: 'worried', ayah: 'worried' } },
  { t: 8.4, shot: 'ayah', who: 'Ayah', ms: 'Jangan risau. Ayah keluar cari makanan untuk kita semua!', en: '', mood: { kids: 'happy', mak: 'love', ayah: 'proud' } },
  { t: 11.8, shot: 'kids', who: 'Anak-anak', ms: 'Ayah hero kami!', en: '', mood: { kids: 'excited', mak: 'love', ayah: 'proud' } },
  { t: 13.6, shot: 'follow', who: 'Anak-anak', ms: 'Bye ayah! Bawa balik banyak-banyak!', en: '', leave: true, mood: { kids: 'excited', mak: 'worried', ayah: 'proud' } },
];
const INTRO_SHORT = [
  { t: 0, shot: 'mak', who: 'Mak', ms: 'Balik cepat ya, bang!', en: '', mood: { kids: 'happy', mak: 'worried', ayah: 'happy' } },
  { t: 2.2, shot: 'ayah', who: 'Ayah', ms: 'InsyaAllah. Tunggu ayah balik!', en: '', mood: { kids: 'happy', mak: 'love', ayah: 'proud' } },
  { t: 4.4, shot: 'follow', who: 'Anak-anak', ms: 'Bye ayah!', en: '', leave: true, mood: { kids: 'excited', mak: 'love', ayah: 'proud' } },
];
const OUTRO = [
  { t: 0, shot: 'wide', who: 'Anak-anak', ms: 'Ayah dah balik!! Yeay!', en: '', mood: { kids: 'excited', mak: 'shock', ayah: 'happy' } },
  { t: 2.4, shot: 'kids', who: 'Anak-anak', ms: 'Ayah bawa remah roti! Sedapnya!', en: '', mood: { kids: 'excited', mak: 'happy', ayah: 'happy' } },
  { t: 4.6, shot: 'mak', who: 'Mak', ms: 'Alhamdulillah, abang selamat sampai.', en: '', mood: { kids: 'happy', mak: 'joy', ayah: 'love' } },
  { t: 6.9, shot: 'ayah', who: 'Ayah', ms: 'Untuk keluarga, ayah sanggup buat apa saja.', en: '', mood: { kids: 'love', mak: 'joy', ayah: 'proud' } },
  { t: 9.4, shot: 'wide', who: 'Mak', ms: 'Jom masuk, kita makan!', en: '', mood: { kids: 'excited', mak: 'happy', ayah: 'happy' } },
];
// Dad didn't make it: the family comes running and cries over him
const DEATH = [
  { t: 0, shot: 'dwide', who: 'Anak-anak', ms: 'AYAAAH!!', en: '', mood: { kids: 'shock', mak: 'shock', ayah: 'dead' } },
  { t: 2.3, shot: 'mak', who: 'Mak', ms: 'Abang... bangunlah, bang...', en: '', sob: true, mood: { kids: 'cry', mak: 'cry', ayah: 'dead' } },
  { t: 5.0, shot: 'kids', who: 'Anak-anak', ms: 'Ayah... jangan tinggalkan kami...', en: '', sob: true, mood: { kids: 'cry', mak: 'cry', ayah: 'dead' } },
  { t: 7.6, shot: 'dhigh', who: 'Mak', ms: 'Kita takkan lupakan abang...', en: '', sob: true, mood: { kids: 'cry', mak: 'cry', ayah: 'dead' } },
];
function setFaces(on) { for (const m of [roach, ...family]) m.showFace(on); }
let talkT = 0;
const WIDE_SHOT = [new THREE.Vector3(20.1, 11.25, 16.3), new THREE.Vector3(20.4, 10.15, 19.2)];

function showLine(l) {
  $('cineWho').textContent = l.who;
  $('cineMs').textContent = l.ms;
  $('cineEn').textContent = l.en;
  $('cineBubble').classList.remove('bubblePop');
  void $('cineBubble').offsetWidth;
  $('cineBubble').classList.add('bubblePop');
  // gibberish voice for the speaker (or sobbing), and everyone's face for this line
  const voice = l.who === 'Anak-anak' ? 'kids' : l.who === 'Mak' ? 'mak' : 'ayah';
  const dur = Math.min(2.4, 0.5 + l.ms.length * 0.045);
  if (l.sob) { sfx.sob(voice, 2.4); if (voice !== 'kids' && cine.kind === 'death') sfx.sob('kids', 2.2); }
  else sfx.babble(voice, dur);
  talkT = dur;
  const m = l.mood || {};
  roach.setMood(m.ayah, voice === 'ayah');
  wife.setMood(m.mak, voice === 'mak');
  kids.forEach((k) => k.setMood(m.kids, voice === 'kids'));
}

// Camera for a shot. Close-ups sit in front of the speaker's face and slowly push in; every new line is a hard cut.
function shotCam(shot, lt, dt) {
  if (shot === 'wide') {
    const drift = Math.min(1, lt / 4);
    camera.position.copy(WIDE_SHOT[0]).add(new THREE.Vector3(-0.3 * drift, -0.15 * drift, 0.35 * drift));
    cam.target.copy(WIDE_SHOT[1]);
  } else if (shot === 'follow') {
    const behind = roach.pos.clone().add(new THREE.Vector3(0, 0.75, 2.0));
    behind.z = Math.min(behind.z, ROOM.hz - 0.15);
    camera.position.lerp(behind, 1 - Math.exp(-2.5 * dt));
    cam.target.lerp(new THREE.Vector3(roach.pos.x, roach.pos.y + 0.2, roach.pos.z - 2), 1 - Math.exp(-2.5 * dt));
  } else {
    let c, h, s;
    if (shot === 'dwide' || shot === 'dhigh') {
      // death scene: the family around Dad's body, seen from the side away from danger
      const D = cine.death;
      const push = Math.min(1, lt / 4);
      const back = shot === 'dhigh' ? 1.6 : 2.3 - 0.4 * push, up = shot === 'dhigh' ? 1.9 + 0.3 * push : 0.75;
      const want = D.body.clone().addScaledVector(D.side, back).addScaledVector(D.dir, 0.9).add(new THREE.Vector3(0, up, 0));
      placeCam(D.body.clone().addScaledVector(D.dir, 0.4).add(new THREE.Vector3(0, 0.15, 0)), want);
      camera.up.set(0, 1, 0);
      camera.lookAt(cam.target);
      return;
    }
    if (shot === 'kids') {
      c = kids.reduce((a, k) => a.add(k.pos), new THREE.Vector3()).divideScalar(kids.length);
      h = kids[1].heading;
      s = 0.85;
    } else {
      const who = shot === 'mak' ? wife : roach;
      c = who.pos.clone();
      h = who.heading;
      s = 0.75;
    }
    const push = Math.min(1, lt / 3); // slow dolly-in
    const f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const side = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    const dist = (1.1 - 0.3 * push) * s;
    const kid = shot === 'kids';
    const want = kid
      ? c.clone().addScaledVector(f, 0.95 - 0.2 * push).addScaledVector(side, -0.9).add(new THREE.Vector3(0, 0.3, 0)) // from the side, past Dad
      : c.clone().addScaledVector(f, dist).addScaledVector(side, 0.3 * s).add(new THREE.Vector3(0, 0.3 * s + 0.05, 0));
    const look = c.clone().addScaledVector(f, 0.12).add(new THREE.Vector3(0, shot === 'kids' ? 0.07 : 0.12, 0));
    if (cine.kind === 'death') placeCam(look, want); // anywhere in the house: don't end up inside furniture
    else { camera.position.copy(want); cam.target.copy(look); }
  }
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.target);
}

function startIntro(full) {
  game.state = 'intro';
  cine.kind = 'intro';
  cine.full = full;
  cine.lines = full ? INTRO_FULL : INTRO_SHORT;
  cine.end = full ? 16.2 : 6.6;
  cine.t = 0;
  cine.line = -1;
  roach.pos.copy(DAD_HOME);
  roach.heading = 0; // facing his family
  roach.setTie(true);
  placeFamily(false); // the family came out of the nest to say goodbye
  setFamilyVisible(true);
  setFaces(true);
  ui.cine.classList.remove('hidden');
  $('cineSkip').classList.remove('hidden');
}

function startOutro() {
  game.state = 'outro';
  cine.kind = 'outro';
  cine.lines = OUTRO;
  cine.end = 11.4;
  cine.t = 0;
  cine.line = -1;
  cine.from = roach.pos.clone();
  roach.climb = null;
  roach.vel.set(0, 0, 0);
  ui.hud.classList.add('hidden');
  ui.touch.classList.add('hidden');
  ui.cine.classList.remove('hidden');
  $('cineSkip').classList.add('hidden');
  sfx.silence();
  document.exitPointerLock?.();
  roach.setTie(true);
  setFaces(true);
  // the family comes out of the nest to meet him
  placeFamily(true);
  setFamilyVisible(true);
  hearts.forEach((h, i) => { h.userData.t = -i * 0.25; h.visible = true; });
}

function skipCine() {
  if (game.state === 'intro') { roach.pos.copy(DAD_OUT); roach.heading = Math.PI; startCountdown(); }
  else if (game.state === 'death') finishDeath();
}

// Keep a cutscene camera out of walls and furniture (pull in towards the subject if something is in the way)
function placeCam(look, want) {
  const d = want.clone().sub(look);
  const len = d.length();
  d.normalize();
  const hit = world.raySolids(look, d, len);
  const p = look.clone().addScaledVector(d, hit < len ? Math.max(0.3, hit - 0.1) : len);
  p.x = clampX(p.x, 0.15);
  p.z = clampZ(p.z, 0.15);
  p.y = clamp(p.y, 0.08, ROOM.height - 0.2);
  camera.position.copy(p);
  cam.target.copy(look);
}

// Dad died: the family rushes over from the safe side and cries around his body
function startDeath() {
  game.state = 'death';
  cine.kind = 'death';
  cine.lines = DEATH;
  cine.end = 10.4;
  cine.t = 0;
  cine.line = -1;
  const body = roach.pos.clone();
  body.y = world.groundAt(body.x, body.z, body.y + 0.3);
  // come from the side away from whoever did it (and from any wall)
  const away = new THREE.Vector3(body.x - person.pos.x, 0, body.z - person.pos.z);
  if (person.asleep || away.lengthSq() < 1) away.set(-body.x, 0, -body.z);
  away.normalize();
  let dir = away;
  for (let k = 0; k < 8; k++) {
    const a = Math.atan2(away.x, away.z) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.6;
    const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const p = body.clone().addScaledVector(d, 1.2);
    if (world.isFree(p.x, body.y + 0.1, p.z, 0.15) && Math.abs(p.x) < ROOM.hx - 0.5 && Math.abs(p.z) < ROOM.hz - 0.5) { dir = d; break; }
  }
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  cine.death = { body, dir, side };
  // spots in a little half-circle on that side, facing Dad
  family.forEach((m, i) => {
    const a = (i - 1.5) * 0.55;
    const r = i === 0 ? 0.62 : 0.5 + (i % 2) * 0.12;
    const spot = body.clone().addScaledVector(dir, Math.cos(a) * r).addScaledVector(side, Math.sin(a) * r);
    m.deathSpot = spot;
    m.pos.copy(body).addScaledVector(dir, 3.2 + i * 0.25).addScaledVector(side, Math.sin(a) * 1.2);
    m.pos.y = body.y;
    m.heading = Math.atan2(-dir.x, -dir.z);
    m.orient(1);
  });
  setFamilyVisible(true);
  setFaces(true);
  roach.showFace(false); // he's belly-up
  flashAmt = poisonAmt = 0;
  for (const el of [ui.flash, ui.poison, ui.vignette]) el.style.opacity = 0;
  ui.warn.classList.remove('show');
  ui.hud.classList.add('hidden');
  ui.touch.classList.add('hidden');
  ui.cine.classList.remove('hidden');
  $('cineSkip').classList.remove('hidden');
  sfx.silence();
  releaseTouch();
  document.exitPointerLock?.();
}

function updateDeath(dt, time) {
  const D = cine.death;
  family.forEach((m, i) => {
    const d = m.deathSpot.clone().sub(m.pos);
    d.y = 0;
    let walk = 0;
    if (d.length() > 0.03 && cine.t > i * 0.15) {
      m.heading = lerpAngle(m.heading, Math.atan2(d.x, d.z), 1 - Math.exp(-10 * dt));
      m.pos.addScaledVector(d.normalize(), Math.min(d.length(), 2.6 * dt)); // running
      walk = 2.4;
    } else if (d.length() <= 0.03) {
      const toBody = D.body.clone().sub(m.pos);
      m.heading = lerpAngle(m.heading, Math.atan2(toBody.x, toBody.z), 1 - Math.exp(-6 * dt));
    }
    m.pos.y = D.body.y;
    // sobbing bob once they've arrived
    m.pose(dt, time, walk, walk ? 0 : Math.abs(Math.sin(time * 7 + i)) * 0.015);
  });
  if (cine.t >= cine.end) finishDeath();
}

function finishDeath() {
  ui.cine.classList.add('hidden');
  setFamilyVisible(false);
  setFaces(false);
  endGame(false);
}

function cineCam(pos, look, k) {
  camera.position.lerp(new THREE.Vector3(...pos), k);
  cam.target.lerp(new THREE.Vector3(...look), k);
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.target);
}

function updateCine(dt, time) {
  cine.t += dt;
  const lines = cine.lines;
  let li = 0;
  for (let i = 0; i < lines.length; i++) if (cine.t >= lines[i].t) li = i;
  if (li !== cine.line) { cine.line = li; showLine(lines[li]); }
  talkT -= dt;
  if (talkT <= 0) for (const m of [roach, ...family]) m.talking = false;
  const l = lines[li];
  if (cine.kind === 'death') { updateDeath(dt, time); if (game.state === 'death') shotCam(l.shot, cine.t - l.t, dt); return; }
  if (cine.kind === 'intro') {
    let walk = 0;
    if (l.leave) {
      // Dad turns around and heads out
      const lt = cine.t - l.t;
      roach.heading = lerpAngle(roach.heading, Math.PI, 1 - Math.exp(-5 * dt));
      if (lt > 0.6) {
        const d = DAD_OUT.clone().sub(roach.pos);
        if (d.length() > 0.03) { roach.pos.addScaledVector(d.normalize(), Math.min(d.length(), 1.4 * dt)); walk = 1.4; }
      }
    } else {
      roach.heading = 0;
    }
    // Dad nods / straightens his tie while talking
    roach.pose(dt, time, walk, l.who === 'Ayah' && !l.leave ? Math.abs(Math.sin(time * 5)) * 0.03 : 0);
    if (l.leave && cine.t - l.t > 1.0) famWalk(dt, time, true); // back into the nest
    else animateFamily(dt, time, l.leave ? 'wave' : 'idle');
    if (l.who === 'Mak' && !l.leave) wife.pose(dt, time, 0, Math.abs(Math.sin(time * 12)) * 0.02); // talking bob
    shotCam(l.shot, cine.t - l.t, dt);
    if (cine.t >= cine.end) startCountdown();
  } else {
    // Outro: the family runs out of the nest, Dad walks to them, they celebrate, then everyone goes inside
    const goingIn = cine.t > cine.end - 1.9;
    const target = goingIn ? new THREE.Vector3(20, NEST.y, ROOM.hz + 0.6) : new THREE.Vector3(20.35, NEST.y, 19.0);
    const d = target.clone().sub(roach.pos);
    d.y = 0;
    let walk = 0;
    if (d.length() > 0.05) {
      roach.heading = lerpAngle(roach.heading, Math.atan2(d.x, d.z), 1 - Math.exp(-8 * dt));
      roach.pos.addScaledVector(d.normalize(), Math.min(d.length(), 1.6 * dt));
      walk = 1.6;
    } else if (!goingIn) {
      roach.heading = lerpAngle(roach.heading, Math.PI, 1 - Math.exp(-6 * dt));
    }
    roach.pos.y = NEST.y;
    roach.pose(dt, time, walk, walk ? 0 : Math.abs(Math.sin(time * 6)) * 0.06);
    if (cine.t < 1.6) famWalk(dt, time, false); // out of the hole
    else if (goingIn) famWalk(dt, time, true); // home, together
    else animateFamily(dt, time, 'party');
    if (Math.random() < dt * 2) sfx.chirp(2);
    hearts.forEach((h) => {
      h.userData.t += dt;
      const t = h.userData.t;
      h.visible = t > 0;
      if (t < 0) return;
      const ph = t % 2.2;
      h.position.set(20.3 + Math.sin(t * 2 + h.id) * 0.6, NEST.y + 0.3 + ph * 0.8, 19.2 + Math.cos(t * 1.7 + h.id) * 0.3);
      h.material.opacity = Math.max(0, 1 - ph / 2.2);
    });
    shotCam(l.shot, cine.t - l.t, dt);
    if (cine.t >= cine.end) {
      ui.cine.classList.add('hidden');
      hearts.forEach((h) => { h.visible = false; });
      endGame(true);
    }
  }
}

// Floating love hearts for the reunion
const heartTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ff4f9a';
  g.beginPath();
  g.moveTo(32, 56);
  g.bezierCurveTo(-8, 30, 12, 0, 32, 18);
  g.bezierCurveTo(52, 0, 72, 30, 32, 56);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const hearts = Array.from({ length: 8 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
  s.scale.setScalar(0.28);
  s.visible = false;
  scene.add(s);
  return s;
});

// 3, 2, 1, MULA!
const countdown = { t: 0, n: 4 };
function startCountdown() {
  game.state = 'countdown';
  ui.cine.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.countdown.classList.remove('hidden');
  setFamilyVisible(false); // they're back inside the nest
  setFaces(false);
  roach.setTie(false); // the tie is just for the cutscenes
  countdown.t = 0;
  countdown.n = 4;
  cam.fwd.set(0, 0, -1);
  cam.up.set(0, 1, 0);
  cam.pitch = 0.55; // look over the kids' heads (they're right behind Dad)
  cam.target.copy(roach.pos);
}
function updateCountdown(dt) {
  countdown.t += dt;
  const n = 3 - Math.floor(countdown.t / 0.85); // 3,2,1,0(=MULA)
  if (n !== countdown.n) {
    countdown.n = n;
    const el = $('countNum');
    el.textContent = n > 0 ? String(n) : n === 0 ? 'GO!' : '';
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
    if (n >= 0) sfx.count(n);
  }
  if (countdown.t > 0.85 * 4) {
    ui.countdown.classList.add('hidden');
    game.state = 'playing';
    game.warn(LEVELS[levelIdx].tip);
    if (isTouch) {
      ui.touch.classList.remove('hidden');
      document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    } else {
      lockPointer();
    }
  }
}

// The house keeps living in the background during menus and cutscenes (you're safe in the nest)
function ambient(dt, time) {
  roach.inNest = true;
  world.dynamic.length = 0;
  person.colliders(world.dynamic);
  cat.colliders(world.dynamic);
  car.colliders(world.dynamic);
  person.update(dt, roach, game);
  cat.update(dt, roach, game, person);
  car.update(dt, roach, game);
  world.updateProps(dt);
}

function endGame(won) {
  game.state = 'over';
  game.won = won;
  sfx.silence();
  const t = game.time.toFixed(1);
  const heading = $('cause');
  const stars = [...document.querySelectorAll('#starsRow span')];
  stars.forEach((s) => s.classList.remove('on'));
  if (won) {
    sfx.win();
    // 3 stars = never spotted, 2 = spotted a couple of times, 1 = made it home anyway
    const n = game.spotted === 0 ? 3 : game.spotted <= 2 ? 2 : 1;
    const rating = ['', 'LOUD BUT ALIVE', 'SNEAKY', 'GHOST 👻'][n];
    const best = loadBest();
    if (!best || game.time < best) saveBest(game.time);
    const total = score() + Math.max(0, Math.round(3000 - game.time * 10)) + n * 500; // speed + stealth bonus
    heading.textContent = `Level ${levelIdx + 1} Complete!`;
    heading.className = 'ribbon good';
    $('bigScore').textContent = total.toLocaleString();
    stars.forEach((s, i) => setTimeout(() => { if (i < n) { s.classList.add('on'); sfx.pickup(); } }, 350 + i * 350));
    ui.final.innerHTML = `Dad made it home with <b>${CRUMB_COUNT}</b> crumbs in <b>${t}s</b><br>Spotted <b>${game.spotted}</b>× · Rating <b>${rating}</b>`;
    // save stars + unlock the next level
    const prog = loadProgress();
    prog.stars[levelIdx] = Math.max(prog.stars[levelIdx] || 0, n);
    prog.unlocked = Math.max(prog.unlocked, Math.min(LEVELS.length, levelIdx + 2));
    saveProgress(prog);
    const last = levelIdx >= LEVELS.length - 1;
    $('again').textContent = last ? 'PLAY AGAIN' : 'NEXT LEVEL ▶';
    $('again').dataset.next = last ? String(levelIdx) : String(levelIdx + 1);
  } else {
    heading.textContent = 'Level Failed';
    heading.className = 'ribbon';
    $('bigScore').textContent = score().toLocaleString();
    const pct = progress();
    stars.forEach((s, i) => { if (pct >= (i + 1) / 3) s.classList.add('on'); });
    ui.final.innerHTML = `<b>${game.cause}</b><br>Crumbs <b>${game.crumbsEaten}/${CRUMB_COUNT}</b> · <b>${t}s</b><br>The family is still waiting...`;
    $('again').textContent = 'TRY AGAIN';
    $('again').dataset.next = String(levelIdx);
  }
  heading.dataset.level = String(levelIdx + 1);
  ui.over.classList.remove('hidden');
  ui.touch.classList.add('hidden');
  releaseTouch();
  document.exitPointerLock?.();
}

function togglePause() {
  if (game.state === 'playing' && !roach.dead) {
    game.state = 'paused';
    ui.paused.classList.remove('hidden');
    sfx.silence();
    releaseTouch();
    document.exitPointerLock?.();
  } else if (game.state === 'paused') {
    game.state = 'playing';
    ui.paused.classList.add('hidden');
    if (!isTouch) lockPointer();
  }
}

$('start').addEventListener('click', () => { sfx.init(); showScreen('select'); });
// ---------------------------------------------------------------- Character select (interactive)
const CHARACTERS = {
  lipas: { icon: '🪳', name: 'Lipas', locked: false, desc: 'A brave cockroach dad. Climbs any wall, flies short hops, squeezes under anything.', stats: { Speed: 4, Stealth: 4, Climb: 5, Fly: 3 } },
  tikus: { icon: '🐀', name: 'Tikus', locked: true, desc: 'A quick, greedy rat. Gnaws through boxes and outruns the cat... almost.', stats: { Speed: 5, Stealth: 3, Climb: 2, Fly: 0 } },
  cicak: { icon: '🦎', name: 'Cicak', locked: true, desc: 'A gecko that walks on ceilings and drops its tail to escape.', stats: { Speed: 3, Stealth: 5, Climb: 5, Fly: 0 } },
  nyamuk: { icon: '🦟', name: 'Nyamuk', locked: true, desc: 'A tiny mosquito. Flies all day, buzzes in ears, dodges slippers.', stats: { Speed: 3, Stealth: 4, Climb: 0, Fly: 5 } },
  oyen: { icon: '🐈', name: 'Oyen', locked: true, desc: 'The orange menace himself. Hunt the bugs for a change!', stats: { Speed: 4, Stealth: 2, Climb: 3, Fly: 0 } },
};
let selChar = 'lipas';
const charCards = [...document.querySelectorAll('.char')];
function selectChar(id, sound = true) {
  selChar = id;
  const c = CHARACTERS[id];
  charCards.forEach((el) => el.classList.toggle('sel', el.dataset.ch === id));
  $('preview').classList.toggle('locked', c.locked);
  const icon = $('pvIcon');
  icon.textContent = c.icon;
  icon.classList.remove('pop');
  void icon.offsetWidth;
  icon.classList.add('pop');
  $('pvName').textContent = c.name;
  $('pvDesc').textContent = c.desc;
  $('pvStats').innerHTML = Object.entries(c.stats)
    .map(([k, v]) => `<div class="stat">${k}<div class="pips">${[1, 2, 3, 4, 5].map((i) => `<span class="pip${i <= v ? ' on' : ''}"></span>`).join('')}</div></div>`)
    .join('');
  $('chooseBtn').classList.toggle('disabled', c.locked);
  $('chooseBtn').textContent = c.locked ? '🔒 LOCKED' : 'CHOOSE ▶';
  if (sound) { sfx.init(); c.locked ? sfx.warn() : sfx.chirp(2); }
}
function chooseChar() {
  if (CHARACTERS[selChar].locked) {
    const b = $('chooseBtn');
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    sfx.warn();
    return;
  }
  sfx.init();
  sfx.chirp(4);
  showScreen('map');
}
charCards.forEach((el) => {
  el.addEventListener('click', () => {
    if (selChar === el.dataset.ch && !CHARACTERS[selChar].locked) return chooseChar(); // tap again = choose
    selectChar(el.dataset.ch);
    if (CHARACTERS[el.dataset.ch].locked) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  });
  // 3D tilt following the mouse
  el.addEventListener('mousemove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 22}deg`);
    el.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 22}deg`);
  });
  el.addEventListener('mouseleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  el.addEventListener('mouseenter', () => { if (sfx.ctx) sfx.tone(1200 + Math.random() * 400, 0.04, { type: 'triangle', gain: 0.04 }); });
});
$('chooseBtn').addEventListener('click', chooseChar);
selectChar('lipas', false);
window.addEventListener('keydown', (e) => {
  if (game.state !== 'select') return;
  const ids = Object.keys(CHARACTERS);
  const i = ids.indexOf(selChar);
  if (e.code === 'ArrowRight' || e.code === 'ArrowDown') selectChar(ids[(i + 1) % ids.length]);
  if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') selectChar(ids[(i + ids.length - 1) % ids.length]);
  if (e.code === 'Enter') chooseChar();
});
$('backTitle').addEventListener('click', () => showScreen('title'));
$('backSelect').addEventListener('click', () => showScreen('select'));
$('again').addEventListener('click', () => { const n = Number($('again').dataset.next || levelIdx); beginLevel(n, n === levelIdx); });
$('toMap').addEventListener('click', () => showScreen('map'));
ui.cine.addEventListener('click', skipCine);
$('pResume').addEventListener('click', togglePause);
$('pRestart').addEventListener('click', () => beginLevel(levelIdx, true));
$('pHome').addEventListener('click', goHome);
$('overHome').addEventListener('click', goHome);
$('menuBtn').addEventListener('click', togglePause);
// losing the mouse lock (Esc) mid-game opens the menu
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game.state === 'playing' && !isTouch && !window.__testMode) togglePause(); });
// Back to the title screen (the house resets behind it)
function goHome() {
  sfx.silence();
  document.exitPointerLock?.();
  releaseTouch();
  resetGame();
  showScreen('title');
}

// ---------------------------------------------------------------- Keyboard
const keys = new Set();
let jumpQueued = false;
window.addEventListener('keydown', (e) => {
  if (window.__testMode && e.isTrusted) return; // automated tests: ignore real keyboard
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !e.repeat) jumpQueued = true;
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyV') toggleView();
  if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') && (game.state === 'intro' || game.state === 'death')) skipCine();
  if (e.code === 'Enter' && game.state === 'over') $('again').click();
  if (e.code === 'Escape' && (game.state === 'playing' || game.state === 'paused')) togglePause();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---------------------------------------------------------------- Touch controls
const touch = { ax: 0, ay: 0, fly: false, eat: false, stickId: null, lookId: null, sx: 0, sy: 0, lx: 0, ly: 0 };
const STICK_R = 50;
const stickEl = $('stick'), knobEl = $('knob'), flyBtn = $('btnFly');
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* not critical */ } };

function releaseTouch() {
  Object.assign(touch, { ax: 0, ay: 0, fly: false, eat: false, stickId: null, lookId: null });
  stickEl.classList.remove('active');
  stickEl.style.left = stickEl.style.top = '';
  knobEl.style.transform = '';
  flyBtn.classList.remove('on');
  ui.btnEat.classList.remove('on');
}

$('stickZone').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (touch.stickId !== null) return;
  touch.stickId = e.pointerId;
  touch.sx = e.clientX;
  touch.sy = e.clientY;
  stickEl.style.left = `${e.clientX}px`;
  stickEl.style.top = `${e.clientY}px`;
  stickEl.classList.add('active');
  capture(e.currentTarget, e.pointerId);
});
$('stickZone').addEventListener('pointermove', (e) => {
  if (e.pointerId !== touch.stickId) return;
  let dx = e.clientX - touch.sx, dy = e.clientY - touch.sy;
  const len = Math.hypot(dx, dy);
  if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len; }
  touch.ax = dx / STICK_R;
  touch.ay = -dy / STICK_R;
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endStick = (e) => {
  if (e.pointerId !== touch.stickId) return;
  touch.stickId = null;
  touch.ax = touch.ay = 0;
  knobEl.style.transform = '';
  stickEl.classList.remove('active');
  stickEl.style.left = stickEl.style.top = '';
};
$('stickZone').addEventListener('pointerup', endStick);
$('stickZone').addEventListener('pointercancel', endStick);

$('lookZone').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (touch.lookId !== null) return;
  touch.lookId = e.pointerId;
  touch.lx = e.clientX;
  touch.ly = e.clientY;
  capture(e.currentTarget, e.pointerId);
});
$('lookZone').addEventListener('pointermove', (e) => {
  if (e.pointerId !== touch.lookId) return;
  pendingTurn += (e.clientX - touch.lx) * 0.006;
  cam.pitch = clamp(cam.pitch + (e.clientY - touch.ly) * 0.005, -0.35, 1.35);
  touch.lx = e.clientX;
  touch.ly = e.clientY;
});
const endLook = (e) => { if (e.pointerId === touch.lookId) touch.lookId = null; };
$('lookZone').addEventListener('pointerup', endLook);
$('lookZone').addEventListener('pointercancel', endLook);

flyBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jumpQueued = true;
  touch.fly = true;
  flyBtn.classList.add('on');
  capture(flyBtn, e.pointerId);
});
const endFly = () => { touch.fly = false; flyBtn.classList.remove('on'); };
flyBtn.addEventListener('pointerup', endFly);
flyBtn.addEventListener('pointercancel', endFly);
ui.btnEat.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.eat = true; ui.btnEat.classList.add('on'); capture(ui.btnEat, e.pointerId); });
const endEat = () => { touch.eat = false; ui.btnEat.classList.remove('on'); };
ui.btnEat.addEventListener('pointerup', endEat);
ui.btnEat.addEventListener('pointercancel', endEat);
$('btnPause').addEventListener('click', togglePause);
$('btnCam').addEventListener('click', () => toggleView());
document.addEventListener('contextmenu', (e) => { if (isTouch) e.preventDefault(); });

function readInput() {
  const stickMag = Math.hypot(touch.ax, touch.ay);
  const i = {
    fwd: keys.has('KeyW') || keys.has('ArrowUp'),
    back: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    ax: touch.ax,
    ay: touch.ay,
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || stickMag > 0.92,
    fly: keys.has('Space') || touch.fly,
    eat: keys.has('KeyE') || touch.eat,
    jump: jumpQueued,
    lookTurn: pendingTurn,
  };
  jumpQueued = false;
  pendingTurn = 0;
  return i;
}

// ---------------------------------------------------------------- Camera
// Camera is locked behind the roach ('chase'), or sits on its head ('eyes' = bug's-eye view). Press V to switch.
const cam = { mode: 'chase', yaw: 0, pitch: 0.25, dist: 2.2, target: new THREE.Vector3(), fov: BASE_FOV, dip: 0, fwd: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) };
let pendingTurn = 0; // mouse / touch drag turns the roach itself
function toggleView() {
  cam.mode = cam.mode === 'chase' ? 'eyes' : 'chase';
  if (game.state === 'playing') game.warn(cam.mode === 'eyes' ? "Bug's-eye view" : 'Behind view');
}
let dragging = false;
canvas.addEventListener('mousedown', () => {
  dragging = true;
  if (game.state === 'playing' && document.pointerLockElement !== canvas) lockPointer();
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (window.__testMode) return;
  if (document.pointerLockElement === canvas || dragging) {
    pendingTurn += e.movementX * 0.0028;
    cam.pitch = clamp(cam.pitch + e.movementY * 0.0022, -0.35, 1.35);
  }
});
canvas.addEventListener('wheel', (e) => {
  cam.dist = clamp(cam.dist + e.deltaY * 0.002, 1.0, 6);
  e.preventDefault();
}, { passive: false });

const ray = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
function updateCamera(dt) {
  // Dynamic FOV: wider and faster-feeling when scurrying or flying
  const speedK = clamp(roach.speed / 8, 0, 1);
  const eyes = cam.mode === 'eyes' && !roach.dead && !isMenu();
  const fovGoal = BASE_FOV + speedK * 8 + roach.open * 12 + (eyes ? 8 : 0);
  cam.fov += (fovGoal - cam.fov) * (1 - Math.exp(-4 * dt));
  if (Math.abs(camera.fov - cam.fov) > 0.01) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }
  // Spider-Man style: the camera follows the roach's own frame (forward + "up"). On the floor up is the sky;
  // on a wall up is the wall's normal, so the whole view rolls onto the wall with the bug.
  let fr;
  if (isMenu()) fr = { fwd: new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)), up: new THREE.Vector3(0, 1, 0) };
  else if (roach.dead) fr = { fwd: cam.fwd.clone(), up: new THREE.Vector3(0, 1, 0) };
  else fr = roach.frame();
  // Only roll onto the wall once the bug is really up it (not for the first bit of a climb)
  if (roach.climb && !roach.dead && !isMenu()) {
    const kc = clamp((roach.pos.y - roach.climb.y0 - 0.4) / 1.8, 0, 1);
    const n = roach.climb.n;
    fr = {
      fwd: new THREE.Vector3(-n.x, 0, -n.z).lerp(fr.fwd, kc).normalize(),
      up: new THREE.Vector3(0, 1, 0).lerp(fr.up, kc).normalize(),
    };
  }
  const kf = isMenu() ? 1 : 1 - Math.exp(-7 * dt);
  cam.fwd.lerp(fr.fwd, kf);
  cam.up.lerp(fr.up, kf);
  if (cam.up.lengthSq() < 1e-4) cam.up.set(0, 1, 0);
  cam.up.normalize();
  const fwd = cam.fwd.clone().addScaledVector(cam.up, -cam.fwd.dot(cam.up));
  if (fwd.lengthSq() < 1e-4) fwd.set(1, 0, 0).addScaledVector(cam.up, -cam.up.x);
  fwd.normalize();
  if (Math.hypot(fwd.x, fwd.z) > 0.2) cam.yaw = Math.atan2(-fwd.x, -fwd.z); // for the compass
  roach.model.visible = !eyes;
  // drunk sway while high on spray
  const hk = Math.min(1, roach.high / 4);
  const sway = hk > 0 ? Math.sin(performance.now() / 1000 * 1.3) * 0.18 * hk : 0;
  if (hk > 0) {
    camera.fov = cam.fov + Math.sin(performance.now() / 1000 * 2.1) * 7 * hk;
    camera.updateProjectionMatrix();
  }
  if (eyes) {
    // Bug's-eye: camera on the roach's head, looking where it faces (along the wall when climbing)
    const elev = -(cam.pitch - 0.25) * 1.1;
    const eye = roach.pos.clone().addScaledVector(cam.up, 0.16 - cam.dip).addScaledVector(fwd, 0.3);
    const look = eye.clone().addScaledVector(fwd, Math.cos(elev)).addScaledVector(cam.up, Math.sin(elev));
    cam.dip *= Math.exp(-8 * dt);
    camera.position.copy(eye);
    if (game.shakeAmt > 0.001) {
      camera.position.x += (Math.random() - 0.5) * game.shakeAmt * 0.5;
      camera.position.y += (Math.random() - 0.5) * game.shakeAmt * 0.3;
      game.shakeAmt *= Math.exp(-7 * dt);
    }
    camera.up.copy(cam.up);
    camera.lookAt(look);
    camera.rotateZ(-roach.bank * 0.5 + sway);
    cam.target.copy(roach.pos);
    return;
  }
  const goal = roach.pos.clone().addScaledVector(cam.up, 0.3 - cam.dip);
  cam.dip *= Math.exp(-8 * dt);
  cam.target.lerp(goal, 1 - Math.exp(-15 * dt));
  // pull the camera a bit closer to the ground when scurrying (feels faster); look a little more from above on walls
  const dist = cam.dist * (1 - speedK * 0.12);
  const pitch = cam.pitch + (roach.climb ? 0.3 * clamp((roach.pos.y - roach.climb.y0 - 0.4) / 1.8, 0, 1) : 0);
  tmpDir.copy(fwd).multiplyScalar(-Math.cos(pitch)).addScaledVector(cam.up, Math.sin(pitch)).normalize();
  let d = dist;
  // keep the camera out of furniture (cheap box test against the colliders)
  const hitD = world.raySolids(cam.target, tmpDir, d);
  if (hitD < d) d = Math.max(0.25, hitD - 0.12);
  const p = cam.target.clone().addScaledVector(tmpDir, d);
  p.x = clampX(p.x, 0.1);
  p.z = clampZ(p.z, 0.1);
  p.y = clamp(p.y, 0.06, ROOM.height - 0.1);
  if (game.shakeAmt > 0.001) {
    p.x += (Math.random() - 0.5) * game.shakeAmt;
    p.y += (Math.random() - 0.5) * game.shakeAmt;
    p.z += (Math.random() - 0.5) * game.shakeAmt;
    game.shakeAmt *= Math.exp(-7 * dt);
  }
  camera.position.copy(p);
  camera.up.copy(cam.up);
  camera.lookAt(cam.target);
  camera.rotateZ(-roach.bank * 0.25 + sway); // tilt the view slightly with the roach's lean (and sway when high)
}

// ---------------------------------------------------------------- Loop
let lastStep = 0;
let mothWarnT = 0;
let crunchTimer = 0;
let nearFood = null;

function step(dt, time) {
  const playing = game.state === 'playing' && !roach.dead;
  const input = playing ? readInput() : {};
  if (!playing) jumpQueued = false;

  if (playing) {
    game.time += dt;
    game.difficulty = Math.min(1, game.time / 240);
  }

  // Eating
  nearFood = playing ? foods.reachable(roach) : null;
  roach.eating = !!(nearFood && input.eat);
  if (roach.eating) {
    const amt = Math.min(nearFood.remaining, 7 * dt);
    nearFood.remaining -= amt;
    game.protein += amt;
    roach.health = Math.min(100, roach.health + amt * 3); // snacks = your life
    roach.stamina = Math.min(100, roach.stamina + amt * 2);
    crunchTimer -= dt;
    if (crunchTimer <= 0) { sfx.crunch(); crunchTimer = 0.17; }
    foods.refresh(nearFood);
    if (Math.random() < dt * 3) popup(`+${Math.round(amt * 10 / dt / 3)}`, 'crumb', 50, 60);
    if (nearFood.remaining <= 0.01) {
      sfx.foodDone();
      game.warn(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
      popup(`${nearFood.name}  +${nearFood.protein * 10}`, 'big', 50, 48);
    }
  }

  // Characters' bodies are solid: refresh their colliders before the roach moves
  world.dynamic.length = 0;
  person.colliders(world.dynamic);
  cat.colliders(world.dynamic);
  car.colliders(world.dynamic);
  roach.update(dt, input, cam.yaw, time);
  if (roach.invuln > 0) roach.invuln -= dt;
  world.updateProps(dt);
  // Ubat gegat fumes hurt; walking into a roach trap is the end
  for (const m of world.mothballs) {
    m.haze.material.opacity = 0.45 + 0.2 * Math.sin(time * 2 + m.x);
    if (playing && roach.pos.y < 1.2 && Math.hypot(roach.pos.x - m.x, roach.pos.z - m.z) < m.r) {
      game.damage(14 * dt, 'Choked on ubat gegat fumes', { dot: true });
      mothWarnT -= dt;
      if (mothWarnT <= 0) { game.warn('Ubat gegat! The fumes burn!'); sfx.hurt(); mothWarnT = 2.5; }
    }
  }
  for (const tr of world.traps) {
    if (playing && roach.pos.y < 0.3 && Math.abs(roach.pos.x - tr.x) < tr.hx && Math.abs(roach.pos.z - tr.z) < tr.hz) {
      roach.vel.set(0, 0, 0);
      game.warn('STUCK IN THE TRAP!');
      game.damage(999, 'Stuck in a roach trap!', { dot: true });
    }
  }
  // Inside the nest hole (top of the tall cupboard) or the wall crack, nobody can see or reach you
  roach.inNest = (Math.abs(roach.pos.y - NEST.y) < 0.35 && Math.hypot(roach.pos.x - NEST.x, roach.pos.z - NEST.z) < 1.6) ||
    (roach.pos.y < 0.3 && Math.hypot(roach.pos.x - CRACK.x, roach.pos.z - CRACK.z) < 0.9);
  person.update(dt, roach, game);
  cat.update(dt, roach, game, person);
  broom.update(dt, roach, game);
  spray.update(dt, roach, game);
  car.update(dt, roach, game);
  foods.update(time);

  // Crumbs: 2 protein each, never respawn
  for (const c of crumbs) {
    if (!c.visible) continue;
    c.rotation.y += dt;
    c.position.y = c.userData.base + Math.sin(time * 3 + c.userData.ph) * 0.02;
    if (playing && c.position.distanceTo(roach.pos) < 0.45) {
      c.visible = false;
      game.crumbsEaten++;
      game.lastFind = game.time;
      game.protein += 2;
      roach.health = Math.min(100, roach.health + 4);
      roach.stamina = Math.min(100, roach.stamina + 10);
      sfx.pickup();
      popup('+20', 'crumb');
      if (game.crumbsEaten === CRUMB_COUNT) game.warn('All crumbs eaten!');
    }
  }

  // Escape
  const clear = allClear();
  world.nestGlow.visible = clear;
  if (clear) world.nestGlow.material.opacity = 0.5 + 0.4 * Math.sin(time * 5);
  if (playing && clear && Math.hypot(roach.pos.x - NEST.x, roach.pos.z - NEST.z) < 1.8 && Math.abs(roach.pos.y - NEST.y) < 0.35) startOutro(); // home! reunion first, then the win screen

  // Sounds: leg ticks while crawling, wing buzz, landing
  // crawling skitter in every situation: floor, furniture, walls, leaves, hopping up ledges
  const crawling = (roach.onGround || roach.climb || roach.mantle) && !roach.dead;
  if (crawling) {
    const s = Math.floor(roach.gait / Math.PI);
    if (s !== lastStep) {
      lastStep = s;
      const surface = roach.climb ? 'wall' : roach.groundNormal ? 'leaf' : 'floor';
      sfx.tick(Math.max(0.35, roach.speed / 8), surface);
    }
  }
  sfx.setWings(game.state === 'playing' ? (roach.flying ? 1 : !roach.onGround ? roach.open * 0.45 : 0) : 0, 1 + clamp(roach.vy, -3, 3) * 0.05);
  if (roach.landed) { sfx.land(roach.landed); cam.dip = 0.1 * roach.landed; roach.landed = 0; }

  if (roach.dead && game.state === 'playing') {
    game.deathTimer -= dt;
    if (game.deathTimer <= 0) startDeath();
  }
}

function stealthStatus() {
  if (person.state === 'panic') return ['HE PANICKED!', '#b38cff', 1];
  if (person.state === 'alert') return [person.rage ? 'HUNTED (FURIOUS)' : 'SPOTTED!', '#ff4d4d', 1];
  if (cat.hunting || cat.state === 'pounce' || cat.state === 'paw') return [roach.inNest ? 'SAFE (CAT WAITING)' : 'CAT IS HUNTING', '#ff4d4d', 1];
  if (roach.inNest) return ['SAFE', '#2fbf4f', 0];
  if (car.state === 'chase') return ['CAR CHASING', '#ff4d4d', 1];
  if (person.state === 'search') return ['SEARCHING...', '#ffa23f', person.suspicion];
  if (cat.sniff > 0.05) return ['CAT SNIFFING', '#c04dff', Math.min(1, cat.sniff)];
  const sus = Math.max(person.suspicion, Math.min(1, cat.suspicion));
  if (sus > 0.02) return [person.seenNow || cat.seenNow ? 'BEING WATCHED' : 'SUSPICIOUS', '#f0a500', sus];
  if (person.seenNow || cat.seenNow) return ['VISIBLE', '#e0a800', 0];
  return ['HIDDEN', '#2fbf4f', 0];
}

// ---------------------------------------------------------------- Minimap (round radar, turns with you)
// Shows the furniture around you, the nest, the human and the cat. If you haven't found a crumb for a while,
// the nearest crumbs appear as pulsing dots (pinned to the edge when they're further away).
const mmCanvas = $('minimap');
const mmCtx = mmCanvas.getContext('2d');
const mmHint = $('mmHint');
let mmT = 0;
const HINT_AFTER = 20; // seconds without finding a crumb
function drawMinimap(dt, clear) {
  mmT -= dt;
  if (mmT > 0) return;
  mmT = 1 / 20;
  const g = mmCtx, W = 256, R = 128, SPAN = 17; // world units from the centre to the edge
  const k = R / SPAN;
  const px = roach.pos.x, pz = roach.pos.z;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const th = -Math.PI / 2 - Math.atan2(fz, fx); // turn the map so "forward" is up
  const c = Math.cos(th), s = Math.sin(th);
  const toMap = (x, z) => { const dx = x - px, dz = z - pz; return [(dx * c - dz * s) * k, (dx * s + dz * c) * k]; };
  g.clearRect(0, 0, W, W);
  g.save();
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(28, 10, 58, 0.62)';
  g.fillRect(0, 0, W, W);
  g.translate(R, R);
  g.save();
  g.rotate(th);
  g.scale(k, k);
  g.translate(-px, -pz);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(-ROOM.hx, -ROOM.hz, ROOM.hx * 2, ROOM.hz * 2);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 3 / k;
  g.strokeRect(-ROOM.hx, -ROOM.hz, ROOM.hx * 2, ROOM.hz * 2);
  g.fillStyle = 'rgba(200,180,255,0.35)';
  for (const so of world.solids) {
    if (so.maxY < 0.3 || so.minY > 6) continue;
    const w = so.maxX - so.minX, d = so.maxZ - so.minZ;
    if (w * d > 260 || w * d < 0.05) continue;
    g.fillRect(so.minX, so.minZ, w, d);
  }
  g.restore();
  const t = performance.now() / 1000;
  const dot = (x, z, r, col, pin) => {
    let [sx, sy] = toMap(x, z);
    const d = Math.hypot(sx, sy), lim = R - r - 4;
    if (d > lim) { if (!pin) return; sx *= lim / d; sy *= lim / d; }
    g.fillStyle = col;
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    return [sx, sy];
  };
  // nest: a little green house, pinned to the edge (and pulsing) once all crumbs are eaten
  const nest = dot(NEST.x, NEST.z, clear ? 9 + Math.sin(t * 6) * 2 : 6, clear ? '#3dff6e' : 'rgba(61,255,110,0.6)', clear);
  if (nest) { g.fillStyle = '#0b3d18'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⌂', nest[0], nest[1] + 1); }
  // the human (red) and the cat (orange) when they're near
  if (!person.asleep) dot(person.pos.x, person.pos.z, 7, '#ff4d4d', false);
  else dot(person.pos.x, person.pos.z, 7, 'rgba(120,140,255,0.8)', false);
  if (cat.mode !== 'sleep') dot(cat.pos.x, cat.pos.z, 5, '#ff9f1c', false);
  // crumb hints
  const left = crumbs.filter((cr) => cr.visible);
  const since = game.time - (game.lastFind || 0);
  let show = 0;
  if (!clear) show = left.length <= 3 ? left.length : since > HINT_AFTER * 2 ? 3 : since > HINT_AFTER ? 1 : 0;
  mmHint.classList.toggle('hidden', show === 0 || game.state !== 'playing');
  if (show) {
    left.sort((a, b) => a.position.distanceToSquared(roach.pos) - b.position.distanceToSquared(roach.pos));
    for (const cr of left.slice(0, show)) {
      const pulse = 6 + Math.sin(t * 6) * 2;
      const p = dot(cr.position.x, cr.position.z, pulse, '#ffd23a', true);
      if (!p) continue;
      g.strokeStyle = '#7a3d00'; g.lineWidth = 2;
      g.beginPath(); g.arc(p[0], p[1], pulse, 0, Math.PI * 2); g.stroke();
      // is it up high or down low compared to you?
      const dy = cr.position.y - roach.pos.y;
      if (Math.abs(dy) > 1.5) { g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText(dy > 0 ? '▲' : '▼', p[0], p[1] - 12); }
    }
  }
  // you: an arrow pointing the way you're facing
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#4a1466';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.stroke(); g.fill();
  g.restore();
}

const angleDiff = (a, b) => ((((a - b + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
function updateHud(dt) {
  ui.hp.style.width = `${roach.health}%`;
  ui.st.style.width = `${roach.stamina}%`;
  ui.time.textContent = `${Math.floor(game.time)}s`;
  const foodsDone = foods.items.filter((f) => f.remaining <= 0.01).length;
  ui.crumbs.textContent = `${game.crumbsEaten}/${CRUMB_COUNT}`;
  ui.tileCrumbs.classList.toggle('done', game.crumbsEaten >= CRUMB_COUNT);
  const sc = score();
  if (sc !== lastScore) {
    ui.score.textContent = sc.toLocaleString();
    ui.score.classList.add('bump');
    setTimeout(() => ui.score.classList.remove('bump'), 120);
    lastScore = sc;
  }
  const pct = progress();
  ui.progFill.style.width = `${pct * 100}%`;
  ui.pstars.forEach((s, i) => s.classList.toggle('on', pct >= (i + 1) / 3 - 1e-6));

  const [label, color, meter] = stealthStatus();
  ui.stealthLabel.textContent = label;
  ui.stealthLabel.style.background = `linear-gradient(180deg, ${color}, ${color}cc)`; // candy pill in the status colour
  ui.sus.style.width = `${meter * 100}%`;
  ui.sus.style.background = color;
  ui.vignette.style.opacity = meter >= 1 ? 1 : meter * 0.5;

  const clear = allClear();
  ui.objective.textContent = clear
    ? 'House cleared! Get back to your nest (green hole).'
    : `Find all the crumbs: ${CRUMB_COUNT - game.crumbsEaten} left · snacks refill your health`;

  ui.compass.classList.add('hidden'); // replaced by the minimap
  drawMinimap(dt, clear);

  if (nearFood) {
    ui.prompt.textContent = `${isTouch ? 'Hold EAT' : 'Hold E'} to eat ${nearFood.name} (+health) · munching is noisy!`;
    ui.btnEat.classList.remove('hidden');
  } else {
    ui.prompt.textContent = '';
    ui.btnEat.classList.add('hidden');
    touch.eat = false;
  }

  if (warnTimer > 0) {
    warnTimer -= dt;
    if (warnTimer <= 0) ui.warn.classList.remove('show');
  }
  flashAmt = Math.max(0, flashAmt - dt * 1.6);
  poisonAmt = Math.max(0, poisonAmt - dt * 0.8);
  ui.flash.style.opacity = flashAmt;
  ui.poison.style.opacity = poisonAmt;
}

applyLevel();
resetGame();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  autoResolution(dt);
  if (window.__peek) { renderer.render(scene, camera); return; } // testing: frozen camera
  tick(dt, now / 1000);
  render(now / 1000);
}
requestAnimationFrame(frame);

// One step of the whole game (menus, cutscenes, countdown, gameplay)
function tick(dt, time) {
  for (const f of world.fans) f.obj.rotation[f.axis] += f.speed * dt;
  updateTV(dt);
  const s = game.state;
  if (s === 'playing' || s === 'over') {
    step(dt, time);
    updateHud(dt);
    updateCamera(dt);
  } else if (s === 'death') {
    updateCine(dt, time); // the house holds its breath
  } else if (s === 'intro' || s === 'outro') {
    ambient(dt, time);
    updateCine(dt, time); // the cutscene drives the camera
  } else if (s === 'countdown') {
    ambient(dt, time);
    roach.pose(dt, time, 0);
    updateCountdown(dt);
    updateHud(dt);
    updateCamera(dt);
  } else if (isMenu()) {
    cam.yaw += dt * 0.15;
    ambient(dt, time);
    roach.pose(dt, time, 0);
    updateCamera(dt);
  } else {
    updateCamera(dt);
  }
}

function render(time) {
  const high = roach.high > 0.05;
  highPass.enabled = high;
  if (high) {
    highPass.uniforms.amount.value = Math.min(1, roach.high / 4);
    highPass.uniforms.time.value = time;
  }
  if (useComposer || high) composer.render();
  else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
});

// __game.simulate(seconds) fast-forwards the game logic at 60 fps (handy for testing).
let simTime = 0;
window.__game = {
  game, roach, person, cat, broom, spray, car, foods, crumbs, cam, keys, world,
  // run the full state machine (cutscenes etc.) for some seconds
  run(seconds) {
    for (let i = 0; i < Math.round(seconds * 60); i++) { simTime += 1 / 60; tick(1 / 60, simTime); }
    render(simTime);
    return game.state;
  },
  beginLevel: (i, quick) => beginLevel(i, quick),
  renderer, scene, sun, camera,
  // look at the room from any point (testing)
  peek(pos, look) { camera.position.set(...pos); camera.up.set(0, 1, 0); camera.lookAt(...look); renderer.render(scene, camera); },
  simulate(seconds) {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      simTime += 1 / 60;
      step(1 / 60, simTime);
    }
    updateHud(0);
    updateCamera(1);
    render(simTime);
  },
};
