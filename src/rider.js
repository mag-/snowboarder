import * as THREE from 'three';
import { PALETTE, PHYSICS } from './config.js';
import { paint, mergeGeos } from './geoutil.js';
import { pisteCenter, terrainHeight, terrainNormal } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

// --- Character rig ----------------------------------------------------------

function boardGeometry() {
  const parts = [];
  const deck = new THREE.BoxGeometry(0.30, 0.055, 1.34);
  parts.push(paint(deck, PALETTE.board));

  // Nose and tail kick.
  for (const dir of [-1, 1]) {
    const tip = new THREE.BoxGeometry(0.28, 0.05, 0.26);
    tip.translate(0, 0.035, dir * 0.78);
    tip.rotateX(dir * -0.35);
    parts.push(paint(tip, PALETTE.board));
  }
  const stripe = new THREE.BoxGeometry(0.10, 0.012, 1.28);
  stripe.translate(0, 0.032, 0);
  parts.push(paint(stripe, 0xf3f7fb));

  for (const dir of [-1, 1]) {
    const binding = new THREE.BoxGeometry(0.24, 0.09, 0.24);
    binding.translate(0, 0.07, dir * 0.28);
    parts.push(paint(binding, 0x1d2536));
  }
  return mergeGeos(parts);
}

function bootGeometry() {
  const boot = new THREE.BoxGeometry(0.20, 0.20, 0.28);
  return paint(boot, 0x222b3d);
}

function limbGeometry(radius, length, color) {
  const g = new THREE.CapsuleGeometry(radius, length, 3, 8);
  return paint(g, color);
}

function torsoGeometry() {
  const parts = [];
  const body = new THREE.CapsuleGeometry(0.195, 0.40, 4, 10);
  body.scale(1, 1, 0.82);
  parts.push(paint(body, PALETTE.jacket));

  // Colour-blocked panel across the chest, like the reference jacket.
  const panel = new THREE.CapsuleGeometry(0.198, 0.10, 4, 10);
  panel.scale(1, 1, 0.83);
  panel.translate(0, -0.14, 0);
  parts.push(paint(panel, PALETTE.jacketAlt));

  const hips = new THREE.CapsuleGeometry(0.175, 0.10, 3, 9);
  hips.scale(1, 1, 0.85);
  hips.translate(0, -0.34, 0);
  parts.push(paint(hips, PALETTE.pants));
  return mergeGeos(parts);
}

function headGeometry() {
  const parts = [];
  const head = new THREE.SphereGeometry(0.135, 12, 10);
  parts.push(paint(head, PALETTE.skin));

  const gaiter = new THREE.CylinderGeometry(0.115, 0.125, 0.13, 10);
  gaiter.translate(0, -0.11, 0);
  parts.push(paint(gaiter, PALETTE.beanieStripe));

  // Striped beanie: alternating bands stacked up the skull.
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const y0 = -0.03 + t0 * 0.19;
    const y1 = -0.03 + t1 * 0.19;
    const r0 = 0.147 * Math.sqrt(Math.max(0.06, 1 - Math.pow(y0 / 0.175, 2)));
    const r1 = 0.147 * Math.sqrt(Math.max(0.06, 1 - Math.pow(y1 / 0.175, 2)));
    const band = new THREE.CylinderGeometry(r1, r0, y1 - y0, 12, 1, true);
    band.translate(0, (y0 + y1) * 0.5, 0);
    parts.push(paint(band, i % 2 === 0 ? PALETTE.beanie : PALETTE.beanieStripe));
  }
  const crown = new THREE.SphereGeometry(0.062, 10, 7);
  crown.translate(0, 0.155, 0);
  parts.push(paint(crown, PALETTE.beanie));

  const brim = new THREE.CylinderGeometry(0.152, 0.152, 0.055, 12);
  brim.translate(0, -0.035, 0);
  parts.push(paint(brim, PALETTE.beanie));

  const pom = new THREE.SphereGeometry(0.055, 9, 7);
  pom.translate(0, 0.215, 0);
  parts.push(paint(pom, PALETTE.pom));
  return mergeGeos(parts);
}

// --- Rider ------------------------------------------------------------------

export class Rider {
  constructor(scene) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material = mat;

    this.root = new THREE.Group();
    this.lean = new THREE.Group();       // rolls into the turn
    this.root.add(this.lean);

    this.board = new THREE.Mesh(boardGeometry(), mat);
    this.board.castShadow = true;
    this.lean.add(this.board);

