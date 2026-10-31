import * as THREE from 'three';
import {
  COURSES,
  ITEMS,
  type ClassId,
  type Course,
  type GhostFrame,
  type PeerState,
  type Pose,
} from '../../shared/game';
import { botReplay, interpolateReplay } from '../../shared/replay';
import { createRunner, platformTop, stepRunner, motionPhase } from './physics';
import { makeCharacter, type Character } from './character';
import { RunnerControls, FixedStepper, type Action, type Bindings } from './controls';

export interface Rival {
  id: string;
  name: string;
  color: string;
  frames?: GhostFrame[];
  live?: boolean;
}
export interface HudState {
  time: number;
  speed: number;
  checkpoint: number;
  cooldown: number;
  progress: number;
  grounded: boolean;
  pose: Pose;
  message: string;
  countdown: number;
  falls: number;
  rivals: { id: string; name: string; progress: number; finished?: number }[];
}
export interface EngineOptions {
  mode: 'menu' | 'locker' | 'race';
  course?: Course;
  classId?: ClassId;
  color?: string;
  trailColor?: string;
  rivals?: Rival[];
  startsAt?: number;
  sensitivity?: number;
  quality?: 'high' | 'low';
  bindings?: Bindings;
  alwaysSprint?: boolean;
  onHud?: (hud: HudState) => void;
  onFinish?: (time: number, frames: GhostFrame[], falls: number) => void;
  onState?: (state: Omit<PeerState, 'id'>) => void;
  onPause?: () => void;
}
export class ArenaEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 800);
  private animation = 0;
  private observer: ResizeObserver;
  private clock = new THREE.Clock();
  private disposed = false;
  private course: Course;
  private runner;
  private character: Character;
  private platformMeshes: THREE.Group[] = [];
  private gateBeams: { mesh: THREE.Mesh; bounds: THREE.Box3 }[] = [];
  private rivals = new Map<
    string,
    { data: Rival; character: Character; state?: PeerState; latest: number }
  >();
  private controls: RunnerControls;
  private simulation = new FixedStepper();
  private wasLocked = false;
  private yaw = 0;
  private pitch = 0.18;
  private paused = false;
  private began = 0;
  private frames: GhostFrame[] = [];
  private lastSample = -100;
  private lastHud = 0;
  private lastState = 0;
  private done = false;
  private message = '';
  private messageUntil = 0;
  private target = new THREE.Vector3();
  private cameraPos = new THREE.Vector3();
  private wind: THREE.Points | null = null;
  private audio: AudioContext | null = null;
  private sound = false;
  private trail: THREE.Line | null = null;
  private trailHistory: THREE.Vector3[] = [];
  constructor(
    private container: HTMLElement,
    private options: EngineOptions,
  ) {
    this.controls = new RunnerControls(options.bindings, options.alwaysSprint ?? true);
    this.course = options.course || COURSES[0];
    this.runner = createRunner(this.course);
    this.frames = [{ t: 0, p: [...this.course.start], yaw: 0, pose: 'idle' }];
    this.lastSample = 0;
    this.renderer = new THREE.WebGLRenderer({
      antialias: options.quality !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, options.quality === 'low' ? 1 : 1.7));
    this.renderer.shadowMap.enabled = options.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.setClearColor('#818e93');
    this.renderer.domElement.setAttribute(
      'aria-label',
      options.mode === 'race' ? 'Interactive parkour course' : '3D parkour arena preview',
    );
    container.appendChild(this.renderer.domElement);
    if (options.mode === 'race') {
      this.renderer.domElement.tabIndex = 0;
      this.renderer.domElement.focus({ preventScroll: true });
    }
    this.scene.fog = new THREE.FogExp2('#929c9c', 0.0045);
    this.buildWorld();
    this.character = makeCharacter(options.color || '#c7ef5c');
    this.scene.add(this.character.group);
    if (options.trailColor) {
      const points = Array.from({ length: 28 }, () => new THREE.Vector3(0, 0, 0));
      this.trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: options.trailColor, transparent: true, opacity: 0.7 }),
      );
      this.trail.frustumCulled = false;
      this.scene.add(this.trail);
    }
    if (options.mode !== 'race') {
      this.character.group.position.set(1, 4, -1);
      this.character.group.scale.setScalar(options.mode === 'locker' ? 2.2 : 2.8);
      this.character.group.rotation.y = 2.4;
    }
    for (const r of options.rivals || []) this.addRival(r);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouse);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.began =
      performance.now() + Math.max(500, (options.startsAt || Date.now() + 3000) - Date.now());
    this.loop();
  }
  private material(color: string, roughness = 0.8, metalness = 0.15) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }
  private surfaceTexture(windows = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = windows ? '#aab8bb' : '#a8aaa2';
    ctx.fillRect(0, 0, 256, 256);
    let seed = 39;
    for (let i = 0; i < 2400; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % 256;
      seed = (seed * 16807) % 2147483647;
      const y = seed % 256;
      ctx.fillStyle = i % 2 ? '#17242a16' : '#fff8df1a';
      ctx.fillRect(x, y, (i % 3) + 1, (i % 2) + 1);
    }
    if (windows) {
      for (let y = 0; y < 256; y += 32)
        for (let x = 0; x < 256; x += 32) {
          ctx.fillStyle = (x + y) % 96 === 0 ? '#3f535c' : '#697f84';
          ctx.fillRect(x + 3, y + 3, 25, 24);
          ctx.fillStyle = '#f4dfae35';
          ctx.fillRect(x + 4, y + 3, 23, 2);
        }
    } else {
      ctx.strokeStyle = '#35444844';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, 255, 255);
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = '#19282a44';
        ctx.fillRect(i * 16 + 4, 3, 2, 2);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(windows ? 2 : 3, windows ? 5 : 3);
    return texture;
  }
  private box(
    size: number[],
    p: number[],
    material: THREE.Material,
    parent: THREE.Object3D = this.scene,
  ) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...(size as [number, number, number])),
      material,
    );
    m.position.set(...(p as [number, number, number]));
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  private buildWorld() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(550, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color('#5b7483') },
          bottom: { value: new THREE.Color('#efd6af') },
        },
        vertexShader:
          'varying vec3 vP; void main(){vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){float h=normalize(vP).y; gl_FragColor=vec4(mix(bottom,top,smoothstep(-.12,.85,h)),1.);}',
      }),
    );
    this.scene.add(sky);
    this.scene.add(new THREE.HemisphereLight('#d5e9f1', '#3c454c', 2.3));
    const sun = new THREE.DirectionalLight('#ffddb0', 3.4);
    sun.position.set(-40, 70, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -65;
    sun.shadow.camera.right = 65;
    sun.shadow.camera.top = 110;
    sun.shadow.camera.bottom = -50;
    sun.shadow.camera.far = 200;
    sun.shadow.normalBias = 0.04;
    sun.target.position.z = 55;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#a2d9e7', 1);
    fill.position.set(20, 20, -20);
    this.scene.add(fill);
    const concrete = this.material(this.course.id === 'foundry' ? '#6b6158' : '#60696b');
    const surface = this.material('#858a83', 0.94),
      dark = this.material('#26383c', 0.6, 0.4);
    const concreteTexture = this.surfaceTexture();
    concrete.map = concreteTexture;
    concrete.bumpMap = concreteTexture;
    concrete.bumpScale = 0.08;
    surface.map = concreteTexture;
    surface.bumpMap = concreteTexture;
    surface.bumpScale = 0.045;
    const edge = new THREE.MeshStandardMaterial({
      color: this.course.accent,
      emissive: this.course.accent,
      emissiveIntensity: 0.35,
      roughness: 0.5,
    });
    const caution = this.material('#e5a663', 0.72);
    const towerMaterials = [
      this.material('#78858b'),
      this.material('#8b9190'),
      this.material('#596c77'),
      this.material('#626c70'),
    ];
    const windows = this.surfaceTexture(true);
    towerMaterials.forEach((material) => {
      material.map = windows;
      material.roughness = 0.45;
      material.metalness = 0.35;
    });
    // Deterministic geometry keeps the course identical on every client.
    for (let i = 0; i < 70; i++) {
      const side = i % 2 ? -1 : 1,
        x = side * (22 + ((i * 17) % 95)),
        z = -80 + ((i * 37) % 430);
      const h = 15 + ((i * 19) % 70),
        w = 9 + ((i * 7) % 19),
        d = 10 + ((i * 11) % 20);
      const b = this.box([w, h, d], [x, h / 2 - 42, z], towerMaterials[i % 4]);
      const cap = this.box([w + 0.5, 0.6, d + 0.5], [x, h - 41.7, z], dark);
      cap.castShadow = false;
      if (i % 4 === 0) this.box([1, 8, 1], [x, h - 38, z], dark);
      b.castShadow = i < 10;
    }
    this.box(
      [550, 0.5, 550],
      [0, -44, 80],
      this.material(this.course.id === 'harbor' ? '#3a6570' : '#555f63'),
    );
    this.course.platforms.forEach((p, index) => {
      const group = new THREE.Group();
      group.position.set(...p.p);
      this.scene.add(group);
      this.platformMeshes.push(group);
      const top = p.size[1] / 2;
      this.box(
        p.size,
        [0, 0, 0],
        p.kind === 'wall' ? caution : p.kind === 'obstacle' ? dark : concrete,
        group,
      );
      if (!p.kind || p.kind === 'hinge') {
        this.box([p.size[0] + 0.05, 0.18, p.size[2] + 0.05], [0, top + 0.01, 0], surface, group);
        this.box(
          [p.size[0] + 0.12, 0.09, 0.12],
          [0, top + 0.13, -p.size[2] / 2],
          p.kind === 'hinge' ? caution : edge,
          group,
        );
        this.box([p.size[0] + 0.12, 0.09, 0.12], [0, top + 0.13, p.size[2] / 2], edge, group);
        for (const side of [-1, 1]) {
          this.box([0.12, 0.11, p.size[2]], [(side * p.size[0]) / 2, top + 0.13, 0], dark, group);
          this.box(
            [0.4, p.size[1], 0.5],
            [side * (p.size[0] / 2 - 0.3), 0, p.size[2] / 2 - 0.4],
            dark,
            group,
          );
          this.box(
            [0.1, 0.12, p.size[2] - 2],
            [side * (p.size[0] / 2 - 1), top + 0.12, 0],
            edge,
            group,
          );
        }
        // Direction chevrons painted on the route.
        for (let k = 0; k < 3; k++) {
          const mark = this.box([1.2, 0.012, 0.13], [-0.4, top + 0.11, k * 1.2 - 1.2], edge, group);
          mark.rotation.y = -0.55;
          const mark2 = this.box([1.2, 0.012, 0.13], [0.4, top + 0.11, k * 1.2 - 1.2], edge, group);
          mark2.rotation.y = 0.55;
        }
        if (index > 0 && index % 2 === 0) {
          this.box([2.2, 1.3, 2], [p.size[0] / 2 - 1.5, top + 0.65, -5], dark, group);
          for (let g = 0; g < 5; g++)
            this.box(
              [1.9, 0.06, 0.06],
              [p.size[0] / 2 - 1.5, top + 1.3, -5.7 + g * 0.3],
              surface,
              group,
            );
        }
      } else if (p.kind === 'wall') {
        for (let k = 0; k < 9; k++)
          this.box([p.size[0] + 0.04, 0.075, p.size[2]], [0, -top + 1 + k * 0.8, 0], dark, group);
      } else {
        for (let k = 0; k < Math.floor(p.size[0]); k++) {
          const stripe = this.box(
            [0.35, p.size[1] + 0.02, p.size[2] + 0.02],
            [-p.size[0] / 2 + 0.3 + k, 0, 0],
            caution,
            group,
          );
          stripe.rotation.z = -0.2;
        }
      }
    });
    if (this.options.mode !== 'locker')
      this.course.checkpoints.forEach((cp, i) => {
        const gateMaterial = new THREE.MeshStandardMaterial({
          color: i === this.course.checkpoints.length - 1 ? '#f9c477' : this.course.accent,
          emissive: i === this.course.checkpoints.length - 1 ? '#ffb14d' : this.course.accent,
          emissiveIntensity: 1.4,
        });
        const [x, y, z] = cp.p;
        for (const s of [-1, 1]) {
          this.box([0.2, 5, 0.25], [x + s * 5.2, y + 2.5, z], gateMaterial);
          this.box([0.48, 0.5, 0.65], [x + s * 5.2, y + 0.25, z], dark);
        }
        const beamMaterial = gateMaterial.clone();
        beamMaterial.transparent = true;
        const beam = this.box([10.6, 0.16, 0.24], [x, y + 5, z], beamMaterial);
        this.gateBeams.push({ mesh: beam, bounds: new THREE.Box3().setFromObject(beam) });
        if (i > 0) {
          const sign = this.makeSign(
            cp.label,
            i === this.course.checkpoints.length - 1 ? '#f0bc79' : this.course.accent,
          );
          sign.position.set(x, y + 6.2, z);
          sign.rotation.y = Math.PI;
          this.scene.add(sign);
        }
      });
    // A suspended truss and cables give the skyline an industrial silhouette.
    for (const x of [-32, 35]) {
      this.box([1.2, 65, 1.2], [x, -9, 80], caution);
      this.box([45, 1.1, 1.1], [x, 23, 80], caution);
      const cable = this.box([0.08, 25, 0.08], [x + 14, 10, 80], dark);
      cable.castShadow = false;
    }
    const dustPositions = new Float32Array(180 * 3);
    for (let i = 0; i < 180; i++) {
      dustPositions[i * 3] = Math.sin(i * 10) * 50;
      dustPositions[i * 3 + 1] = (i * 13) % 50;
      dustPositions[i * 3 + 2] = ((i * 37) % 200) - 20;
    }
    const dust = new THREE.BufferGeometry();
    dust.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    this.wind = new THREE.Points(
      dust,
      new THREE.PointsMaterial({ color: '#f4e2c3', size: 0.06, transparent: true, opacity: 0.4 }),
    );
    this.scene.add(this.wind);
    if (this.options.mode === 'locker') {
      this.scene.fog = new THREE.FogExp2('#1b292d', 0.018);
      this.renderer.toneMappingExposure = 0.95;
    }
  }
  private makeSign(text: string, color: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#172126';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = color;
    ctx.font = 'bold 62px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, 256, 88);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 1.35),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
    );
  }
  private resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
  private onKeyDown = (e: KeyboardEvent) => {
    if (
      this.options.mode !== 'race' ||
      (e.target as HTMLElement)?.closest('input,textarea,select,[role="dialog"]')
    )
      return;
    const action = this.controls.actionFor(e.code);
    if (e.code === 'Escape' || action === 'pause') {
      if (!e.repeat) this.options.onPause?.();
      e.preventDefault();
      return;
    }
    if (this.paused || this.done) return;
    if (action || e.code.startsWith('Arrow')) e.preventDefault();
    this.controls.down(e.code, performance.now(), e.repeat);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.controls.up(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (
      this.options.mode !== 'race' ||
      this.paused ||
      this.done ||
      document.pointerLockElement !== this.renderer.domElement
    )
      return;
    const code = `Mouse${e.button}`;
    if (!this.controls.actionFor(code)) return;
    e.preventDefault();
    if (this.controls.actionFor(code) === 'pause') this.options.onPause?.();
    else this.controls.down(code, performance.now());
  };
  private onMouseUp = (e: MouseEvent) => {
    this.controls.up(`Mouse${e.button}`);
  };
  private onContextMenu = (e: MouseEvent) => {
    if (document.pointerLockElement === this.renderer.domElement) e.preventDefault();
  };
  private onBlur = () => {
    this.controls.clear();
    if (this.options.mode === 'race' && !this.done && !this.paused) this.options.onPause?.();
  };
  private onMouse = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement || this.paused) return;
    this.yaw -= e.movementX * 0.002 * (this.options.sensitivity || 1);
    this.pitch = Math.max(-0.3, Math.min(0.8, this.pitch + e.movementY * 0.0015));
  };
  private onPointerLock = () => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (this.wasLocked && !locked) {
      this.controls.clear();
      if (!this.paused && !this.done) this.options.onPause?.();
    }
    this.wasLocked = locked;
  };
  private onCanvasClick = () => {
    if (this.options.mode === 'race' && !this.paused && !this.done)
      this.renderer.domElement.requestPointerLock?.()?.catch(() => {});
  };
  setPaused(paused: boolean) {
    this.paused = paused;
    this.controls.clear();
    if (paused && document.pointerLockElement) document.exitPointerLock();
    if (!paused) this.renderer.domElement.focus({ preventScroll: true });
  }
  setSound(enabled: boolean) {
    this.sound = enabled;
  }
  updateControls(bindings: Bindings, alwaysSprint: boolean, sensitivity: number) {
    this.controls.bindings = bindings;
    this.controls.alwaysSprint = alwaysSprint;
    this.options.sensitivity = sensitivity;
    this.controls.clear();
  }
  touchMove(forward: number, right: number) {
    this.controls.move(forward, right);
  }
  touchAction(action: Action) {
    this.controls.press(action, performance.now());
  }
  touchHold(action: Action, down: boolean) {
    this.controls.hold(action, down);
  }
  touchLook(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-0.3, Math.min(0.8, this.pitch + dy * 0.004));
  }
  addRival(data: Rival) {
    const character = makeCharacter(data.color, true);
    character.group.visible = false;
    this.scene.add(character.group);
    this.rivals.set(data.id, { data, character, latest: 0 });
  }
  updatePeer(state: PeerState) {
    const r = this.rivals.get(state.id);
    if (r) {
      r.state = state;
      r.latest = performance.now();
    }
  }
  replaceWithBot(id: string, duration: number) {
    const r = this.rivals.get(id);
    if (r) {
      r.data.live = false;
      r.data.frames = botReplay(this.course, duration);
      r.data.name += ' · BOT';
    }
  }
  private beep(frequency: number) {
    if (!this.sound) return;
    try {
      this.audio ||= new AudioContext();
      const o = this.audio.createOscillator(),
        g = this.audio.createGain();
      o.frequency.value = frequency;
      g.gain.setValueAtTime(0.025, this.audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.18);
      o.connect(g);
      g.connect(this.audio.destination);
      o.start();
      o.stop(this.audio.currentTime + 0.18);
    } catch {
      /* Audio can be unavailable before a user gesture. */
    }
  }
  private loop = () => {
    if (this.disposed) return;
    this.animation = requestAnimationFrame(this.loop);
    const delta = Math.min(0.15, this.clock.getDelta());
    const now = performance.now();
    if (this.options.mode === 'race') {
      const elapsed = Math.max(0, now - this.began),
        countdown = Math.max(0, Math.ceil((this.began - now) / 1000));
      if (!countdown && this.paused && !this.done && elapsed - this.lastSample >= 95) {
        this.frames.push({
          t: Math.floor(elapsed),
          p: [...this.runner.p],
          yaw: this.yaw,
          pose: 'idle',
        });
        this.lastSample = elapsed;
      }
      if (!countdown && !this.paused && !this.done) {
        this.simulation.advance(delta, (dt) => {
          const input = this.controls.consume(now, this.yaw);
          stepRunner(this.runner, input, this.course, this.options.classId || 'runner', dt);
          if (this.runner.message) {
            this.message = this.runner.message;
            this.messageUntil = now + 1600;
            if (this.message === 'CHECKPOINT') this.beep(880);
          }
        });
        if (elapsed - this.lastSample >= 95 || this.runner.finished) {
          this.frames.push({
            t: Math.floor(elapsed),
            p: [...this.runner.p],
            yaw: this.yaw,
            pose: this.runner.pose,
            phase: motionPhase(this.runner),
            wallSide: this.runner.wallSide,
          });
          this.lastSample = elapsed;
        }
        if (this.runner.finished) {
          this.done = true;
          if (document.pointerLockElement) document.exitPointerLock();
          this.beep(1100);
          this.options.onState?.({
            p: this.runner.p,
            yaw: this.yaw,
            pose: 'idle',
            progress: 1,
            finished: Math.floor(elapsed),
          });
          this.options.onFinish?.(Math.floor(elapsed), this.frames, this.runner.falls);
        }
      }
      const s = this.runner;
      this.character.group.position.set(...s.p);
      this.character.group.rotation.y = this.yaw;
      const contact = s.vault?.contact;
      const handTarget = contact
        ? new THREE.Vector3(
            contact[0] - s.p[0],
            contact[1] - s.p[1],
            contact[2] - s.p[2],
          ).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw)
        : undefined;
      this.character.animate(s.time, Math.hypot(s.v[0], s.v[2]), s.pose, {
        phase: motionPhase(s),
        wallSide: s.wallSide,
        handTarget,
      });
      this.platformMeshes.forEach((g, i) => {
        const p = this.course.platforms[i];
        g.position.y = platformTop(p, i, s) - p.size[1] / 2;
      });
      const sin = Math.sin(this.yaw),
        cos = Math.cos(this.yaw);
      this.cameraPos.set(s.p[0] - sin * 5.7, s.p[1] + 3.3 + this.pitch * 3, s.p[2] - cos * 5.7);
      this.camera.position.lerp(this.cameraPos, Math.min(1, delta * 9));
      this.target.set(s.p[0] + sin * 9, s.p[1] + 1.4 - this.pitch * 3, s.p[2] + cos * 9);
      this.camera.lookAt(this.target);
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        s.boost > 0 ? 67 : this.options.mode === 'race' ? 59 : 48,
        delta * 3,
      );
      this.camera.updateProjectionMatrix();
      const rivalHud: HudState['rivals'] = [];
      for (const [id, r] of this.rivals) {
        const frame = r.data.live
          ? r.state
          : r.data.frames
            ? interpolateReplay(r.data.frames, elapsed)
            : null;
        if (frame) {
          r.character.group.visible = elapsed > 0;
          const point = new THREE.Vector3(...frame.p);
          if (r.data.live) r.character.group.position.lerp(point, Math.min(1, delta * 12));
          else r.character.group.position.copy(point);
          r.character.group.rotation.y = frame.yaw;
          r.character.animate(elapsed / 1000, 9, frame.pose as Pose, {
            phase: frame.phase,
            wallSide: frame.wallSide,
          });
          const progress = Math.max(0, Math.min(1, (frame.p[2] + 5) / 156));
          rivalHud.push({
            id,
            name: r.data.name,
            progress,
            finished: r.data.live
              ? r.state?.finished
              : elapsed >= r.data.frames!.at(-1)!.t
                ? r.data.frames!.at(-1)!.t
                : undefined,
          });
        }
      }
      const progress = Math.min(1, Math.max(0, (s.p[2] + 5) / 156));
      if (now - this.lastHud > 80) {
        this.options.onHud?.({
          time: this.done ? this.frames.at(-1)!.t : elapsed,
          speed: Math.hypot(s.v[0], s.v[2]),
          checkpoint: s.checkpoint,
          cooldown: s.cooldown,
          progress,
          grounded: s.grounded,
          pose: s.pose,
          message: now < this.messageUntil ? this.message : '',
          countdown,
          falls: s.falls,
          rivals: rivalHud,
        });
        this.lastHud = now;
      }
      if (now - this.lastState > 95 && !this.done) {
        this.options.onState?.({
          p: [...s.p],
          yaw: this.yaw,
          pose: s.pose,
          phase: motionPhase(s),
          wallSide: s.wallSide,
          progress,
        });
        this.lastState = now;
      }
    } else {
      const t = now / 1000;
      if (this.options.mode === 'locker') {
        this.camera.position.set(6.8 + Math.sin(t * 0.12) * 1.2, 7.4, -9);
        this.camera.lookAt(1, 6.2, -1);
        this.character.group.rotation.y = 2.5 + Math.sin(t * 0.15) * 0.2;
      } else {
        this.camera.position.set(17 + Math.sin(t * 0.08) * 1.3, 11, -16);
        this.camera.lookAt(-2, 5.2, 26);
      }
      this.character.animate(t, 0, 'idle');
    }
    // A dive can lift the chase camera through an overhead checkpoint bar.
    // Fade nearby decorative bars so they never cover the runner or route.
    for (const { mesh, bounds } of this.gateBeams) {
      const opacity = THREE.MathUtils.clamp(
        (bounds.distanceToPoint(this.camera.position) - 0.25) / 1.5,
        0,
        1,
      );
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.opacity = opacity;
      material.depthWrite = opacity === 1;
      mesh.visible = opacity > 0;
    }
    if (this.wind) this.wind.position.x = Math.sin(now / 12000) * 5;
    if (this.trail) {
      if (this.options.mode === 'race') {
        this.trailHistory.unshift(
          new THREE.Vector3(this.runner.p[0], this.runner.p[1] + 0.6, this.runner.p[2]),
        );
        this.trailHistory.length = Math.min(28, this.trailHistory.length);
      } else {
        this.trailHistory = Array.from(
          { length: 28 },
          (_, i) => new THREE.Vector3(1 + Math.sin(i * 0.12) * 2, 5 + i * 0.02, -1 + i * 0.22),
        );
      }
      const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 28; i++) {
        const p = this.trailHistory[Math.min(i, this.trailHistory.length - 1)];
        if (p) attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      this.trail.visible =
        this.options.mode !== 'race' || Math.hypot(this.runner.v[0], this.runner.v[2]) > 2;
    }
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.observer.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouse);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if ('map' in m) (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.audio?.close();
  }
}
