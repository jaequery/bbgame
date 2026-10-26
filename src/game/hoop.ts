import * as THREE from "three";
import {
  BACKBOARD_BOTTOM,
  BACKBOARD_FROM_BASELINE,
  BACKBOARD_HEIGHT,
  BACKBOARD_WIDTH,
  BOX_HEIGHT,
  BOX_WIDTH,
  COURT_HALF_LENGTH,
  HOOP_FROM_BASELINE,
  RIM_HEIGHT,
  RIM_RADIUS,
  RIM_TUBE,
} from "./dimensions";
import { inked, toon } from "./toon";

const NET_LENGTH = 0.45;
const NET_BOTTOM_RADIUS = 0.13;
const NET_LOOPS = 12;

/**
 * One basket assembly. `side` = +1 for the hoop at +X, −1 for −X.
 * Built in a local frame where the court is toward −X, then mirrored.
 */
export function createHoop(side: 1 | -1): THREE.Group {
  const hoop = new THREE.Group();
  hoop.name = side > 0 ? "hoop+x" : "hoop-x";

  const boardThickness = 0.05;
  const faceX = -BACKBOARD_FROM_BASELINE; // board face, relative to baseline
  const rimX = -HOOP_FROM_BASELINE;

  // Backboard with the shooter's box.
  const boardTex = backboardTexture();
  const board = inked(
    new THREE.BoxGeometry(boardThickness, BACKBOARD_HEIGHT, BACKBOARD_WIDTH),
    [
      toon(0xf4f1ea),
      toon(0xf4f1ea, { map: boardTex }), // −X face points at the court
      toon(0xf4f1ea),
      toon(0xf4f1ea),
      toon(0xf4f1ea),
      toon(0xf4f1ea),
    ] as unknown as THREE.Material,
    2.5,
  );
  board.position.set(faceX + boardThickness / 2, BACKBOARD_BOTTOM + BACKBOARD_HEIGHT / 2, 0);
  board.name = "backboard";
  hoop.add(board);

  // Rim + bracket.
  const rimMat = toon(0xf05a1a);
  const rim = inked(new THREE.TorusGeometry(RIM_RADIUS + RIM_TUBE, RIM_TUBE * 1.6, 10, 48), rimMat, 1.5);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(rimX, RIM_HEIGHT, 0);
  rim.name = "rim";
  hoop.add(rim);
  const bracketLen = HOOP_FROM_BASELINE - BACKBOARD_FROM_BASELINE - RIM_RADIUS;
  const bracket = inked(new THREE.BoxGeometry(bracketLen, 0.03, 0.12), rimMat, 1.5);
  bracket.position.set(faceX - bracketLen / 2, RIM_HEIGHT - 0.01, 0);
  hoop.add(bracket);

  hoop.add(createNet(rimX));

  // Stanchion: padded base behind the baseline, pole, and arm to the board.
  const steel = toon(0x24221f);
  const pad = toon(0x2f5a3c);
  const baseX = 1.25;
  const base = inked(new THREE.BoxGeometry(1.2, 0.9, 1.0), pad, 2);
  base.position.set(baseX + 0.3, 0.45, 0);
  hoop.add(base);
  const poleHeight = BACKBOARD_BOTTOM + 0.5;
  const pole = inked(new THREE.BoxGeometry(0.18, poleHeight, 0.18), steel, 2);
  pole.position.set(baseX, poleHeight / 2, 0);
  hoop.add(pole);
  const armLen = baseX - (faceX + boardThickness);
  const arm = inked(new THREE.BoxGeometry(armLen, 0.14, 0.14), steel, 2);
  arm.position.set(faceX + boardThickness + armLen / 2, BACKBOARD_BOTTOM + 0.45, 0);
  hoop.add(arm);
  const brace = inked(new THREE.BoxGeometry(armLen * 1.1, 0.08, 0.08), steel, 1.5);
  brace.position.set(faceX + boardThickness + armLen / 2, BACKBOARD_BOTTOM - 0.05, 0);
  brace.rotation.z = -0.32;
  hoop.add(brace);
  const padFront = inked(new THREE.BoxGeometry(0.06, 0.12, BACKBOARD_WIDTH + 0.02), pad, 1.5);
  padFront.position.set(faceX + boardThickness / 2, BACKBOARD_BOTTOM - 0.05, 0);
  hoop.add(padFront);

  hoop.position.x = side * COURT_HALF_LENGTH;
  if (side < 0) hoop.rotation.y = Math.PI;
  return hoop;
}

function createNet(rimX: number): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const rows = 5;
  const ring = (row: number, i: number) => {
    const t = row / rows;
    const r = THREE.MathUtils.lerp(RIM_RADIUS, NET_BOTTOM_RADIUS, t);
    const a = ((i + (row % 2) * 0.5) / NET_LOOPS) * Math.PI * 2;
    return new THREE.Vector3(rimX + Math.cos(a) * r, RIM_HEIGHT - t * NET_LENGTH, Math.sin(a) * r);
  };
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < NET_LOOPS; i++) {
      const p = ring(row, i);
      // Criss-cross diamonds down to the next row.
      points.push(p, ring(row + 1, i));
      points.push(p, ring(row + 1, i - 1 + (row % 2)));
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const net = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xfaf8f2 }),
  );
  net.name = "net";
  return net;
}

function backboardTexture(): THREE.CanvasTexture {
  const ppm = 256;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(BACKBOARD_WIDTH * ppm);
  canvas.height = Math.round(BACKBOARD_HEIGHT * ppm);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#1a1410";
  ctx.lineWidth = 0.05 * ppm;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth);
  ctx.strokeStyle = "#c4302b";
  ctx.lineWidth = 0.05 * ppm;
  const bw = BOX_WIDTH * ppm;
  const bh = BOX_HEIGHT * ppm;
  // Box bottom sits on the rim line (6 in above the board's bottom edge).
  const bottom = canvas.height - (RIM_HEIGHT - BACKBOARD_BOTTOM) * ppm;
  ctx.strokeRect((canvas.width - bw) / 2, bottom - bh, bw, bh);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
