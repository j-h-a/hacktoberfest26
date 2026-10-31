/**
 * The three.js side: builds the woods once, then each frame matches the scene to the game.
 *
 * Everything that lives on the path sits in `world` at z = -d, and `world` moves by the scroll,
 * so it all slides towards the camera while the fairy and the camera stay put near z = 0.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLS, ROW_LEN, clamp, lerp, mulberry32, type Game, type Kind } from './game';
import * as M from './models';

/** The misty blue at the horizon, which the fog fades everything into. */
const FOG = '#232c52';
const UP = new THREE.Vector3(0, 1, 0);

/** What a crash throws out, by what she hit. */
const BURST_COLOURS: Record<Kind, string[]> = {
  pumpkin: ['#ff8a1e', '#ffc04a', '#ff6a00'],
  turnip: ['#b77fd0', '#f3e6c8', '#ffd27a'],
  rock: ['#b8bcc8', '#8a8f9c', '#ffffff'],
  toadstool: ['#ff3a2a', '#fff4e6', '#ff8a7a'],
  stump: ['#c49b65', '#8a6239', '#e8c890'],
  hedge: ['#5f9e3a', '#f0c02a', '#3a6a28'],
  log: ['#c49b65', '#8a6239', '#6fa04a'],
};
const DUST_COLOURS = ['#9ff8ff', '#ffb8f0', '#fff1a0', '#b8ffcf'].map((c) => new THREE.Color(c));

/** Scenery spread over `span` units of path, each piece leapfrogging forward once it's behind the camera. */
class Scatter {
  readonly meshes: THREE.InstancedMesh[];
  readonly items: { mesh: number; slot: number; d: number }[] = [];
  readonly span: number;
  readonly place: (d: number, matrix: THREE.Matrix4) => void;
  readonly matrix = new THREE.Matrix4();

  constructor(
    parent: THREE.Object3D,
    geos: THREE.BufferGeometry[],
    material: THREE.Material,
    count: number,
    span: number,
    place: (d: number, matrix: THREE.Matrix4) => void,
  ) {
    this.span = span;
    this.place = place;
    const perMesh = Math.ceil(count / geos.length);
    this.meshes = geos.map((geo) => {
      const mesh = new THREE.InstancedMesh(geo, material, perMesh);
      mesh.count = 0;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    });
    for (let i = 0; i < count; i++) {
      const mesh = i % geos.length;
      this.items.push({ mesh, slot: this.meshes[mesh].count++, d: 0 });
    }
    this.reset();
  }

  reset(): void {
    for (const item of this.items) {
      item.d = -10 + Math.random() * this.span;
      this.write(item);
    }
  }

  update(scroll: number): void {
    for (const item of this.items) {
      if (item.d > scroll - 10) continue;
      item.d += this.span;
      this.write(item);
    }
  }

