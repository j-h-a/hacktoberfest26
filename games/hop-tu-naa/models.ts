/**
 * Procedural models and textures: the fairy, everything that blocks the path, the woods around
 * it, and the canvas textures they use. Mostly low-poly and vertex-coloured, so most things
 * are a single draw call; the pumpkins and turnips get painted, glowing faces.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLS, ROW_LEN, mulberry32, type Obstacle } from './game';

export const LANE_W = 1.3;
/** The path is the six lanes plus a mossy edge either side. */
export const PATH_EDGE = 0.5;
export const PATH_W = COLS * LANE_W + 2 * PATH_EDGE;
/** How far along the path one copy of its texture reaches. */
export const PATH_TILE = (PATH_W * 1024) / 512;

export function laneX(lane: number): number {
  return (lane - (COLS - 1) / 2) * LANE_W;
}

type Rand = () => number;

// ---- Geometry helpers ----

function hashUnit(x: number, y: number, z: number, salt: number): number {
  let h =
    Math.imul(Math.round(x * 1e4), 0x27d4eb2d) ^
    Math.imul(Math.round(y * 1e4), 0x165667b1) ^
    Math.imul(Math.round(z * 1e4), 0x1b873593) ^
    Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Nudge every corner by a hash of where it is, so corners shared by several faces stay together. */
function lumpy<T extends THREE.BufferGeometry>(geo: T, amount: number, seed: number): T {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(
      i,
      x + hashUnit(x, y, z, seed) * amount,
      y + hashUnit(x, y, z, seed + 7) * amount,
      z + hashUnit(x, y, z, seed + 13) * amount,
    );
  }
  return geo;
}

type Painter = (centre: THREE.Vector3, normal: THREE.Vector3) => THREE.ColorRepresentation;

/** A flat, vertex-coloured copy: every triangle gets the colour the painter picks, a little varied. */
function paint(geo: THREE.BufferGeometry, painter: Painter | THREE.ColorRepresentation, jitter = 0.05, rand: Rand = Math.random): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const tri = new THREE.Triangle();
  const centre = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    tri.setFromAttributeAndIndices(pos, i, i + 1, i + 2);
    tri.getMidpoint(centre);
    tri.getNormal(normal);
    color.set(typeof painter === 'function' ? painter(centre, normal) : painter);
    if (jitter) color.offsetHSL(0, 0, (rand() - 0.5) * jitter);
    for (let k = 0; k < 3; k++) color.toArray(colors, (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts)!;
}

/** A tapering cylinder from `from`, leaning `tilt` off vertical towards compass direction `yaw`. */
function limb(len: number, r0: number, r1: number, from: THREE.Vector3, tilt: number, yaw: number, color: string, rand: Rand) {
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, tilt, 'YXZ'));
  const geo = new THREE.CylinderGeometry(r1, r0, len, 5, 1).translate(0, len / 2, 0).applyMatrix4(rot);
  geo.translate(from.x, from.y, from.z);
  const tip = new THREE.Vector3(0, len, 0).applyMatrix4(rot).add(from);
  return { geo: paint(geo, color, 0.06, rand), tip };
}

/** Low-poly things share one vertex-coloured, flat-shaded material. */
export const flatMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });

// ---- Canvas textures ----

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Draw something at (x, y) and again a tile away, so textures that repeat along y have no seam. */
function wrapY(h: number, y: number, draw: (y: number) => void): void {
  draw(y);
  if (y < 40) draw(y + h);
  if (y > h - 40) draw(y - h);
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, size, size * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const LEAF_COLOURS = ['#a8471c', '#c9702a', '#d89a34', '#8a2f1a', '#7a5a24', '#b5571e'];

/** The path: packed earth, pebbles and fallen leaves, faint pale stones between the lanes, moss at the edges. */
export function pathTexture(): THREE.CanvasTexture {
  const rand = mulberry32(11);
  const tex = canvasTexture(512, 1024, (ctx, w, h) => {
    const px = w / PATH_W; // pixels per unit
    ctx.fillStyle = '#7a634a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const l = 30 + rand() * 25;
      ctx.fillStyle = `hsla(${25 + rand() * 15}, ${20 + rand() * 20}%, ${l}%, ${0.25 + rand() * 0.3})`;
      const x = rand() * w;
      const y = rand() * h;
      ctx.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 3);
    }
    for (let i = 0; i < 160; i++) {
      const x = rand() * w;
      const r = 2 + rand() * 4;
      const shade = 45 + rand() * 25;
      wrapY(h, rand() * h, (y) => {
        ctx.fillStyle = `hsl(30, 8%, ${shade}%)`;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.75, rand(), 0, Math.PI * 2);
        ctx.fill();
      });
    }
    for (let i = 0; i < 150; i++) {
      const x = rand() * w;
      const size = 5 + rand() * 6;
      const angle = rand() * Math.PI;
      const colour = LEAF_COLOURS[Math.floor(rand() * LEAF_COLOURS.length)];
      wrapY(h, rand() * h, (y) => leaf(ctx, x, y, size, angle, colour));
    }
    // Pale stepping stones between the lanes.
    for (let k = 1; k < COLS; k++) {
      const x = (PATH_EDGE + k * LANE_W) * px;
      for (let y = 8; y < h; y += px * 0.55) {
        ctx.fillStyle = `rgba(235, 225, 200, ${0.45 + rand() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(x + (rand() - 0.5) * 3, y, 3 + rand() * 1.5, 4.5 + rand() * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Moss and grass along the edges.
    for (const side of [0, 1]) {
      const x0 = side ? w - PATH_EDGE * px * 1.4 : 0;
      const grad = ctx.createLinearGradient(side ? w : 0, 0, side ? w - PATH_EDGE * px * 1.4 : PATH_EDGE * px * 1.4, 0);
      grad.addColorStop(0, '#26361d');
      grad.addColorStop(0.55, 'rgba(48, 70, 34, 0.85)');
      grad.addColorStop(1, 'rgba(48, 70, 34, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, 0, PATH_EDGE * px * 1.4, h);
      for (let i = 0; i < 700; i++) {
        const gx = side ? w - rand() * PATH_EDGE * px * 1.1 : rand() * PATH_EDGE * px * 1.1;
        const gy = rand() * h;
        ctx.strokeStyle = `hsl(${85 + rand() * 30}, 40%, ${18 + rand() * 18}%)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (rand() - 0.5) * 8, gy - 4 - rand() * 8);
        ctx.stroke();
      }
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The forest floor either side: moss, leaf litter and twigs. */
export function floorTexture(): THREE.CanvasTexture {
  const rand = mulberry32(23);
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#26331f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 7000; i++) {
      ctx.fillStyle = `hsla(${70 + rand() * 50}, 30%, ${10 + rand() * 18}%, 0.5)`;
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 4, 2 + rand() * 4);
    }
    for (let i = 0; i < 260; i++) {
      const x = rand() * w;
      const size = 5 + rand() * 7;
      const angle = rand() * Math.PI;
      const colour = LEAF_COLOURS[Math.floor(rand() * LEAF_COLOURS.length)];
      ctx.globalAlpha = 0.55 + rand() * 0.3;
      wrapY(h, rand() * h, (y) => leaf(ctx, x, y, size, angle, colour));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3a2a1c';
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = rand() * (w - 40) + 20;
      const y = rand() * (h - 40) + 20;
      const a = rand() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18);
      ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Night sky from deep blue overhead to a misty glow at the horizon, which the fog matches. */
