import * as THREE from 'three';

const VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // aSize is a world-space radius; uScale converts it to pixels at 1 m.
    gl_PointSize = clamp(aSize * uScale / max(0.6, -mv.z), 1.0, 260.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = vAlpha * smoothstep(0.25, 0.02, r);
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

/** Soft round billboards with per-particle size, colour and fade. */
export class ParticleSystem {
  constructor(scene, capacity, opts = {}) {
    this.capacity = capacity;
    this.count = 0;

    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 520 } },
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);

    this.gravity = opts.gravity ?? -9.0;
    this.drag = opts.drag ?? 1.6;
    this.wind = opts.wind ?? new THREE.Vector3(0, 0, 0);
  }

  spawn(x, y, z, vx, vy, vz, life, size, color, growth = 1.0) {
    let i;
    if (this.count < this.capacity) {
      i = this.count++;
    } else {
      // Recycle the oldest-looking slot rather than dropping the emission.
      i = (Math.random() * this.capacity) | 0;
    }
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.growth[i] = growth;
    this.alpha[i] = 1;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, size, growth } = this;
    const dragK = Math.max(0, 1 - this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // Swap-remove so the live particles stay packed at the front.
        const last = --this.count;
        if (i !== last) {
          const a = i * 3;
          const b = last * 3;
          for (let k = 0; k < 3; k++) {
            pos[a + k] = pos[b + k];
            vel[a + k] = vel[b + k];
            this.col[a + k] = this.col[b + k];
          }
          life[i] = life[last];
          maxLife[i] = maxLife[last];
          size[i] = size[last];
          growth[i] = growth[last];
          alpha[i] = alpha[last];
        }
        i--;
        continue;
      }
      const i3 = i * 3;
      vel[i3] = vel[i3] * dragK + this.wind.x * dt;
      vel[i3 + 1] = vel[i3 + 1] * dragK + (this.gravity + this.wind.y) * dt;
      vel[i3 + 2] = vel[i3 + 2] * dragK + this.wind.z * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      const t = life[i] / maxLife[i];
      alpha[i] = t * t * 0.9;
      size[i] *= 1 + (growth[i] - 1) * dt;
    }

    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }
}

const SPRAY_COLOR = new THREE.Color(0xffffff);
const SMOKE_COLOR = new THREE.Color(0xeef4fa);

export class Effects {
  constructor(scene) {
    this.spray = new ParticleSystem(scene, 1200, { gravity: -11, drag: 2.4 });
    this.smoke = new ParticleSystem(scene, 420, {
      gravity: 0.55,
      drag: 0.35,
      wind: new THREE.Vector3(1.1, 0, 0.4),
    });
    this._carry = 0;
    this._smokeCarry = 0;
    this._p = new THREE.Vector3();
  }

  /** Rooster tail thrown off the carving edge. */
  emitCarve(rider, dt) {
    if (!rider.grounded || rider.speed < 3.5) {
      this._carry = 0;
      return;
    }
    const bite = Math.abs(rider.carve);
    const intensity = (0.08 + bite * 1.1) * (rider.speed / 16);
    const rate = intensity * 90;
    this._carry += rate * dt;
    let n = Math.floor(this._carry);
    if (n <= 0) return;
    this._carry -= n;
    n = Math.min(n, 26);

    rider.edgePoint(this._p);
    const dirX = Math.sin(rider.yaw);
    const dirZ = Math.cos(rider.yaw);
    // Push snow out to the outside of the turn.
    const sideX = dirZ * -Math.sign(rider.carve || 1);
    const sideZ = -dirX * -Math.sign(rider.carve || 1);
    const sp = rider.speed;

    for (let i = 0; i < n; i++) {
      const jx = (Math.random() - 0.5) * 0.5;
      const jz = (Math.random() - 0.5) * 0.5;
      const kick = 0.5 + Math.random() * 1.4;
      this.spray.spawn(
        this._p.x + jx,
        this._p.y + Math.random() * 0.12,
        this._p.z + jz,
        -dirX * sp * 0.1 + sideX * kick * (0.9 + bite * 3.4) + (Math.random() - 0.5) * 1.2,
        0.5 + Math.random() * 1.3 * (0.3 + bite),
        -dirZ * sp * 0.1 + sideZ * kick * (0.9 + bite * 3.4) + (Math.random() - 0.5) * 1.2,
        0.34 + Math.random() * 0.4,
        0.11 + Math.random() * 0.17,
        SPRAY_COLOR,
        2.4
      );
    }
  }

  burst(x, y, z, amount, power = 1) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.4 * power;
      this.spray.spawn(
        x + Math.cos(a) * 0.3,
        y + Math.random() * 0.2,
        z + Math.sin(a) * 0.3,
        Math.cos(a) * r,
        1.5 + Math.random() * 3.2 * power,
        Math.sin(a) * r,
        0.5 + Math.random() * 0.7,
        0.22 + Math.random() * 0.3,
        SPRAY_COLOR,
        2.2
      );
    }
  }

  emitSmoke(chimneys, dt) {
    this._smokeCarry += chimneys.length * 7 * dt;
    let n = Math.floor(this._smokeCarry);
    if (n <= 0) return;
    this._smokeCarry -= n;
    n = Math.min(n, 24);
    for (let i = 0; i < n; i++) {
      const c = chimneys[(Math.random() * chimneys.length) | 0];
      if (!c) return;
      this.smoke.spawn(
        c.x + (Math.random() - 0.5) * 0.3,
        c.y + Math.random() * 0.2,
        c.z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.4,
        1.4 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.4,
        3.4 + Math.random() * 2.6,
        0.55 + Math.random() * 0.5,
        SMOKE_COLOR,
        1.5
      );
    }
  }

  update(dt) {
    this.spray.update(dt);
    this.smoke.update(dt);
  }
}
