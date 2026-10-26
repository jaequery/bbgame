import * as THREE from "three";
import { BALL_RADIUS } from "./dimensions";
import { drawnTexture } from "./textures";
import { inked, toon } from "./toon";

/** Regulation-size ball (29.5 in circumference) with ink seams. */
export function createBall(): THREE.Mesh {
  // Equirectangular map: u = longitude, v = latitude.
  const tex = drawnTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#e5671f";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1a1410";
    ctx.lineWidth = 5;
    // Two meridians (four seams around) and the equator.
    for (const u of [0, 0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(u * w, 0);
      ctx.lineTo(u * w, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    // Curved side seams.
    for (const c of [0.125, 0.625]) {
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const v = i / 64;
        const x = (c + 0.1 * Math.sin(v * Math.PI * 2)) * w;
        if (i === 0) ctx.moveTo(x, v * h);
        else ctx.lineTo(x, v * h);
      }
      ctx.stroke();
    }
  });
  const ball = inked(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), toon(0xffffff, { map: tex }), 2);
  ball.name = "ball";
  return ball;
}