export function skyTexture(horizon: string): THREE.CanvasTexture {
  return canvasTexture(4, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#02030b');
    grad.addColorStop(0.3, '#0a1030');
    grad.addColorStop(0.47, horizon);
    grad.addColorStop(1, horizon);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

export function moonTexture(): THREE.CanvasTexture {
  const rand = mulberry32(5);
  return canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    const halo = ctx.createRadialGradient(c, c, w * 0.2, c, c, c);
    halo.addColorStop(0, 'rgba(255, 244, 214, 0.22)');
    halo.addColorStop(1, 'rgba(255, 244, 214, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = '#fff4d6';
    ctx.beginPath();
    ctx.arc(c, c, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * w * 0.15;
      ctx.fillStyle = 'rgba(200, 185, 150, 0.45)';
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 3 + rand() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** A soft round glow, tinted by whatever uses it. */
export const glowTexture = canvasTexture(128, 128, (ctx, w) => {
  const grad = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.6)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, w);
});

/** A strip of light down a lane, brightest nearest the fairy. */
export const laneGlowTexture = canvasTexture(64, 256, (ctx, w, h) => {
  const along = ctx.createLinearGradient(0, h, 0, 0);
  along.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  along.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, 'rgba(0, 0, 0, 0)');
  across.addColorStop(0.5, 'rgba(0, 0, 0, 1)');
  across.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, w, h);
});

// ---- Pumpkins and turnips ----

/**
 * A carved face centred on (cx, cy). Sphere UVs put u = 0.25 at the front (+z), so faces are
 * drawn a quarter of the way across their texture.
 */
function carveFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, style: 'pumpkin' | 'turnip'): void {
  ctx.beginPath();
  if (style === 'pumpkin') {
    // Slanted, angry eyes, a nose, and a jagged grin with fangs.
    for (const side of [-1, 1]) {
      ctx.moveTo(cx + side * 62, cy - 48);
      ctx.lineTo(cx + side * 12, cy - 28);
      ctx.lineTo(cx + side * 38, cy - 6);
      ctx.closePath();
    }
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 10, cy + 9);
    ctx.lineTo(cx - 10, cy + 9);
    ctx.closePath();
    const grin = [
      [-70, 12], [-50, 24], [-40, 15], [-30, 28], [-12, 30], [-4, 19], [4, 19], [12, 30], [30, 28], [40, 15],
      [50, 24], [70, 12], [54, 40], [32, 54], [21, 44], [8, 56], [-8, 56], [-21, 44], [-32, 54], [-54, 40],
    ];
    ctx.moveTo(cx + grin[0][0], cy + grin[0][1]);
    for (const [x, y] of grin.slice(1)) ctx.lineTo(cx + x, cy + y);
    ctx.closePath();
  } else {
    // Round hollow eyes and a crooked, gappy mouth.
    for (const side of [-1, 1]) {
      ctx.moveTo(cx + side * 30 + 15, cy - 24);
      ctx.ellipse(cx + side * 30, cy - 24, 15, side < 0 ? 19 : 15, 0, 0, Math.PI * 2);
    }
    const mouth = [[-46, 10], [-24, 22], [-14, 14], [0, 24], [14, 14], [26, 24], [46, 8], [36, 34], [10, 44], [-16, 42], [-38, 30]];
    ctx.moveTo(cx + mouth[0][0], cy + mouth[0][1]);
    for (const [x, y] of mouth.slice(1)) ctx.lineTo(cx + x, cy + y);
    ctx.closePath();
  }
  ctx.fill();
}

