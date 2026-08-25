import * as THREE from 'three';
import { CHUNK, PALETTE, SLOPE } from './config.js';
import { fbm, hash2 } from './noise.js';

const GRADE = SLOPE.grade;
const HALF_W = SLOPE.halfWidth;
const KICKER_SPACING = 64;

// --- Height field -----------------------------------------------------------
// The piste meanders down the valley; everything else is derived from this
// centreline so the terrain, the corduroy shader and scenery placement agree.

// Amplitudes are chosen so the centreline never drifts sideways faster than
// about 0.15 m per metre of descent — gentle enough to hold a line through.
export function pisteCenter(z) {
  return (
    20 * Math.sin(z * 0.0028) +
    7 * Math.sin(z * 0.0075 + 1.7) +
    2.5 * Math.sin(z * 0.017 + 0.6)
  );
}

// Smooth bump over a normalised radius: 1 at the centre, 0 (with zero slope) at
// the rim. Taking the radius rather than its square keeps real curvature at the
// crest — a squared argument gives a quartic-flat top that never launches.
function bump(rho) {
  if (rho >= 1) return 0;
  const c = Math.cos(rho * Math.PI * 0.5);
  return c * c;
}

// Kickers sit on the piste at pseudo-random intervals. They are part of the
// height field, so launching off one falls out of the normal physics.
function kickers(x, z) {
  const k = Math.round(z / KICKER_SPACING);
  let sum = 0;
  for (let i = k - 1; i <= k + 1; i++) {
    if (hash2(i * 7.31, 11.9) < 0.25) continue;
    const zc = i * KICKER_SPACING + (hash2(i * 1.7, 3.1) - 0.5) * 26;
    const dz = (z - zc) / 9;
    if (dz * dz >= 1) continue;
    const xc = pisteCenter(zc) + (hash2(i * 2.9, 9.7) - 0.5) * 16;
    const dx = (x - xc) / 11;
    const rho = Math.sqrt(dz * dz + dx * dx);
    if (rho >= 1) continue;
    sum += (1.6 + hash2(i * 4.2, 5.5) * 1.6) * bump(rho);
  }
  return sum;
}

export function terrainHeight(x, z) {
  const c = pisteCenter(z);
  const d = x - c;
  const ad = Math.abs(d);

  // Fall line plus long, lazy rollers.
  let y = -z * GRADE;
  y +=
    3.4 * Math.sin(z * 0.0176) +
    1.8 * Math.sin(z * 0.0391 + 2.3) +
    1.0 * Math.sin(z * 0.098 + 0.7);

  // Gentle cross-slope camber so the piste banks into its turns.
  y += 0.6 * Math.sin(z * 0.0083 + 1.1) * (d / HALF_W);

  y += kickers(x, z);

  // Valley sides climb away from the groomed corridor.
  const t = Math.max(0, ad - HALF_W) / 30;
  if (t > 0) {
    const t2 = t * t;
    y += SLOPE.bankHeight * (1 - 1 / (1 + 0.55 * t2)) + 2.5 * t;
    // Ungroomed snow gets lumpy the further out you go.
    const rough = Math.min(1, t * 2.2);
    y += fbm(x * 0.035, z * 0.035, 3) * 2.6 * rough;
    y += fbm(x * 0.14 + 20, z * 0.14, 2) * 0.5 * rough;
  }
  return y;
}

export function terrainNormal(x, z, out = new THREE.Vector3()) {
  const e = 0.4;
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

// --- Corduroy material ------------------------------------------------------

const PISTE_CENTER_GLSL = `
float pisteCenterGL(float z) {
  return 20.0 * sin(z * 0.0028) + 7.0 * sin(z * 0.0075 + 1.7) + 2.5 * sin(z * 0.017 + 0.6);
}
`;

function makeSnowMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.snowLit });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHalfWidth = { value: HALF_W };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos;
         varying vec3 vViewRight;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vViewRight = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uHalfWidth;
         varying vec3 vWorldPos;
         varying vec3 vViewRight;
         ${PISTE_CENTER_GLSL}`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           float d = vWorldPos.x - pisteCenterGL(vWorldPos.z);
           float onPiste = 1.0 - smoothstep(uHalfWidth - 4.0, uHalfWidth + 6.0, abs(d));

           // Corduroy ribs run down the fall line; fade them out once a rib is
           // narrower than a pixel so distant snow stays smooth instead of moiring.
           float phase = d / 0.38;
           float aa = 1.0 - smoothstep(0.22, 0.55, fwidth(phase));
           float rib = sin(phase * 6.2831853);
           float pass = sin(d * 0.2380952 * 6.2831853);
           float amt = onPiste * aa;

           normal = normalize(normal + vViewRight * (rib * 0.22 * amt));
           diffuseColor.rgb *= 1.0 + rib * 0.03 * amt + pass * 0.014 * onPiste;

           // Untouched snow off the corridor: soft wind-drift mottling.
           float off = 1.0 - onPiste;
           float drift = sin(vWorldPos.x * 0.31 + vWorldPos.z * 0.11) * sin(vWorldPos.z * 0.27);
           diffuseColor.rgb *= 1.0 + off * drift * 0.022;
         }`
      );
  };
  // Distinguish this program from other Lambert materials in three's cache.
  mat.customProgramCacheKey = () => 'corduroy-snow';
  return mat;
}

