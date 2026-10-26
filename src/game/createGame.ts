import * as THREE from "three";
import { createBall } from "./ball";
import { CameraRig, type Subject } from "./cameras";
import { createFloor } from "./court";
import {
  BALL_CIRCUMFERENCE,
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  RIM_HEIGHT,
} from "./dimensions";
import { createGym } from "./gym";
import { createHoop } from "./hoop";
import { hudStore, type ViewId } from "./hudStore";
import { createPlayer, heldBallPosition } from "./player";
import { clearDrawnTextures, redrawWhenFontsLoad, type GameFonts } from "./textures";
import { setOutlineResolution } from "./toon";

/** Where the player starts: near half, just beyond the arc, facing the +X hoop. */
export const PLAYER_START = new THREE.Vector3(4.2, 0, 0.6);

export interface Game {
  dispose(): void;
}

/** Dev-only debug handle exposed as `window.__game` for automation. */
export interface GameDebugHandle {
  frames: number;
  world: {
    courtLength: number;
    courtWidth: number;
    rimHeight: number;
    ballRadius: number;
    ballCircumference: number;
  };
  player: { position: [number, number, number]; facing: [number, number, number] };
  ball: { position: [number, number, number]; radius: number; held: boolean };
  camera: {
    view: ViewId;
    gliding: boolean;
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  cycleView(): void;
  setView(view: ViewId): void;
}

declare global {
  interface Window {
    __game?: GameDebugHandle;
  }
}

const tuple = (v: THREE.Vector3): [number, number, number] => [
  +v.x.toFixed(4),
  +v.y.toFixed(4),
  +v.z.toFixed(4),
];

export function createGame(container: HTMLElement, fonts: GameFonts): Game {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x2a1b10);
  renderer.domElement.dataset.testid = "game-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a1b10, 70, 140);

  // Warm key light from the far-wall windows + a soft fill.
  scene.add(new THREE.HemisphereLight(0xfff3dc, 0x8a5a33, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
  sun.position.set(-6, 14, -10);
  scene.add(sun);

  scene.add(createFloor(renderer.capabilities.getMaxAnisotropy()));
  scene.add(createGym(fonts));
  scene.add(createHoop(1));
  scene.add(createHoop(-1));

  const player = createPlayer(fonts);
  player.root.position.copy(PLAYER_START);
  const facing = new THREE.Vector3(1, 0, 0);
  player.root.rotation.y = Math.atan2(facing.x, facing.z);
  scene.add(player.root);
  scene.add(blobShadow(0.55, player.root.position));

  const ball = createBall();
  scene.add(ball);
  const ballShadow = blobShadow(BALL_RADIUS * 1.3, new THREE.Vector3());
  scene.add(ballShadow);

  const subject: Subject = { position: player.root.position, facing };
  const rig = new CameraRig(1, subject);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    rig.camera.aspect = w / h;
    rig.camera.updateProjectionMatrix();
    setOutlineResolution(w, h);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyV") rig.cycle();
  };
  window.addEventListener("keydown", onKey);

  hudStore.set({ view: rig.view });
  void redrawWhenFontsLoad(fonts);

  let frames = 0;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    player.update(elapsed);
    heldBallPosition(player, ball.position);
    ballShadow.position.set(ball.position.x, 0.004, ball.position.z);
    rig.update(dt, subject);
    renderer.render(scene, rig.camera);
    frames++;
    if (frames === 1) container.dataset.rendered = "true";
  });

  if (process.env.NODE_ENV !== "production") {
    window.__game = {
      get frames() {
        return frames;
      },
      world: {
        courtLength: +COURT_LENGTH.toFixed(4),
        courtWidth: +COURT_WIDTH.toFixed(4),
        rimHeight: +RIM_HEIGHT.toFixed(4),
        ballRadius: +BALL_RADIUS.toFixed(4),
        ballCircumference: +BALL_CIRCUMFERENCE.toFixed(4),
      },
      get player() {
        return { position: tuple(player.root.position), facing: tuple(facing) };
      },
      get ball() {
        return { position: tuple(ball.position), radius: BALL_RADIUS, held: true };
      },
      get camera() {
        return {
          view: rig.view,
          gliding: rig.gliding,
          position: tuple(rig.camera.position),
          target: tuple(rig.pose.target),
          fov: +rig.camera.fov.toFixed(2),
        };
      },
      cycleView: () => rig.cycle(),
      setView: (view: ViewId) => rig.setView(view),
    } as GameDebugHandle;
  }

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener("keydown", onKey);
      observer.disconnect();
      clearDrawnTextures();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m: THREE.Material) => {
            for (const value of Object.values(m)) {
              if (value instanceof THREE.Texture) value.dispose();
            }
            m.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      delete container.dataset.rendered;
      if (window.__game) delete window.__game;
    },
  };
}

/** Soft ink-brown ellipse on the floor (anime-style contact shadow). */
function blobShadow(radius: number, follow: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 32);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x4a2a14,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    }),
  );
  mesh.position.set(follow.x, 0.003, follow.z);
  mesh.renderOrder = 1;
  return mesh;
}