function faceTextures(style: 'pumpkin' | 'turnip'): { map: THREE.Texture; glow: THREE.Texture } {
  const rand = mulberry32(style === 'pumpkin' ? 3 : 4);
  const map = canvasTexture(512, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (style === 'pumpkin') {
      grad.addColorStop(0, '#8a3e08');
      grad.addColorStop(0.3, '#e8761a');
      grad.addColorStop(0.55, '#f88d2c');
      grad.addColorStop(0.8, '#d9671a');
      grad.addColorStop(1, '#7a3406');
    } else {
      grad.addColorStop(0, '#5e2a63');
      grad.addColorStop(0.3, '#9a5aa0');
      grad.addColorStop(0.5, '#d9c3cf');
      grad.addColorStop(0.75, '#efe4cc');
      grad.addColorStop(1, '#d8c8a6');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (style === 'pumpkin') {
      // Creases between the ten lobes.
      for (let k = 0; k < 10; k++) {
        const x = (0.05 + k * 0.1) * w;
        const crease = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
        crease.addColorStop(0, 'rgba(100, 35, 0, 0)');
        crease.addColorStop(0.5, 'rgba(100, 35, 0, 0.6)');
        crease.addColorStop(1, 'rgba(100, 35, 0, 0)');
        ctx.fillStyle = crease;
        ctx.fillRect(x - 20, 0, 40, h);
      }
    }
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(${style === 'pumpkin' ? '90, 30, 0' : '80, 50, 60'}, ${rand() * 0.18})`;
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
    ctx.fillStyle = '#2a1200';
    carveFace(ctx, w * 0.25, h * 0.5, style);
  });
  const glow = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 6;
    carveFace(ctx, w * 0.25, h * 0.5, style);
  });
  return { map, glow };
}

function pumpkinBody(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.5, 48, 24);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const phi = Math.atan2(v.z, -v.x);
    const lobe = 0.92 + 0.08 * Math.sqrt(Math.abs(Math.cos(phi * 5)));
    v.x *= lobe;
    v.z *= lobe;
    v.y *= 0.78;
    const r = Math.hypot(v.x, v.z);
    if (r < 0.14) v.y -= Math.sign(v.y) * (0.14 - r) * 0.6; // dimples top and bottom
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function turnipBody(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.4, 40, 24);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    if (y < 0) {
      // Taper the bottom into a root.
      const t = -y / 0.4;
      const squeeze = 1 - 0.8 * t * t;
      x *= squeeze;
      z *= squeeze;
      y *= 1 + 0.55 * t * t;
    } else {
      y *= 0.82;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function faceMaterials(style: 'pumpkin' | 'turnip', glowColour: string): THREE.MeshStandardMaterial[] {
  const { map, glow } = faceTextures(style);
  // A few copies, so they don't all flicker in step.
  return [0, 1, 2].map(
    () => new THREE.MeshStandardMaterial({ map, emissiveMap: glow, emissive: glowColour, emissiveIntensity: 2.4, roughness: 0.6 }),
  );
}

let faces: {
  pumpkin: THREE.BufferGeometry;
  turnip: THREE.BufferGeometry;
  stem: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  pumpkinMats: THREE.MeshStandardMaterial[];
  turnipMats: THREE.MeshStandardMaterial[];
  pumpkinGlow: THREE.SpriteMaterial;
  turnipGlow: THREE.SpriteMaterial;
} | null = null;

function faceParts() {
  if (faces) return faces;
  const rand = mulberry32(9);
  const stem = merge([
    limb(0.2, 0.065, 0.035, new THREE.Vector3(0, 0.36, 0), 0.25, 0, '#56602c', rand).geo,
    limb(0.08, 0.03, 0.02, new THREE.Vector3(0.03, 0.54, 0), 1.3, 0.5, '#56602c', rand).geo,
  ]);
  const leaves = merge(
    [0, 1, 2, 3].map((i) => limb(0.32 + rand() * 0.1, 0.035, 0.008, new THREE.Vector3(0, 0.3, 0), 0.35 + rand() * 0.2, i * 1.6 + rand(), '#4c7a2e', rand).geo),
  );
  const glow = (colour: string) =>
    new THREE.SpriteMaterial({ map: glowTexture, color: colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
  faces = {
    pumpkin: pumpkinBody(),
    turnip: turnipBody(),
    stem,
    leaves,
    pumpkinMats: faceMaterials('pumpkin', '#ffa640'),
    turnipMats: faceMaterials('turnip', '#ffd27a'),
    pumpkinGlow: glow('#ff7a1a'),
    turnipGlow: glow('#ffc060'),
  };
  return faces;
}

/** Every face material, for the renderer to flicker. */
export function faceMaterialsAll(): THREE.MeshStandardMaterial[] {
  const parts = faceParts();
  return [...parts.pumpkinMats, ...parts.turnipMats];
}

// ---- Other things on the path ----

function rockGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const geo = lumpy(new THREE.IcosahedronGeometry(0.46, 1), 0.11, seed);
  geo.scale(1.08, 0.74, 0.96).translate(0, 0.27, 0);
  return paint(geo, (_c, n) => (n.y > 0.55 && rand() < 0.6 ? '#4f6b3a' : rand() < 0.5 ? '#7c808a' : '#6c707b'), 0.1, rand);
}

function stumpGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const body = lumpy(new THREE.CylinderGeometry(0.36, 0.45, 0.52, 10, 2, true), 0.035, seed).translate(0, 0.26, 0);
  const top = new THREE.RingGeometry(0.001, 0.36, 10, 4).rotateX(-Math.PI / 2).translate(0, 0.52, 0);
  const parts = [
    paint(body, '#4c3627', 0.1, rand),
    paint(top, (c) => (Math.floor(Math.hypot(c.x, c.z) * 11) % 2 ? '#c49b65' : '#a37a4c'), 0.03, rand),
  ];
  for (let i = 0; i < 4; i++) {
    parts.push(limb(0.42, 0.13, 0.02, new THREE.Vector3(0, 0.14, 0), 1.75, i * 1.57 + rand() * 0.6, '#4c3627', rand).geo);
  }
  return merge(parts);
}

function toadstoolGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z, h] of [[-0.17, 0.08, 0.5], [0.17, -0.1, 0.36], [0.04, 0.22, 0.25]]) {
    const rs = 0.045 + h * 0.07;
    parts.push(paint(new THREE.CylinderGeometry(rs * 0.8, rs * 1.25, h, 7).translate(x, h / 2, z), '#efe5cf', 0.05, rand));
    const rc = 0.11 + h * 0.3;
    const cap = new THREE.SphereGeometry(rc, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, h - 0.02, z);
    parts.push(paint(cap, '#d0281c', 0.08, rand));
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const e = 0.25 + rand() * 1.05;
      const spot = new THREE.IcosahedronGeometry(0.025 + rand() * 0.02, 0).scale(1, 0.5, 1);
      spot.translate(x + Math.cos(a) * Math.cos(e) * rc, h - 0.02 + Math.sin(e) * rc * 0.7, z + Math.sin(a) * Math.cos(e) * rc);
      parts.push(paint(spot, '#f6f1e6', 0, rand));
    }
  }
  return merge(parts);
}

/** One row's length of Manx hedge: a stone-faced earth bank topped with gorse in flower. */
function hedgeGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const w = LANE_W * 1.01; // full width, so neighbouring hedges join into one bank
  const len = ROW_LEN * 1.03;
  const bank = lumpy(new THREE.BoxGeometry(w, 0.6, len, 3, 2, 3), 0.045, seed).translate(0, 0.3, 0);
  const stones = ['#80796e', '#6d685f', '#8d8678', '#5d6145', '#746a5c'];
  const parts = [paint(bank, () => stones[Math.floor(rand() * stones.length)], 0.06, rand)];
  for (let i = 0; i < 3; i++) {
    const gorse = lumpy(new THREE.IcosahedronGeometry(0.44, 1), 0.07, seed + i * 31);
    gorse.scale(1.45, 0.62, 0.72).translate((rand() - 0.5) * 0.14, 0.68 + rand() * 0.06, (i - 1) * (len / 3));
    parts.push(paint(gorse, () => (rand() < 0.2 ? '#f0bf2a' : rand() < 0.5 ? '#2f4c25' : '#3a5c2b'), 0.08, rand));
  }
  return merge(parts);
}

const logCache = new Map<number, THREE.BufferGeometry>();

/** A fallen log lying across `lanes` lanes. */
function logGeometry(lanes: number): THREE.BufferGeometry {
  const cached = logCache.get(lanes);
  if (cached) return cached;
  const rand = mulberry32(lanes * 77);
  const len = lanes * LANE_W - 0.1;
  const body = lumpy(new THREE.CylinderGeometry(0.31, 0.34, len, 9, lanes * 3), 0.035, lanes);
  body.rotateZ(Math.PI / 2).translate(0, 0.33, 0);
  const parts = [
    paint(body, (_c, n) => (Math.abs(n.x) > 0.9 ? '#b48a5a' : n.y > 0.55 && rand() < 0.35 ? '#4f6d33' : '#4d3523'), 0.08, rand),
  ];
  for (let i = 0; i < lanes; i++) {
    const at = new THREE.Vector3((rand() - 0.5) * (len - 0.5), 0.5, (rand() - 0.5) * 0.2);
    parts.push(limb(0.32, 0.08, 0.03, at, 0.5 + rand() * 0.6, rand() * Math.PI * 2, '#4d3523', rand).geo);
  }
  const geo = merge(parts);
  logCache.set(lanes, geo);
  return geo;
}

let props: { rocks: THREE.BufferGeometry[]; stumps: THREE.BufferGeometry[]; toadstools: THREE.BufferGeometry[]; hedges: THREE.BufferGeometry[] } | null = null;

function propParts() {
  props ??= {
    rocks: [1, 2, 3, 4].map(rockGeometry),
    stumps: [5, 6].map(stumpGeometry),
    toadstools: [7, 8, 9].map(toadstoolGeometry),
    hedges: [10, 11, 12].map(hedgeGeometry),
  };
  return props;
}

export interface ObstacleView {
  /** Placed at the middle of the obstacle's cells. */
  root: THREE.Object3D;
  /** Pumpkins and turnips: turned to watch the fairy, and hopped. */
  face?: THREE.Object3D;
  glow?: THREE.Sprite;
}

export function makeObstacle(o: Obstacle): ObstacleView {
  const root = new THREE.Group();
  const pick = <T>(list: T[]) => list[Math.floor(o.look * list.length) % list.length];
  const turn = o.look * Math.PI * 2;
  switch (o.kind) {
    case 'pumpkin':
    case 'turnip': {
      const parts = faceParts();
      const pumpkin = o.kind === 'pumpkin';
      const face = new THREE.Group();
      const body = new THREE.Mesh(pumpkin ? parts.pumpkin : parts.turnip, pick(pumpkin ? parts.pumpkinMats : parts.turnipMats));
      body.position.y = pumpkin ? 0.39 : 0.6;
      const top = new THREE.Mesh(pumpkin ? parts.stem : parts.leaves, flatMaterial);
      top.position.y = pumpkin ? 0 : 0.6;
      const glow = new THREE.Sprite(pumpkin ? parts.pumpkinGlow : parts.turnipGlow);
      glow.position.set(0, pumpkin ? 0.4 : 0.6, 0.55);
      glow.scale.setScalar(pumpkin ? 1.5 : 1.1);
      face.add(body, top, glow);
      face.scale.setScalar(pumpkin ? 0.9 + o.look * 0.25 : 0.95 + o.look * 0.15);
      root.add(face);
      return { root, face, glow };
    }
    case 'rock': {
      const mesh = new THREE.Mesh(pick(propParts().rocks), flatMaterial);
      mesh.rotation.y = turn;
      root.add(mesh);
      break;
    }
    case 'stump': {
      const mesh = new THREE.Mesh(pick(propParts().stumps), flatMaterial);
      mesh.rotation.y = turn;
      root.add(mesh);
      break;
    }
    case 'toadstool': {
      const mesh = new THREE.Mesh(pick(propParts().toadstools), flatMaterial);
      mesh.rotation.y = turn;
      root.add(mesh);
      break;
    }
    case 'hedge': {
      const hedges = propParts().hedges;
      for (let k = 0; k < o.rows; k++) {
        const mesh = new THREE.Mesh(hedges[(o.id + k) % hedges.length], flatMaterial);
        mesh.position.z = (o.rows / 2 - k - 0.5) * ROW_LEN;
        root.add(mesh);
      }
      break;
    }
    case 'log': {
      const mesh = new THREE.Mesh(logGeometry(o.lanes), flatMaterial);
      mesh.rotation.y = (o.look - 0.5) * 0.08;
      root.add(mesh);
      break;
    }
  }
  return { root };
}

// ---- The woods ----

function spookyTree(rand: Rand): THREE.BufferGeometry {
  const bark = '#3d3431';
  const h = 3.6 + rand() * 2.2;
  const trunk = lumpy(new THREE.CylinderGeometry(0.13, 0.42, h, 7, 5), 0.07, Math.floor(rand() * 1e5)).translate(0, h / 2, 0);
  const parts = [paint(trunk, bark, 0.08, rand)];
  for (let i = 0; i < 4; i++) {
    parts.push(limb(1 + rand() * 0.6, 0.17, 0.03, new THREE.Vector3(0, 0.25, 0), 1.9 + rand() * 0.3, i * 1.6 + rand(), bark, rand).geo);
  }
  const n = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const at = new THREE.Vector3(0, h * (0.42 + 0.55 * (i / n)), 0);
    const branch = limb(1 + rand() * 1.4, 0.1, 0.025, at, 0.55 + rand() * 0.75, rand() * Math.PI * 2, bark, rand);
    parts.push(branch.geo);
    const fork = at.clone().lerp(branch.tip, 0.65);
    parts.push(limb(0.5 + rand() * 0.7, 0.045, 0.012, fork, 0.3 + rand() * 1.1, rand() * Math.PI * 2, bark, rand).geo);
  }
  return merge(parts);
}

function autumnTree(rand: Rand): THREE.BufferGeometry {
  const h = 2 + rand() * 1.3;
  const trunk = lumpy(new THREE.CylinderGeometry(0.12, 0.28, h + 0.8, 6, 3), 0.05, Math.floor(rand() * 1e5)).translate(0, (h + 0.8) / 2, 0);
  const parts = [paint(trunk, '#4a372a', 0.08, rand)];
  const base = LEAF_COLOURS[Math.floor(rand() * LEAF_COLOURS.length)];
  const blobs = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.8 + rand() * 0.65;
    const blob = lumpy(new THREE.IcosahedronGeometry(r, 1), 0.13, Math.floor(rand() * 1e5));
    blob.translate((rand() - 0.5) * 1.4, h + 0.5 + rand() * 1.1, (rand() - 0.5) * 1.4);
    parts.push(paint(blob, () => (rand() < 0.7 ? base : LEAF_COLOURS[Math.floor(rand() * LEAF_COLOURS.length)]), 0.12, rand));
  }
  return merge(parts);
}

function pineTree(rand: Rand): THREE.BufferGeometry {
  const parts = [paint(new THREE.CylinderGeometry(0.1, 0.2, 1.4, 6).translate(0, 0.7, 0), '#3a2a1f', 0.08, rand)];
  const layers = 4 + Math.floor(rand() * 2);
  for (let k = 0; k < layers; k++) {
    const cone = lumpy(new THREE.ConeGeometry(1.6 - k * 0.28, 1.6, 8), 0.08, Math.floor(rand() * 1e5));
    cone.translate(0, 1.9 + k * 0.85, 0);
    parts.push(paint(cone, () => (rand() < 0.5 ? '#1d3a2b' : '#264733'), 0.1, rand));
  }
  return merge(parts);
}

export function treeGeometries(): THREE.BufferGeometry[] {
  const rand = mulberry32(42);
  return [
    ...[0, 1, 2, 3].map(() => spookyTree(rand)),
    ...[0, 1, 2, 3].map(() => autumnTree(rand)),
    ...[0, 1, 2].map(() => pineTree(rand)),
  ];
}

/** Ferns and brambles for the edge of the path. */
export function bushGeometries(): THREE.BufferGeometry[] {
  const rand = mulberry32(77);
  return [0, 1, 2, 3].map(() => {
    const parts: THREE.BufferGeometry[] = [];
    const blobs = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < blobs; i++) {
      const r = 0.25 + rand() * 0.3;
      const blob = lumpy(new THREE.IcosahedronGeometry(r, 0), 0.06, Math.floor(rand() * 1e5));
      blob.scale(1, 0.7, 1).translate((rand() - 0.5) * 0.7, r * 0.5, (rand() - 0.5) * 0.7);
      parts.push(paint(blob, () => (rand() < 0.08 ? '#9b1d2a' : rand() < 0.5 ? '#22381f' : '#2c4526'), 0.08, rand));
    }
    return merge(parts);
  });
}

/** A little clump of glowing mushrooms. */
export function glowShroomGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(99);
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z, h] of [[0, 0, 0.22], [0.12, 0.08, 0.15], [-0.1, 0.1, 0.12]]) {
    parts.push(paint(new THREE.CylinderGeometry(0.02, 0.03, h, 5).translate(x, h / 2, z), '#bfe', 0.05, rand));
    parts.push(paint(new THREE.SphereGeometry(0.07 + h * 0.2, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h, z), '#8ff', 0.05, rand));
  }
  return merge(parts);
}

// ---- The fairy ----

function wingTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 192, (ctx, w, h) => {
    const shape = new Path2D();
    shape.moveTo(4, h * 0.55);
    shape.bezierCurveTo(w * 0.25, -h * 0.05, w * 0.98, -h * 0.02, w * 0.95, h * 0.32);
    shape.bezierCurveTo(w * 0.92, h * 0.72, w * 0.45, h * 0.82, 4, h * 0.62);
    shape.closePath();
    const fill = ctx.createRadialGradient(0, h * 0.58, 4, 0, h * 0.58, w);
    fill.addColorStop(0, 'rgba(210, 255, 250, 0.95)');
    fill.addColorStop(0.45, 'rgba(120, 210, 255, 0.55)');
    fill.addColorStop(1, 'rgba(230, 140, 255, 0.45)');
    ctx.fillStyle = fill;
    ctx.fill(shape);
    ctx.save();
    ctx.clip(shape);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    for (const [ex, ey] of [[0.9, 0.12], [0.95, 0.4], [0.7, 0.72], [0.45, 0.8]]) {
      ctx.beginPath();
      ctx.moveTo(4, h * 0.58);
      ctx.quadraticCurveTo(w * ex * 0.55, h * (ey * 0.6 + 0.2), w * ex, h * ey);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke(shape);
  });
}

export interface FairyModel {
  root: THREE.Group;
  /** Banks and bobs inside root. */
  body: THREE.Group;
  wings: { pivot: THREE.Object3D; side: number; upper: boolean }[];
  glow: THREE.Sprite;
  light: THREE.PointLight;
}

/** A Manx fairy: green clothes and a red cap, as the stories have it, and four glowing wings. */
export function makeFairy(): FairyModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const smooth = (color: string, emissive = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: color, emissiveIntensity: emissive });
  const green = smooth('#2f9e5b', 0.25);
  const skin = smooth('#f1c7a5', 0.15);
  const red = smooth('#d7263d', 0.3);
  const hair = smooth('#8a3f1c', 0.1);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    body.add(mesh);
    return mesh;
  };
  add(new THREE.ConeGeometry(0.17, 0.38, 14), green, 0, -0.11, 0); // dress
  add(new THREE.SphereGeometry(0.075, 12, 8), green, 0, 0.1, 0); // chest
  add(new THREE.SphereGeometry(0.088, 16, 12), skin, 0, 0.25, 0); // head
  add(new THREE.SphereGeometry(0.093, 16, 12), hair, 0, 0.265, 0.025); // hair
  add(new THREE.SphereGeometry(0.05, 10, 8), hair, 0, 0.23, 0.1); // bun
  add(new THREE.ConeGeometry(0.08, 0.22, 12), red, 0, 0.38, 0.03, 0.55); // red cap
  add(new THREE.SphereGeometry(0.022, 8, 6), red, 0, 0.47, 0.1); // its bobble
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.02, 0.024, 0.2, 6), skin, side * 0.09, 0.07, 0.02, 0.3, side * 0.7); // arms
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 6), skin, side * 0.045, -0.37, 0.03, 0.4, 0); // legs
    add(new THREE.SphereGeometry(0.032, 8, 6), green, side * 0.045, -0.46, 0.08); // shoes
  }

  const wingMat = new THREE.MeshBasicMaterial({
    map: wingTexture(),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: new THREE.Color(1.05, 1.05, 1.05),
  });
  const upperGeo = new THREE.PlaneGeometry(0.62, 0.44).translate(0.31, 0.06, 0);
  const lowerGeo = new THREE.PlaneGeometry(0.42, 0.3).translate(0.21, -0.03, 0);
  const wings: FairyModel['wings'] = [];
  for (const side of [-1, 1]) {
    for (const upper of [true, false]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.03, upper ? 0.13 : 0.05, 0.07);
      const wing = new THREE.Mesh(upper ? upperGeo : lowerGeo, wingMat);
      wing.scale.x = side;
      wing.rotation.z = side * (upper ? 0.5 : -0.45);
      pivot.add(wing);
      body.add(pivot);
      wings.push({ pivot, side, upper });
    }
  }

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color: '#9ff8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }),
  );
  glow.scale.setScalar(0.9);
  glow.position.y = 0.1;
  body.add(glow);
  const light = new THREE.PointLight('#a8f6ff', 3, 8, 1.4);
  light.position.set(0, 0.2, 0.2);
  root.add(light);
  body.scale.setScalar(1.5);
  return { root, body, wings, glow, light };
}
