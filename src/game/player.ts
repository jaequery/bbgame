import * as THREE from "three";
import { BALL_RADIUS, PLAYER_SCALE } from "./dimensions";
import { drawnTexture, type GameFonts } from "./textures";
import { inked, toon } from "./toon";

// Procedural toon humanoid: a joint hierarchy of Groups (a rig without skinning)
// with capsule/box body parts hung off each joint. Built facing local +Z; the
// player's right hand is on local −X. Later tickets animate `joints`.

export type JointName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "shoulderL"
  | "elbowL"
  | "handL"
  | "shoulderR"
  | "elbowR"
  | "handR"
  | "hipL"
  | "kneeL"
  | "ankleL"
  | "hipR"
  | "kneeR"
  | "ankleR";

export interface Player {
  root: THREE.Group;
  joints: Record<JointName, THREE.Group>;
  /** Advances the idle breathing bob. */
  update(elapsed: number): void;
}

const SKIN = 0xb8794f;
const JERSEY = 0xd2302a;
const JERSEY_TRIM = 0xfaf4e6;
const HAIR = 0xd8261f;
const SOCK = 0xf7f3ea;
const SHOE = 0xc8221c;

// Segment lengths at true scale (m) for a ~1.93 m player.
const THIGH = 0.48;
const SHIN = 0.47;
const UPPER_ARM = 0.31;
const FOREARM = 0.28;
const SPINE = 0.2;
const CHEST = 0.3;

export function createPlayer(fonts: GameFonts): Player {
  const root = new THREE.Group();
  root.name = "player";
  const j = {} as Record<JointName, THREE.Group>;
  const joint = (name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    j[name] = g;
    return g;
  };

  const skin = toon(SKIN);
  const jerseyTex = jerseyTexture(fonts);
  const jersey = toon(0xffffff, { map: jerseyTex });
  const shorts = toon(JERSEY);
  const trim = toon(JERSEY_TRIM);

  // Hips (pelvis) — height is set below once the legs are posed.
  const hips = joint("hips", root, 0, 1, 0);
  const shortsMesh = inked(new THREE.CylinderGeometry(0.2, 0.225, 0.2, 16), shorts);
  shortsMesh.position.y = -0.03;
  hips.add(shortsMesh);
  const waistband = inked(new THREE.CylinderGeometry(0.202, 0.202, 0.04, 16), trim, 1.5);
  waistband.position.y = 0.07;
  hips.add(waistband);

  // Torso.
  const spine = joint("spine", hips, 0, 0.06, 0);
  const chest = joint("chest", spine, 0, SPINE, 0);
  const torso = new THREE.CylinderGeometry(0.235, 0.205, 0.5, 20);
  torso.scale(1, 1, 0.68);
  const torsoMesh = inked(torso, jersey);
  torsoMesh.position.y = 0.04;
  chest.add(torsoMesh);

  // Neck + head + spiky hair.
  const neck = joint("neck", chest, 0, CHEST, 0);
  const neckMesh = inked(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin, 2);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);
  const head = joint("head", neck, 0, 0.1, 0);
  const headGeo = new THREE.SphereGeometry(0.115, 20, 16);
  headGeo.scale(0.92, 1.08, 1);
  const headMesh = inked(headGeo, skin);
  headMesh.position.y = 0.1;
  head.add(headMesh);
  addFace(head);
  addHair(head);

  // Arms.
  const arm = (side: "L" | "R") => {
    const sx = side === "L" ? 1 : -1;
    const shoulder = joint(`shoulder${side}`, chest, sx * 0.25, CHEST - 0.04, 0);
    const upper = inked(capsule(0.064, UPPER_ARM), skin);
    upper.position.y = -UPPER_ARM / 2;
    shoulder.add(upper);
    const elbow = joint(`elbow${side}`, shoulder, 0, -UPPER_ARM, 0);
    const fore = inked(capsule(0.054, FOREARM), skin);
    fore.position.y = -FOREARM / 2;
    elbow.add(fore);
    const hand = joint(`hand${side}`, elbow, 0, -FOREARM, 0);
    const handGeo = new THREE.SphereGeometry(0.058, 12, 10);
    handGeo.scale(1, 1.25, 0.6);
    const handMesh = inked(handGeo, skin, 2);
    handMesh.position.y = -0.05;
    hand.add(handMesh);
    const palm = new THREE.Object3D();
    palm.name = `palm${side}`;
    palm.position.y = -0.07;
    hand.add(palm);
    // Wristband.
    const band = inked(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 10), trim, 1.5);
    band.position.y = 0.03;
    hand.add(band);
  };
  arm("L");
  arm("R");

  // Legs.
  const leg = (side: "L" | "R") => {
    const sx = side === "L" ? 1 : -1;
    const hip = joint(`hip${side}`, hips, sx * 0.11, -0.05, 0);
    const thigh = inked(capsule(0.095, THIGH), skin);
    thigh.position.y = -THIGH / 2;
    hip.add(thigh);
    // Baggy shorts leg over the upper thigh, with a white hem stripe.
    const shortsLeg = inked(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 14), shorts);
    shortsLeg.position.y = -0.1;
    hip.add(shortsLeg);
    const hem = inked(new THREE.CylinderGeometry(0.152, 0.152, 0.03, 14), trim, 1.5);
    hem.position.y = -0.245;
    hip.add(hem);
    const knee = joint(`knee${side}`, hip, 0, -THIGH, 0);
    const shin = inked(capsule(0.072, SHIN), skin);
    shin.position.y = -SHIN / 2;
    knee.add(shin);
    const sock = inked(new THREE.CylinderGeometry(0.06, 0.055, 0.2, 12), toon(SOCK), 2);
    sock.position.y = -SHIN + 0.1;
    knee.add(sock);
    const ankle = joint(`ankle${side}`, knee, 0, -SHIN, 0);
    const shoeGeo = new THREE.BoxGeometry(0.13, 0.1, 0.3, 2, 1, 2);
    roundBox(shoeGeo, 0.04);
    const shoe = inked(shoeGeo, toon(SHOE), 2.5);
    shoe.position.set(0, -0.03, 0.06);
    ankle.add(shoe);
    const sole = inked(new THREE.BoxGeometry(0.135, 0.03, 0.31), toon(0xf4efe4), 1.5);
    sole.position.set(0, -0.085, 0.06);
    ankle.add(sole);
  };
  leg("L");
  leg("R");

  poseAthleticStance(j);

  // Plant the soles on the floor (y = 0) for the posed stance.
  root.scale.setScalar(PLAYER_SCALE);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const baseHipY = hips.position.y;
  hips.position.y -= box.min.y / PLAYER_SCALE;

  return {
    root,
    joints: j,
    update(elapsed: number) {
      // Breathing bob: knees flex a touch, chest rises.
      const bob = Math.sin(elapsed * 2.4) * 0.012;
      hips.position.y = baseHipY - box.min.y / PLAYER_SCALE + bob;
      j.kneeL.rotation.x = STANCE.knee - bob * 2;
      j.kneeR.rotation.x = STANCE.knee - bob * 2;
      j.hipL.rotation.x = STANCE.hip + bob;
      j.hipR.rotation.x = STANCE.hipR + bob;
    },
  };
}