// --- Chunked terrain --------------------------------------------------------

// Column positions are packed towards the middle: the piste needs fine detail,
// the far valley walls do not.
function buildColumns() {
  const xs = new Float32Array(CHUNK.cols + 1);
  for (let i = 0; i <= CHUNK.cols; i++) {
    const u = (i / CHUNK.cols) * 2 - 1;
    const a = Math.abs(u);
    xs[i] = Math.sign(u) * (45 * a + (CHUNK.halfSpan - 45) * a * a * a);
  }
  return xs;
}

class Chunk {
  constructor(columns, material) {
    this.columns = columns;
    this.z0 = 0;

    const cols = CHUNK.cols + 1;
    const rows = CHUNK.rows + 1;
    const count = cols * rows;
    const geo = new THREE.BufferGeometry();
    this.position = new Float32Array(count * 3);
    this.normal = new Float32Array(count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3));

    const indices = new Uint32Array(CHUNK.cols * CHUNK.rows * 6);
    let p = 0;
    for (let r = 0; r < CHUNK.rows; r++) {
      for (let c = 0; c < CHUNK.cols; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        indices[p++] = a; indices[p++] = d; indices[p++] = b;
        indices[p++] = b; indices[p++] = d; indices[p++] = e;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  rebuild(z0) {
    this.z0 = z0;
    const cols = CHUNK.cols + 1;
    const dz = CHUNK.length / CHUNK.rows;
    const pos = this.position;
    const nrm = this.normal;
    const n = new THREE.Vector3();
    let i = 0;
    for (let r = 0; r <= CHUNK.rows; r++) {
      const lz = r * dz;
      const wz = z0 + lz;
      for (let c = 0; c < cols; c++) {
        const x = this.columns[c];
        pos[i] = x;
        pos[i + 1] = terrainHeight(x, wz);
        pos[i + 2] = lz;
        terrainNormal(x, wz, n);
        nrm[i] = n.x;
        nrm[i + 1] = n.y;
        nrm[i + 2] = n.z;
        i += 3;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
    this.mesh.position.set(0, 0, z0);
    this.mesh.updateMatrix();
  }
}

export class Terrain {
  constructor(scene) {
    this.material = makeSnowMaterial();
    this.columns = buildColumns();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.chunks = [];
    for (let i = 0; i < CHUNK.count; i++) {
      const chunk = new Chunk(this.columns, this.material);
      this.chunks.push(chunk);
      this.group.add(chunk.mesh);
    }
    this.baseIndex = -Infinity;
    this.onRebuild = null;
    this.reset();
  }

  reset() {
    this.baseIndex = -CHUNK.behind;
    for (let i = 0; i < this.chunks.length; i++) {
      const index = this.baseIndex + i;
      this.chunks[i].rebuild(index * CHUNK.length);
      if (this.onRebuild) this.onRebuild(this.chunks[i], index);
    }
  }

  /** Recycles chunks that fall behind the rider. */
  update(riderZ) {
    const wanted = Math.floor(riderZ / CHUNK.length) - CHUNK.behind;
    if (wanted === this.baseIndex) return;
    if (Math.abs(wanted - this.baseIndex) >= CHUNK.count) {
      this.baseIndex = wanted;
      for (let i = 0; i < this.chunks.length; i++) {
        const index = wanted + i;
        this.chunks[i].rebuild(index * CHUNK.length);
        if (this.onRebuild) this.onRebuild(this.chunks[i], index);
      }
      return;
    }
    while (this.baseIndex < wanted) {
      const chunk = this.chunks.shift();
      const index = this.baseIndex + CHUNK.count;
      chunk.rebuild(index * CHUNK.length);
      if (this.onRebuild) this.onRebuild(chunk, index);
      this.chunks.push(chunk);
      this.baseIndex++;
    }
  }
}
