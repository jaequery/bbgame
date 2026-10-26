import * as THREE from "three";
import {
  CENTER_CIRCLE_RADIUS,
  CENTER_INNER_RADIUS,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  FREE_THROW_CIRCLE_RADIUS,
  GYM_MAX_X,
  GYM_MAX_Z,
  GYM_MIN_X,
  GYM_MIN_Z,
  HOOP_X,
  LANE_LENGTH,
  LANE_WIDTH,
  LINE_WIDTH,
  RESTRICTED_RADIUS,
  THREE_POINT_CORNER,
  THREE_POINT_RADIUS,
} from "./dimensions";
import { toon } from "./toon";

const PX_PER_M = 96;
const PLANK_WIDTH = 0.0572; // 2¼ in maple strips

const KEY_RED = "#c4302b";
const LINE = "#fbf6ea";

/**
 * Hardwood floor for the whole gym with the court painted on, drawn into one
 * canvas texture at real scale (96 px per metre).
 */
export function createFloor(maxAnisotropy: number): THREE.Mesh {
  const width = GYM_MAX_X - GYM_MIN_X;
  const depth = GYM_MAX_Z - GYM_MIN_Z;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PX_PER_M);
  canvas.height = Math.round(depth * PX_PER_M);
  const ctx = canvas.getContext("2d")!;

  // World (x, z) → canvas pixels. Canvas y grows toward +Z.
  const toPx = (x: number, z: number): [number, number] => [
    (x - GYM_MIN_X) * PX_PER_M,
    (z - GYM_MIN_Z) * PX_PER_M,
  ];
  const m = (v: number) => v * PX_PER_M;

  paintPlanks(ctx, canvas.width, canvas.height);

  ctx.lineWidth = m(LINE_WIDTH);
  ctx.strokeStyle = LINE;
  ctx.lineCap = "butt";

  for (const side of [-1, 1] as const) {
    const baseline = side * COURT_HALF_LENGTH;
    const hoopX = side * HOOP_X;
    const ftX = baseline - side * LANE_LENGTH;

    // Painted key.
    ctx.fillStyle = KEY_RED;
    const [kx0, kz0] = toPx(Math.min(baseline, ftX), -LANE_WIDTH / 2);
    ctx.fillRect(kx0, kz0, m(LANE_LENGTH), m(LANE_WIDTH));
    ctx.strokeRect(kx0, kz0, m(LANE_LENGTH), m(LANE_WIDTH));

    // Free-throw circle (outer half solid, inner half dashed like the real thing).
    const [fx, fz] = toPx(ftX, 0);
    const towardMid = side > 0 ? Math.PI : 0;
    ctx.beginPath();
    ctx.arc(fx, fz, m(FREE_THROW_CIRCLE_RADIUS), towardMid - Math.PI / 2, towardMid + Math.PI / 2);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([m(1.25 * 0.3048), m(1.25 * 0.3048)]);
    ctx.beginPath();
    ctx.arc(fx, fz, m(FREE_THROW_CIRCLE_RADIUS), towardMid + Math.PI / 2, towardMid + (3 * Math.PI) / 2);
    ctx.stroke();
    ctx.restore();

    // Restricted area arc.
    const [hx, hz] = toPx(hoopX, 0);
    ctx.beginPath();
    ctx.arc(hx, hz, m(RESTRICTED_RADIUS), towardMid - Math.PI / 2, towardMid + Math.PI / 2);
    ctx.stroke();

    // Three-point line: straight corner segments + arc.
    const arcHalf = Math.asin(THREE_POINT_CORNER / THREE_POINT_RADIUS);
    const cornerDepth = Math.sqrt(THREE_POINT_RADIUS ** 2 - THREE_POINT_CORNER ** 2);
    const meetX = hoopX - side * cornerDepth;
    ctx.beginPath();
    for (const zs of [-1, 1]) {
      const [ax, az] = toPx(baseline, zs * THREE_POINT_CORNER);
      const [bx, bz] = toPx(meetX, zs * THREE_POINT_CORNER);
      ctx.moveTo(ax, az);
      ctx.lineTo(bx, bz);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hz, m(THREE_POINT_RADIUS), towardMid - arcHalf, towardMid + arcHalf);
    ctx.stroke();
  }

  // Centre circle.
  const [cx, cz] = toPx(0, 0);
  ctx.fillStyle = KEY_RED;
  ctx.beginPath();
  ctx.arc(cx, cz, m(CENTER_CIRCLE_RADIUS), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cz, m(CENTER_INNER_RADIUS), 0, Math.PI * 2);
  ctx.stroke();

  // Half-court line and boundary (lines sit inside the 94×50 ft playing area).
  const [h0x, h0z] = toPx(0, -COURT_HALF_WIDTH);
  ctx.beginPath();
  ctx.moveTo(h0x, h0z);
  ctx.lineTo(h0x, h0z + m(COURT_HALF_WIDTH * 2));
  ctx.stroke();
  const [bx0, bz0] = toPx(-COURT_HALF_LENGTH, -COURT_HALF_WIDTH);
  const inset = m(LINE_WIDTH) / 2;
  ctx.strokeRect(
    bx0 + inset,
    bz0 + inset,
    m(COURT_HALF_LENGTH * 2) - 2 * inset,
    m(COURT_HALF_WIDTH * 2) - 2 * inset,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  // PlaneGeometry's V runs bottom→top; after rotating flat, canvas top maps to −Z. Good.
  const floor = new THREE.Mesh(geometry, toon(0xffffff, { map: texture }));
  floor.position.set((GYM_MIN_X + GYM_MAX_X) / 2, 0, (GYM_MIN_Z + GYM_MAX_Z) / 2);
  floor.name = "floor";
  return floor;
}

function paintPlanks(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#d99a5b";
  ctx.fillRect(0, 0, w, h);
  // Planks run along the court length (X), stacked across Z.
  const plankPx = PLANK_WIDTH * PX_PER_M;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const tones = ["#d49352", "#dda062", "#d89a58", "#e0a66a", "#cf8d4c"];
  for (let y = 0; y < h; y += plankPx) {
    let x = -rand() * 3 * PX_PER_M;
    while (x < w) {
      const len = (1.2 + rand() * 2.4) * PX_PER_M;
      ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
      ctx.fillRect(x, y, len, plankPx);
      ctx.fillStyle = "rgba(90, 45, 15, 0.35)";
      ctx.fillRect(x, y, 1.5, plankPx); // butt joint
      x += len;
    }
    ctx.fillStyle = "rgba(90, 45, 15, 0.28)";
    ctx.fillRect(0, y, w, 1); // seam between strips
  }
}