  write(item: { mesh: number; slot: number; d: number }): void {
    this.place(item.d, this.matrix);
    const mesh = this.meshes[item.mesh];
    mesh.setMatrixAt(item.slot, this.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Glowing points that fly, fall and fade: fairy dust, and the bursts when she crashes. */
class Sparks {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly vel: Float32Array;
  readonly tint: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly gravity: number;
  next = 0;

  constructor(parent: THREE.Object3D, capacity: number, size: number, gravity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.tint = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.gravity = gravity;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({
      size,
      map: M.glowTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, life: number): void {
    const i = this.next;
    this.next = (i + 1) % this.life.length;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.tint.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.maxLife[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < this.life.length; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const fade = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[j + 1] -= this.gravity * dt;
      for (let a = 0; a < 3; a++) {
        this.pos[j + a] += this.vel[j + a] * dt;
        this.col[j + a] = this.tint[j + a] * fade;
      }
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}

const FIREFLIES = 120;
const FIREFLY_SPAN = 95;

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 700);
  readonly composer: EffectComposer;
  readonly world = new THREE.Group();
  readonly fairy = M.makeFairy();
  readonly obstacles = new Map<number, M.ObstacleView>();
  readonly faceMaterials = M.faceMaterialsAll();
  readonly pumpkinLights: THREE.PointLight[] = [];
  readonly pathTex = M.pathTexture();
  readonly floorTex = M.floorTexture();
  readonly scenery: Scatter[] = [];
  readonly dust: Sparks;
  readonly bursts: Sparks;
  readonly flies: THREE.Points;
  readonly flyBase = new Float32Array(FIREFLIES * 3);
  readonly flyPhase = new Float32Array(FIREFLIES);
  readonly laneGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  game: Game | null = null;
  time = 0;
  bank = 0;
  fall = 0;
  spin = 0;
  shake = 0;
  camX = 0;
  laneGlowX = 0;
  width = 1;
  height = 1;
  /** Highest pixel ratio to render at; lowered if frames are slow. */
  maxDpr = 1.5;
  slowTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // Antialias in the composer's own target, since bloom renders through it.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.8));
    this.composer.addPass(new OutputPass());

    const scene = this.scene;
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.FogExp2(FOG, 0.021);
    scene.add(this.world, this.fairy.root);

    // Sky, stars and moon, far away and out of the fog.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.MeshBasicMaterial({ map: M.skyTexture(FOG), side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.renderOrder = -1;
    scene.add(sky);
    const rand = mulberry32(8);
    const stars: number[] = [];
    for (let i = 0; i < 600; i++) {
      const a = rand() * Math.PI * 2;
      const e = 0.05 + Math.asin(rand()) * 0.9;
      stars.push(Math.cos(e) * Math.cos(a) * 450, Math.sin(e) * 450, Math.cos(e) * Math.sin(a) * 450);
    }
    const starGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    scene.add(
      new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe6ff', size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false })),
    );
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.moonTexture(), fog: false, depthWrite: false, color: new THREE.Color(0.95, 0.93, 0.85) }));
    moon.position.set(190, 38, -390);
    moon.scale.setScalar(70);
    scene.add(moon);

    // Moonlight, plus a soft fill so nothing goes completely black.
    scene.add(new THREE.HemisphereLight('#8090e0', '#2a2018', 1.2));
    const moonlight = new THREE.DirectionalLight('#c0caff', 1.8);
    moonlight.position.set(-6, 12, 9);
    scene.add(moonlight);

    // The forest floor and the path, fixed under the camera with their textures sliding.
    this.floorTex.repeat.set(100 / 8, 220 / 8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 220), new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -98);
    this.pathTex.repeat.set(1, 220 / M.PATH_TILE);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(M.PATH_W, 220), new THREE.MeshStandardMaterial({ map: this.pathTex, roughness: 1 }));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0, -98);
    scene.add(floor, path);

    // The woods: trees, then bushes and glowing mushrooms along the edges of the path.
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const side = () => (Math.random() < 0.5 ? -1 : 1);
    this.scenery.push(
      new Scatter(this.world, M.treeGeometries(), M.flatMaterial, 132, 120, (d, m) => {
        const x = side() * (M.PATH_W / 2 + 1.6 + Math.random() ** 1.4 * 14);
        const k = 0.8 + Math.random() * 0.6;
        m.compose(v.set(x, 0, -d), q.setFromAxisAngle(UP, Math.random() * 6.3), s.set(k, k * (0.85 + Math.random() * 0.35), k));
      }),
      new Scatter(this.world, M.bushGeometries(), M.flatMaterial, 64, 100, (d, m) => {
        const x = side() * (M.PATH_W / 2 + 0.25 + Math.random() * 1.6);
        const k = 0.7 + Math.random() * 0.7;
        m.compose(v.set(x, 0, -d), q.setFromAxisAngle(UP, Math.random() * 6.3), s.set(k, k, k));
      }),
      new Scatter(
        this.world,
        [M.glowShroomGeometry()],
        new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: '#3ff0ff', emissiveIntensity: 0.9 }),
        36,
        100,
        (d, m) => {
          const x = side() * (M.PATH_W / 2 + 0.05 + Math.random() * 2.4);
          const k = 0.8 + Math.random() * 0.8;
          m.compose(v.set(x, 0, -d), q.setFromAxisAngle(UP, Math.random() * 6.3), s.set(k, k, k));
        },
      ),
    );

    // Lights that follow the nearest pumpkins and turnips, so they cast a warm glow on the path.
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight('#ff8a30', 0, 6, 1.6);
      this.pumpkinLights.push(light);
      this.world.add(light);
    }

    // The lane she's heading for glows ahead of her, and a pool of light sits beneath her.
    const additive = (map: THREE.Texture, color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.laneGlow = new THREE.Mesh(new THREE.PlaneGeometry(M.LANE_W * 0.8, 7), additive(M.laneGlowTexture, '#8ff4ff', 0.3));
    this.laneGlow.rotation.x = -Math.PI / 2;
    this.laneGlow.position.set(0, 0.02, -3.2);
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), additive(M.glowTexture, '#5fe8ff', 0.45));
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 0.025;
    scene.add(this.laneGlow, this.halo);

    this.dust = new Sparks(this.world, 260, 0.13, -0.4);
    this.bursts = new Sparks(this.world, 400, 0.3, 6);
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FIREFLIES * 3), 3).setUsage(THREE.DynamicDrawUsage));
    flyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FIREFLIES * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.flies = new THREE.Points(
      flyGeo,
      new THREE.PointsMaterial({ size: 0.22, map: M.glowTexture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flies.frustumCulled = false;
    this.world.add(this.flies);
    this.resetFireflies(0);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    // Widen the view on narrow screens so all six lanes still fit.
    this.camera.fov = Math.max(52, THREE.MathUtils.radToDeg(2 * Math.atan(0.62 / this.camera.aspect)));
    this.camera.updateProjectionMatrix();
  }

  render(game: Game, dt: number): void {
    if (game !== this.game) this.reset(game);
    this.time += dt;
    this.world.position.z = game.scroll;
    this.syncObstacles(game);
    this.showEvents(game);
    this.animateObstacles(game);
    this.animateFairy(game, dt);
    for (const scatter of this.scenery) scatter.update(game.scroll);
    this.animateFireflies(game);
    this.dust.update(dt);
    this.bursts.update(dt);
    this.pathTex.offset.y = game.scroll / M.PATH_TILE;
    this.floorTex.offset.y = game.scroll / 8;
    this.moveCamera(game, dt);
    this.composer.render(dt);
    this.adaptQuality(dt);
  }

  /** A new game: clear out the old one's path. */
  reset(game: Game): void {
    for (const view of this.obstacles.values()) this.world.remove(view.root);
    this.obstacles.clear();
    for (const scatter of this.scenery) scatter.reset();
    this.resetFireflies(game.scroll);
    this.dust.clear();
    this.bursts.clear();
    this.fall = 0;
    this.spin = 0;
    this.game = game;
  }

  syncObstacles(game: Game): void {
    const live = new Set<number>();
    for (const o of game.obstacles) {
      live.add(o.id);
      let view = this.obstacles.get(o.id);
      if (!view) {
        view = M.makeObstacle(o);
        // Things that stand alone sit a little off the grid, so the path looks less tidy.
        const single = o.kind !== 'hedge' && o.kind !== 'log';
        const jx = single ? (((o.look * 7) % 1) - 0.5) * 0.14 : 0;
        const jz = single ? (((o.look * 13) % 1) - 0.5) * 0.3 : 0;
        view.root.position.set(M.laneX(o.lane + (o.lanes - 1) / 2) + jx, 0, -(o.row + o.rows / 2) * ROW_LEN + jz);
        this.world.add(view.root);
        this.obstacles.set(o.id, view);
      }
      view.root.visible = !o.smashed;
    }
    for (const [id, view] of this.obstacles) {
      if (live.has(id)) continue;
      this.world.remove(view.root);
      this.obstacles.delete(id);
    }
  }

  showEvents(game: Game): void {
    const color = new THREE.Color();
    for (const event of game.events) {
      if (event.type !== 'crash') continue;
      const x = M.laneX(game.fairy.x);
      const z = -game.scroll - 0.4;
      const colours = BURST_COLOURS[event.obstacle.kind];
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 4;
        color.set(colours[i % colours.length]).multiplyScalar(1.4);
        this.bursts.emit(x, 0.5 + Math.random() * 0.4, z, Math.cos(a) * speed, 1.5 + Math.random() * 3.5, Math.sin(a) * speed * 0.6 + 2, color, 0.5 + Math.random() * 0.6);
      }
      this.shake = 1;
      this.spin = 1;
    }
  }

  animateObstacles(game: Game): void {
    const t = this.time;
    const fx = M.laneX(game.fairy.x);
    this.faceMaterials.forEach((m, i) => {
      m.emissiveIntensity = 2.2 + 0.6 * Math.sin(t * 9 + i * 2.1) * Math.sin(t * 5.3 + i) - (Math.random() < 0.03 ? 0.9 : 0);
    });
    const near: { view: M.ObstacleView; ahead: number }[] = [];
    for (const [id, view] of this.obstacles) {
      if (!view.face || !view.root.visible) continue;
      const root = view.root;
      const ahead = -(root.position.z + game.scroll);
      // They turn to watch her go by, and hop as she comes near.
      view.face.rotation.y = Math.atan2(fx - root.position.x, Math.max(0.5, ahead)) * 0.9;
      const close = ahead > -1 && ahead < 16 ? 1 : 0;
      const phase = t * 7 + id * 1.7;
      view.face.position.y = close * Math.max(0, Math.sin(phase)) * 0.14;
      view.face.rotation.z = close * Math.sin(phase * 0.5) * 0.07;
      if (ahead > -1.5 && ahead < 26) near.push({ view, ahead });
    }
    near.sort((a, b) => a.ahead - b.ahead);
    this.pumpkinLights.forEach((light, i) => {
      const n = near[i];
      light.intensity = n ? 4 * (0.85 + 0.15 * Math.sin(t * 11 + i * 3)) : 0;
      if (n) light.position.set(n.view.root.position.x, 0.75, n.view.root.position.z + 0.7);
    });
  }

  animateFairy(game: Game, dt: number): void {
    const t = this.time;
    const f = game.fairy;
    const { root, body, wings, glow, light } = this.fairy;
    const x = M.laneX(f.x);
    this.fall = f.alive ? 0 : Math.min(1, this.fall + dt * 1.2);
    const drop = 1 - (1 - this.fall) ** 3;
    root.position.set(x, lerp(0.8 + Math.sin(t * 2.6) * 0.06, 0.3, drop), 0);
    // Bank into turns, lean on whatever's in the way, and spin after a crash.
    const bank = clamp(-f.vx * 0.045, -0.55, 0.55) - f.pressing * 0.32;
    this.bank += (bank - this.bank) * Math.min(1, dt * 12);
    this.spin = Math.max(0, this.spin - dt * 1.4);
    body.rotation.set(lerp(-0.14, 0.9, drop), this.spin * this.spin * 9 + Math.sin(t * 1.3) * 0.08, this.bank + f.pressing * Math.sin(t * 40) * 0.04);
    root.visible = !f.alive || f.ghost <= 0 || Math.floor(t * 18) % 2 === 0;
    const flap = Math.sin(t * (f.alive ? 30 : 4));
    for (const wing of wings) wing.pivot.rotation.y = -wing.side * (0.25 + 0.25 * (1 + flap)) * (wing.upper ? 1 : 0.8);
    glow.material.opacity = (0.32 + 0.06 * Math.sin(t * 5)) * (1 - drop * 0.6);
    light.intensity = (3 + Math.sin(t * 7) * 0.3) * (1 - drop * 0.5);

    this.halo.position.x = x;
    this.halo.material.opacity = 0.45 - drop * 0.25;
    this.laneGlowX += (M.laneX(clamp(f.target, 0, COLS - 1)) - this.laneGlowX) * Math.min(1, dt * 20);
    this.laneGlow.position.x = this.laneGlowX;
    const heading = Math.abs(f.target - f.x) > 0.3;
    this.laneGlow.material.opacity = f.alive ? (heading ? 0.5 + 0.2 * Math.sin(t * 16) : 0.26) : 0;

    // A trail of fairy dust.
    if (f.alive) {
      for (let i = 0; i < 3; i++) {
        const c = DUST_COLOURS[Math.floor(Math.random() * DUST_COLOURS.length)];
        this.dust.emit(
          x + (Math.random() - 0.5) * 0.7,
          root.position.y + (Math.random() - 0.3) * 0.6,
          -game.scroll + 0.1 + Math.random() * 0.3,
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
          c,
          0.6 + Math.random() * 0.6,
        );
      }
    }
  }

  resetFireflies(scroll: number): void {
    for (let i = 0; i < FIREFLIES; i++) this.placeFirefly(i, scroll - 6 + Math.random() * FIREFLY_SPAN);
  }

  placeFirefly(i: number, d: number): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    this.flyBase.set([side * (M.PATH_W / 2 + 0.3 + Math.random() * 9), 0.4 + Math.random() * 2.8, -d], i * 3);
    this.flyPhase[i] = Math.random() * 100;
  }

  animateFireflies(game: Game): void {
    const t = this.time;
    const pos = this.flies.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.flies.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < FIREFLIES; i++) {
      const j = i * 3;
      if (-this.flyBase[j + 2] < game.scroll - 6) this.placeFirefly(i, -this.flyBase[j + 2] + FIREFLY_SPAN);
      const p = this.flyPhase[i];
      pos.setXYZ(
        i,
        this.flyBase[j] + Math.sin(t * 0.7 + p) * 0.35,
        this.flyBase[j + 1] + Math.sin(t * 1.1 + p * 2) * 0.25,
        this.flyBase[j + 2] + Math.cos(t * 0.5 + p) * 0.35,
      );
      const blink = Math.max(0, Math.sin(t * 1.6 + p)) ** 3 * 1.6;
      col.setXYZ(i, 0.85 * blink, 1 * blink, 0.35 * blink);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  moveCamera(game: Game, dt: number): void {
    const fx = M.laneX(game.fairy.x);
    this.camX += (fx * 0.28 - this.camX) * Math.min(1, dt * 3);
    this.shake = Math.max(0, this.shake - dt * 2);
    const s = this.shake * this.shake;
    this.camera.position.set(this.camX + (Math.random() - 0.5) * s * 0.5, 5.6 + (Math.random() - 0.5) * s * 0.35, 7.5);
    this.camera.lookAt(this.camX * 0.6, 0, -7);
  }

  /** If frames keep coming slowly, render fewer pixels. */
  adaptQuality(dt: number): void {
    this.slowTime = dt > 1 / 42 ? this.slowTime + dt : Math.max(0, this.slowTime - dt);
    if (this.slowTime < 2 || this.maxDpr <= 0.75) return;
    this.slowTime = 0;
    this.maxDpr = Math.max(0.75, Math.min(this.maxDpr, devicePixelRatio || 1) - 0.25);
    this.resize(this.width, this.height);
  }
}
