import * as THREE from "three";
import {
  COURT_HALF_WIDTH,
  GYM_HEIGHT,
  GYM_MAX_X,
  GYM_MAX_Z,
  GYM_MIN_X,
  GYM_MIN_Z,
} from "./dimensions";
import { drawnTexture, type GameFonts } from "./textures";
import { inked, toon } from "./toon";

const CREAM = 0xf1e4c6;
const GREEN = 0x3f5a3e;
const WOOD = 0xb8743f;
const WOOD_DARK = 0x8e5428;

const TRIM_LOW = 1.3;
const TRIM_HIGH = 7.2;
const WINDOW_BOTTOM = 3.7;
const WINDOW_TOP = 6.5;
const FAR_BANNER_X = 4;

interface Wall {
  name: string;
  /** Centre of the wall on the floor. */
  center: THREE.Vector3;
  /** Inward-facing normal. */
  normal: THREE.Vector3;
  length: number;
}

/**
 * The gym shell: cream walls with green trim, windows with light shafts,
 * wooden bleachers along the far sideline and the 全国制覇 banners.
 *
 * Walls are single-sided and face inward, so any camera outside the gym (the
 * high isometric view) sees straight through the near walls — a dollhouse cut.
 */
export function createGym(fonts: GameFonts): THREE.Group {
  const gym = new THREE.Group();
  gym.name = "gym";

  const midX = (GYM_MIN_X + GYM_MAX_X) / 2;
  const midZ = (GYM_MIN_Z + GYM_MAX_Z) / 2;
  const lengthX = GYM_MAX_X - GYM_MIN_X;
  const lengthZ = GYM_MAX_Z - GYM_MIN_Z;
  const walls: Wall[] = [
    { name: "wall-far", center: new THREE.Vector3(midX, 0, GYM_MIN_Z), normal: new THREE.Vector3(0, 0, 1), length: lengthX },
    { name: "wall-near", center: new THREE.Vector3(midX, 0, GYM_MAX_Z), normal: new THREE.Vector3(0, 0, -1), length: lengthX },
    { name: "wall-east", center: new THREE.Vector3(GYM_MAX_X, 0, midZ), normal: new THREE.Vector3(-1, 0, 0), length: lengthZ },
    { name: "wall-west", center: new THREE.Vector3(GYM_MIN_X, 0, midZ), normal: new THREE.Vector3(1, 0, 0), length: lengthZ },
  ];

  const wallMat = toon(CREAM);
  const trimMat = toon(GREEN);
  for (const wall of walls) {
    const group = new THREE.Group();
    group.name = wall.name;
    group.position.copy(wall.center);
    group.lookAt(wall.center.clone().add(wall.normal));
    gym.add(group);

    // In the wall's local frame: +Z is inward, X runs along the wall.
    group.add(panel(wall.length, GYM_HEIGHT, 0, GYM_HEIGHT / 2, 0, wallMat));
    group.add(panel(wall.length, TRIM_LOW, 0, TRIM_LOW / 2, 0.01, trimMat));
    group.add(panel(wall.length, GYM_HEIGHT - TRIM_HIGH, 0, (GYM_HEIGHT + TRIM_HIGH) / 2, 0.01, trimMat));

    const windowCount = Math.max(2, Math.floor(wall.length / 7));
    const spacing = wall.length / windowCount;
    for (let i = 0; i < windowCount; i++) {
      const x = -wall.length / 2 + spacing * (i + 0.5);
      // Keep the banner spots clear (end-wall centre; far wall around FAR_BANNER_X).
      if (wall.name.startsWith("wall-e") || wall.name.startsWith("wall-w")) {
        if (Math.abs(x) < 3.5) continue;
      }
      if (wall.name === "wall-far" && Math.abs(x - FAR_BANNER_X) < 5) continue;
      group.add(createWindow(x));
      if (wall.name === "wall-far") group.add(lightShaft(x));
    }
  }

  // Banners: above the far bleachers and above the +X hoop (camera B looks at it).
  const bannerTex = drawnTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = "#c22a22";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1a1410";
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.fillStyle = "#fff8ec";
    ctx.font = `150px ${fonts.jp}, "Hiragino Mincho ProN", "Yu Mincho", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("全 国 制 覇", w / 2, h / 2 + 8);
  });
  // Planes get no outline hull (it would show as a black slab from behind);
  // the ink border is painted into the texture instead.
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
  const farBanner = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), bannerMat);
  farBanner.position.set(FAR_BANNER_X, 5.3, GYM_MIN_Z + 0.05);
  gym.add(farBanner);
  const endBanner = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), bannerMat);
  endBanner.position.set(GYM_MAX_X - 0.05, 5.6, 0);
  endBanner.rotation.y = -Math.PI / 2;
  gym.add(endBanner);

  // School name on the top trim of the far wall.
  const nameTex = drawnTexture(2048, 160, (ctx, w, h) => {
    ctx.fillStyle = "#f6efdc";
    ctx.font = `110px ${fonts.display}, Impact, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = "40px";
    ctx.fillText("KAIZEN HIGH SCHOOL", w / 2, h / 2 + 6);
  });
  const name = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 0.94),
    new THREE.MeshBasicMaterial({ map: nameTex, transparent: true }),
  );
  name.position.set(-6, (GYM_HEIGHT + TRIM_HIGH) / 2, GYM_MIN_Z + 0.03);
  gym.add(name);

  gym.add(createBleachers());
  return gym;
}