const STANCE = { hip: -0.62, hipR: -0.42, knee: 0.95 };

/** Low triple-threat/ready-to-dribble stance, ball held in the right hand. */
function poseAthleticStance(j: Record<JointName, THREE.Group>) {
  // Feet a bit wider than shoulders, left foot slightly forward.
  j.hipL.rotation.set(STANCE.hip, 0, 0.12);
  j.hipR.rotation.set(STANCE.hipR, 0, -0.14);
  j.kneeL.rotation.x = STANCE.knee;
  j.kneeR.rotation.x = STANCE.knee;
  j.ankleL.rotation.x = -0.32;
  j.ankleR.rotation.x = -0.52;
  j.ankleL.rotation.z = -0.1;
  j.ankleR.rotation.z = 0.12;

  // Lean the torso forward over the knees.
  j.spine.rotation.x = 0.28;
  j.chest.rotation.x = 0.12;
  j.neck.rotation.x = -0.25;
  j.head.rotation.x = -0.12;

  // Right arm: elbow back, forearm forward, hand over the ball at hip height.
  j.shoulderR.rotation.set(-0.2, 0, -0.32);
  j.elbowR.rotation.set(-1.0, 0.0, 0.12);
  j.handR.rotation.x = -0.3;
  // Left arm: off-hand out for protection.
  j.shoulderL.rotation.set(-0.45, 0, 0.55);
  j.elbowL.rotation.set(-0.85, 0, -0.2);
  j.handL.rotation.x = -0.2;
}

