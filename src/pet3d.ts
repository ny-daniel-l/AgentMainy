// Optional 3D pet: renders a rigged, animated glTF model on the overlay canvas
// with three.js, as an opt-in alternative to the 2D spritesheet Pet. Exposes the
// SAME surface main.ts drives (load / setState / headroom / spriteRect /
// hitTest). The base model (/pet3d.glb, fal-generated + Meshy-rigged) carries
// the idle clip; extra clip-only files (combat/victory/look, mesh stripped at
// build time) play on the same skeleton. Pet STATES pick the clip.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Framing , tune without touching the rest.
const MODEL_HEIGHT = 2.1; // world units the model is scaled to
const CAM_Z = 4.0;
const CAM_FOV = 32;
const FEET_Y = -1.15; // where the feet sit (lower = pet stands lower in frame)

// Extra clip files and the states they serve; idle comes from the base model.
const EXTRA_CLIPS: Array<{ states: string[]; url: string }> = [
  { states: ["working"], url: "/anim_combat.glb" },
  { states: ["done", "celebrate"], url: "/anim_victory.glb" },
  { states: ["waiting"], url: "/anim_look.glb" },
];
const STATE_TINT: Record<string, number> = {
  idle: 0, registered: 0x5b7cfa, working: 0x5b7cfa, waiting: 0xf59e0b, done: 0x22c55e, celebrate: 0x8a6cff,
};

export class Pet3D {
  headroom = 0.05;
  spriteRect: { x: number; y: number; w: number; h: number };

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clipByState: Record<string, THREE.AnimationClip> = {};
  private current: THREE.AnimationAction | null = null;
  private hasClips = false;
  private rim: THREE.PointLight;
  private state = "idle";
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = 360;
    canvas.height = 420;
    this.spriteRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, canvas.width / canvas.height, 0.1, 100);
    this.camera.position.set(0, 0.05, CAM_Z);

    // Image-based lighting: without an environment map a PBR/metallic model
    // renders dark/grey. RoomEnvironment lights it evenly so colours show.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a46, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.6);
    fill.position.set(-3, 1, 2);
    this.scene.add(fill);
    this.rim = new THREE.PointLight(0x5b7cfa, 0, 14);
    this.rim.position.set(-3, 2.5, -2.5);
    this.scene.add(this.rim);

    requestAnimationFrame(() => this.loop());
  }

  // 3D mode ignores sprite URLs; it always shows the bundled model.
  load(_url: string) {
    const loader = new GLTFLoader();
    loader.load(
      "/pet3d.glb",
      (gltf) => {
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = MODEL_HEIGHT / (size.y || 1);
        obj.scale.setScalar(scale);
        obj.position.set(-center.x * scale, FEET_Y - box.min.y * scale, -center.z * scale);
        if (this.model) this.scene.remove(this.model);
        this.model = obj;
        this.scene.add(obj);

        this.mixer = new THREE.AnimationMixer(obj);
        const idle = gltf.animations[0];
        if (idle) {
          this.clipByState.idle = idle;
          this.clipByState.registered = idle;
          this.hasClips = true;
          this.play(this.state);
        }
        // Extra clip-only files play on the same skeleton (same bone names).
        for (const { states, url } of EXTRA_CLIPS) {
          loader.load(url, (g) => {
            const clip = g.animations[0];
            if (!clip) return;
            for (const s of states) this.clipByState[s] = clip;
            this.hasClips = true;
            if (states.includes(this.state)) this.play(this.state);
          });
        }
        log(`pet3d base loaded (idle clip: ${!!idle})`);
      },
      undefined,
      () => log("pet3d: /pet3d.glb failed to load")
    );
  }

  private play(state: string) {
    if (!this.mixer) return;
    const clip = this.clipByState[state] ?? this.clipByState.idle;
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(0.3).play();
    if (this.current && this.current !== next) this.current.fadeOut(0.3);
    this.current = next;
  }

  setState(state: string) {
    if (state === this.state) return;
    this.state = state;
    this.play(state);
  }

  // The model fills the canvas, so any point on it is the pet (no alpha test).
  hitTest(_cssX: number, _cssY: number) {
    return true;
  }

  // 2D-only idle fidget; the 3D pet has its own looping clips.
  fidget(_row: number) {}

  private loop() {
    const dt = this.clock.getDelta();
    if (this.mixer) this.mixer.update(dt);
    // Gentle procedural sway only if no skeletal clips loaded (fallback).
    if (this.model && !this.hasClips) {
      this.model.rotation.y = Math.sin(this.clock.elapsedTime * 0.8) * 0.3;
      this.model.position.y = FEET_Y + Math.sin(this.clock.elapsedTime * 2.2) * 0.03;
    }
    const tint = STATE_TINT[this.state] ?? 0;
    this.rim.color.setHex(tint || 0x5b7cfa);
    this.rim.intensity = tint ? 2.4 : 0;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.loop());
  }
}

function log(msg: string) {
  try {
    // @ts-ignore tauri global (withGlobalTauri)
    window.__TAURI__?.core?.invoke?.("log_debug", { msg });
  } catch {}
}