function panel(
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function createWindow(x: number): THREE.Group {
  const win = new THREE.Group();
  const w = 2.4;
  const h = WINDOW_TOP - WINDOW_BOTTOM;
  const y = (WINDOW_TOP + WINDOW_BOTTOM) / 2;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: 0xcfe6f2 }),
  );
  glass.position.set(x, y, 0.02);
  win.add(glass);
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x2a2620 });
  const bar = (bw: number, bh: number, bx: number, by: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), frameMat);
    m.position.set(bx, by, 0.03);
    win.add(m);
  };
  const t = 0.07;
  bar(w + t, t, x, WINDOW_TOP);
  bar(w + t, t, x, WINDOW_BOTTOM);
  bar(t, h + t, x - w / 2, y);
  bar(t, h + t, x + w / 2, y);
  bar(t * 0.7, h, x, y);
  bar(w, t * 0.7, x, y + h * 0.12);
  // Sill.
  const sill = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, 0.12), new THREE.MeshBasicMaterial({ color: GREEN }));
  sill.position.set(x, WINDOW_BOTTOM - 0.1, 0.03);
  win.add(sill);
  return win;
}

/** Soft additive wedge of window light falling toward the court. */
function lightShaft(x: number): THREE.Mesh {
  const tex = drawnTexture(64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255, 246, 220, 0.55)");
    g.addColorStop(1, "rgba(255, 246, 220, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const length = 11;
  const geometry = new THREE.PlaneGeometry(2.4, length);
  geometry.translate(0, -length / 2, 0);
  const shaft = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shaft.position.set(x, WINDOW_TOP, 0.1);
  shaft.rotation.x = -1.0; // tilt down and into the room
  shaft.renderOrder = 2;
  return shaft;
}

function createBleachers(): THREE.Group {
  const group = new THREE.Group();
  group.name = "bleachers";
  const rows = 5;
  const rise = 0.42;
  const tread = 0.78;
  const length = 22;
  const frontZ = -COURT_HALF_WIDTH - 1.4;
  const seat = toon(WOOD);
  const riser = toon(WOOD_DARK);
  for (let r = 0; r < rows; r++) {
    const z = frontZ - r * tread - tread / 2;
    const top = (r + 1) * rise;
    const step = inked(new THREE.BoxGeometry(length, top, tread), r % 2 ? seat : riser, 2);
    step.position.set(0, top / 2, z);
    group.add(step);
    // Seat board lip along the front of each row.
    const lip = inked(new THREE.BoxGeometry(length, 0.06, 0.32), seat, 1.5);
    lip.position.set(0, top + 0.03, z + tread / 2 - 0.16);
    group.add(lip);
  }
  const backZ = frontZ - rows * tread;
  // Fill the gap between the top row and the wall.
  const back = inked(
    new THREE.BoxGeometry(length, rows * rise, Math.max(0.05, backZ - GYM_MIN_Z)),
    riser,
    2,
  );
  back.position.set(0, (rows * rise) / 2, (backZ + GYM_MIN_Z) / 2);
  group.add(back);
  return group;
}