/** Ball resting under the player's right palm, in world space. */
export function heldBallPosition(player: Player, out: THREE.Vector3): THREE.Vector3 {
  const palm = player.joints.handR.getObjectByName("palmR")!;
  palm.updateWorldMatrix(true, false);
  palm.getWorldPosition(out);
  out.y -= BALL_RADIUS * 0.95;
  return out;
}

function capsule(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 6, 12);
}

/** Pushes a subdivided box's vertices toward a rounded shape. */
function roundBox(geo: THREE.BoxGeometry, r: number) {
  const pos = geo.getAttribute("position");
  const { width, height, depth } = geo.parameters;
  const half = new THREE.Vector3(width / 2 - r, height / 2 - r, depth / 2 - r);
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      THREE.MathUtils.clamp(v.x, -half.x, half.x),
      THREE.MathUtils.clamp(v.y, -half.y, half.y),
      THREE.MathUtils.clamp(v.z, -half.z, half.z),
    );
    v.sub(c).normalize().multiplyScalar(r).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

function addHair(head: THREE.Group) {
  const hairMat = toon(HAIR);
  const cap = inked(new THREE.SphereGeometry(0.122, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 2);
  cap.position.set(0, 0.115, -0.008);
  cap.scale.set(0.95, 1.05, 1.02);
  head.add(cap);
  // Spikes fanning up and back — the Sakuragi silhouette.
  const spikes: [number, number, number, number][] = [
    // [yaw, pitch(back tilt), length, radius]
    [0, -0.15, 0.2, 0.05],
    [0.55, -0.05, 0.18, 0.045],
    [-0.55, -0.05, 0.18, 0.045],
    [1.15, 0.2, 0.16, 0.042],
    [-1.15, 0.2, 0.16, 0.042],
    [1.75, 0.45, 0.14, 0.04],
    [-1.75, 0.45, 0.14, 0.04],
    [2.4, 0.75, 0.15, 0.042],
    [-2.4, 0.75, 0.15, 0.042],
    [Math.PI, 0.85, 0.16, 0.045],
    [0.25, -0.55, 0.15, 0.04],
    [-0.25, -0.55, 0.15, 0.04],
  ];
  for (const [yaw, pitch, len, rad] of spikes) {
    const geo = new THREE.ConeGeometry(rad * 1.25, len * 1.5, 6);
    geo.translate(0, (len * 1.5) / 2, 0);
    const spike = inked(geo, hairMat, 2);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.17, 0);
    pivot.rotation.set(0, yaw, 0);
    spike.rotation.x = -(0.45 + pitch); // tilt away from the face (−Z is back)
    spike.position.z = -0.02;
    pivot.add(spike);
    head.add(pivot);
  }
}

function addFace(head: THREE.Group) {
  const ink = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.01), ink);
    brow.position.set(sx * 0.04, 0.135, 0.108);
    brow.rotation.z = sx * -0.35;
    head.add(brow);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.01), ink);
    eye.position.set(sx * 0.04, 0.11, 0.111);
    head.add(eye);
    const ear = inked(new THREE.SphereGeometry(0.026, 8, 6), toon(SKIN), 1.5);
    ear.position.set(sx * 0.105, 0.1, 0);
    head.add(ear);
  }
}

function jerseyTexture(fonts: GameFonts): THREE.CanvasTexture {
  // Wraps the torso cylinder: u = 0 is the front (+Z), u = 0.5 the back (−Z).
  return drawnTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = "#" + JERSEY.toString(16).padStart(6, "0");
    ctx.fillRect(0, 0, w, h);
    // Side panels + neck/arm trim.
    ctx.fillStyle = "#" + JERSEY_TRIM.toString(16).padStart(6, "0");
    for (const x of [w * 0.25, w * 0.75]) ctx.fillRect(x - 10, 0, 20, h);
    ctx.fillRect(0, 0, w, 14);
    ctx.fillRect(0, h - 18, w, 18);

    const drawText = (text: string, x: number, y: number, size: number, stretch = 1) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, stretch);
      ctx.font = `${size}px ${fonts.display}, Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.12;
      ctx.strokeStyle = "#1a1410";
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = "#fbf6ea";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    // Back: name + big number.
    drawText("KAZE", w * 0.5, h * 0.2, 70);
    drawText("10", w * 0.5, h * 0.55, 210, 1.1);
    // Front number straddles the u = 0 / 1 seam.
    drawText("10", 0, h * 0.42, 130);
    drawText("10", w, h * 0.42, 130);
  });
}