    this.feet = [];
    for (const dir of [-1, 1]) {
      const boot = new THREE.Mesh(bootGeometry(), mat);
      boot.position.set(0, 0.16, dir * 0.28);
      boot.castShadow = true;
      this.lean.add(boot);
      this.feet.push(boot);
    }

    this.body = new THREE.Group();      // stance rotation + crouch
    this.lean.add(this.body);

    this.legs = [];
    for (let i = 0; i < 2; i++) {
      const leg = new THREE.Mesh(limbGeometry(0.105, 0.42, PALETTE.pants), mat);
      leg.castShadow = true;
      this.lean.add(leg);               // legs live in board space for the IK
      this.legs.push(leg);
    }

    this.torso = new THREE.Mesh(torsoGeometry(), mat);
    this.torso.castShadow = true;
    this.body.add(this.torso);

    this.arms = [];
    for (const dir of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(dir * 0.19, 0.2, 0);
      const arm = new THREE.Mesh(limbGeometry(0.072, 0.34, PALETTE.jacketAlt), mat);
      arm.position.y = -0.26;
      arm.castShadow = true;
      const glove = new THREE.Mesh(limbGeometry(0.075, 0.03, 0x1d2536), mat);
      glove.position.y = -0.49;
      pivot.add(arm, glove);
      this.body.add(pivot);
      this.arms.push(pivot);
    }

    this.head = new THREE.Mesh(headGeometry(), mat);
    this.head.position.y = 0.44;
    this.head.castShadow = true;
    this.body.add(this.head);

    scene.add(this.root);

    // Soft contact shadow that keeps the rider anchored on flat light.
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 20),
      new THREE.MeshBasicMaterial({
        color: 0x2f4f74,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      })
    );
    this.blob.rotation.x = -Math.PI / 2;
    scene.add(this.blob);

    this._n = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._hip = new THREE.Vector3();
    this._foot = new THREE.Vector3();

    this.reset();
  }

  reset() {
    this.pos = new THREE.Vector3(0, 0, 0);
    this.pos.y = terrainHeight(0, 0);
    this.yaw = 0;
    this.speed = 6;
    this.vy = 0;
    this.grounded = true;
    this.airVel = new THREE.Vector2(0, 0);
    this.carve = 0;
    this.crouch = 0;
    this.spinAccum = 0;
    this.airTime = 0;
    this.wipeTimer = 0;
    this.tumble = 0;
    this.landImpact = 0;
    this.grabbing = false;
    this.distance = 0;
    this.topSpeed = 0;
    this.bob = 0;
    this.stuckTimer = 0;
    this.spinRamp = 0;
  }

  /** Drops the rider back onto the corridor after a stall or a trip into the woods. */
  rescue() {
    const z = this.pos.z + 8;
    const x = pisteCenter(z);
    this.pos.set(x, terrainHeight(x, z), z);
    this.yaw = 0;
    this.speed = 9;
    this.vy = 0;
    this.grounded = true;
    this.airVel.set(0, 9);
    this.wipeTimer = 0;
    this.tumble = 0;
    this.stuckTimer = 0;
    this.carve = 0;
    this.spinAccum = 0;
  }

  /** Signed distance from the groomed corridor's centreline. */
  get pisteOffset() {
    return this.pos.x - pisteCenter(this.pos.z);
  }

  /** True once the rider has been bogged down or lost in the trees for too long. */
  get needsRescue() {
    return this.stuckTimer > 2.6 || Math.abs(this.pisteOffset) > 125;
  }

  get wiping() {
    return this.wipeTimer > 0;
  }

  wipeout() {
    if (this.wiping) return false;
    this.wipeTimer = 1.1;
    this.speed *= 0.45;
    this.spinAccum = 0;
    this.grounded = true;
    return true;
  }

  update(dt, input, events) {
    const P = PHYSICS;
    const prevGroundY = terrainHeight(this.pos.x, this.pos.z);

    if (this.wiping) {
      this.wipeTimer -= dt;
      this.tumble += dt * 9;
      this.speed = Math.max(2.5, this.speed - 9 * dt);
      this.carve *= 0.9;
    } else {
      this.tumble *= Math.max(0, 1 - dt * 5);
      const steer = input.steer;
      const blend = Math.min(1, dt * 9);
      this.carve += (steer - this.carve) * blend;
    }

    // --- Steering / spin ---
    if (this.grounded) {
      const grip = Math.min(1, Math.max(0.25, this.speed / 11));
      this.yaw += this.carve * P.turnRate * grip * dt;
      this.spinRamp = 0;
      // On the snow the board never swings far past the fall line.
      this.yaw = Math.max(-0.62, Math.min(0.62, this.yaw));
    } else {
      this.airTime += dt;
      if (Math.abs(this.carve) > 0.15) {
        // Ramp the spin in: a stray nudge barely turns the board, a committed
        // hold winds up into a real rotation.
        this.spinRamp = Math.min(1, this.spinRamp + dt / 0.35);
        const spin = this.carve * P.spinRate * this.spinRamp * dt;
        this.yaw += spin;
        this.spinAccum += spin;
      } else {
        this.spinRamp = 0;
        // Hands off in the air: the board drifts back in line with the flight
        // path, so a stray nudge over a roller does not end the run.
        const travel = Math.atan2(this.airVel.x, this.airVel.y);
        let off = this.yaw - travel;
        while (off > Math.PI) off -= TAU;
        while (off < -Math.PI) off += TAU;
        const settle = off * Math.min(1, dt * 5.5);
        this.yaw -= settle;
        this.spinAccum -= settle;
      }
    }

    // --- Speed along the fall line ---
    terrainNormal(this.pos.x, this.pos.z, this._n);
    const dirX = Math.sin(this.yaw);
    const dirZ = Math.cos(this.yaw);
    if (this.grounded) {
      // Normal is (-dh/dx, 1, -dh/dz), so this is the downhill gradient along the heading.
      const along = (this._n.x * dirX + this._n.z * dirZ) / Math.max(0.2, this._n.y);
      const drag = (input.tuck && !this.wiping ? P.tuckDrag : P.baseDrag) * this.speed * this.speed;
      const edge = P.edgeFriction * Math.abs(this.carve) * this.speed * 0.16;
      const flat = (input.tuck ? P.flatFriction * 0.7 : P.flatFriction) * this.speed;
      const wipeDrag = this.wiping ? this.speed * 0.9 : 0;
      this.speed += (P.gravity * along - drag - edge - flat - wipeDrag) * dt;
      // Skating: a rider who has run out of pitch pushes themselves along.
      if (!this.wiping && this.speed < 5) this.speed += 6 * dt;
      this.speed = Math.max(0, Math.min(P.maxSpeed, this.speed));
      this.stuckTimer = this.speed < 3 ? this.stuckTimer + dt : 0;
      this.airVel.set(dirX * this.speed, dirZ * this.speed);
    }

    // --- Integrate position ---
    this.pos.x += this.airVel.x * dt;
    this.pos.z += this.airVel.y * dt;

    // --- Vertical ---
    if (input.jump && this.grounded && !this.wiping) {
      this.vy += P.ollie;
      this.grounded = false;
      this.airTime = 0;
      this.spinAccum = 0;
      events.push({ type: 'ollie' });
    }
    this.vy -= P.gravity * dt;
    this.pos.y += this.vy * dt;

    const groundY = terrainHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= groundY) {
      const wasAir = !this.grounded;
      this.pos.y = groundY;
      this.grounded = true;
      // Follow the ground instead of bouncing down every roller.
      this.vy = Math.max(-24, (groundY - prevGroundY) / Math.max(dt, 1e-4));

      if (wasAir) this._land(events);
    } else {
      this.grounded = false;
    }

    // --- Airborne grabs ---
    this.grabbing = !this.grounded && input.grab && !this.wiping;

    this.distance += this.speed * dt;
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    this.landImpact = Math.max(0, this.landImpact - dt * 3.2);

    this._animate(dt, input);
  }

  _land(events) {
    const airTime = this.airTime;
    this.airTime = 0;
    if (airTime < 0.22) return;

    // Landing cleanly means pointing roughly where you are travelling.
    const travel = Math.atan2(this.airVel.x, this.airVel.y);
    let off = this.yaw - travel;
    while (off > Math.PI) off -= TAU;
    while (off < -Math.PI) off += TAU;

    const spins = Math.abs(this.spinAccum) / TAU;
    this.landImpact = 1;

    // Only landing close to sideways actually bites.
    const limit = airTime < 0.5 ? 1.9 : 1.7;
    if (Math.abs(off) > limit) {
      this.wipeout();
      events.push({ type: 'crash', reason: 'landing', off, airTime, spins });
      return;
    }
    // Bleed some speed for a sloppy landing, then realign the board.
    const cleanliness = 1 - Math.abs(off) / limit;
    this.yaw = travel + off; // unwind any completed rotations
    this.speed *= 0.82 + 0.18 * cleanliness;
    this.airVel.set(Math.sin(this.yaw) * this.speed, Math.cos(this.yaw) * this.speed);

    events.push({
      type: 'land',
      airTime,
      spins,
      spinDir: Math.sign(this.spinAccum),
      cleanliness,
      grabbed: this.grabbing,
    });
    this.spinAccum = 0;
  }

  _animate(dt, input) {
    // Orient the board to the terrain, then yaw it along the heading.
    terrainNormal(this.pos.x, this.pos.z, this._n);
    const surface = this.grounded ? this._n : UP;
    this._q.setFromUnitVectors(UP, surface);
    this._q2.setFromAxisAngle(surface, this.yaw);
    this.root.quaternion.copy(this._q2).multiply(this._q);
    this.root.position.copy(this.pos);

    // Lean into the carve; airborne the rider levels out.
    const targetLean = this.wiping
      ? 0
      : (this.grounded ? -this.carve * 0.62 : -this.carve * 0.22);
    this.lean.rotation.z += (targetLean - this.lean.rotation.z) * Math.min(1, dt * 8);

    if (this.wiping) {
      this.lean.rotation.x = Math.sin(this.tumble) * 0.9;
      this.lean.rotation.y = this.tumble * 0.6;
    } else {
      this.lean.rotation.y += (0 - this.lean.rotation.y) * Math.min(1, dt * 6);
      this.lean.rotation.x += (0 - this.lean.rotation.x) * Math.min(1, dt * 6);
    }

    // Crouch: tuck input, landing compression, and a little speed-scaled squat.
    const speedSquat = Math.min(0.16, this.speed * 0.006);
    const target =
      (input.tuck ? 0.30 : 0) +
      this.landImpact * 0.24 +
      speedSquat +
      Math.abs(this.carve) * 0.08 +
      (this.grabbing ? 0.22 : 0);
    this.crouch += (target - this.crouch) * Math.min(1, dt * 11);

    this.bob += dt * (4 + this.speed * 0.28);
    const bobY = this.grounded ? Math.sin(this.bob) * 0.012 : 0;

    const hipY = 0.94 - this.crouch + bobY;
    this.body.position.set(0, hipY, 0);
    // Regular stance: shoulders open across the board, counter-rotating in turns.
    this.body.rotation.y = 1.02 - this.carve * 0.34;
    this.body.rotation.x = (input.tuck ? 0.42 : 0.20) + this.crouch * 0.25;
    this.body.rotation.z = -this.carve * 0.12;

    // Two-bone-free leg IK: stretch a capsule from each boot to its hip.
    for (let i = 0; i < 2; i++) {
      const dir = i === 0 ? -1 : 1;
      const foot = this.feet[i];
      this._foot.set(foot.position.x, foot.position.y + 0.04, foot.position.z);
      this._hip
        .set(0, hipY, 0)
        .add(this._v.set(dir * 0.13, -0.30, 0).applyEuler(this.body.rotation));
      const leg = this.legs[i];
      this._v.subVectors(this._hip, this._foot);
      const len = Math.max(0.3, this._v.length());
      leg.position.copy(this._foot).addScaledVector(this._v, 0.5);
      leg.quaternion.setFromUnitVectors(UP, this._v.normalize());
      leg.scale.set(1, len / 0.63, 1);
    }

    // Arms: out for balance, tucked when charging, reaching down for grabs.
    const swing = this.carve * 0.5;
    const spread = this.grabbing ? 0.5 : (input.tuck ? 0.28 : 0.85 + Math.abs(this.carve) * 0.3);
    this.arms[0].rotation.z = spread + swing;
    this.arms[1].rotation.z = -spread + swing;
    this.arms[0].rotation.x = this.grabbing ? -1.1 : -0.25 - this.carve * 0.3;
    this.arms[1].rotation.x = this.grabbing ? -1.1 : -0.25 + this.carve * 0.3;

    this.head.rotation.y = -this.body.rotation.y * 0.75 + this.carve * 0.2;
    this.head.rotation.z = this.carve * 0.12;

    // Contact shadow.
    const groundY = terrainHeight(this.pos.x, this.pos.z);
    const air = Math.max(0, this.pos.y - groundY);
    this.blob.position.set(this.pos.x, groundY + 0.05, this.pos.z);
    this.blob.rotation.z = this.yaw;
    const grow = 1 + air * 0.09;
    this.blob.scale.set(grow * 0.85, grow, 1);
    this.blob.material.opacity = 0.18 / (1 + air * 0.16);
  }

  /** World-space point where the edge bites, for spray emission. */
  edgePoint(out) {
    return out.set(0, 0.02, -0.35).applyMatrix4(this.root.matrixWorld);
  }
}
