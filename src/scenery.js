import * as THREE from 'three';
import { CHUNK, PALETTE, SLOPE } from './config.js';
import { makeRng } from './noise.js';
import { facets, mergeGeos, paint } from './geoutil.js';
import { pisteCenter, terrainHeight, terrainNormal } from './terrain.js';

const CAP = { trees: 110, rocks: 16, cabins: 7, windows: 21, poles: 10 };

// --- Prop geometry ----------------------------------------------------------

function treeGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.17, 0.26, 1.7, 6);
  trunk.translate(0, 0.85, 0);
  parts.push(paint(trunk, PALETTE.trunk));

  const tiers = [
    { r: 1.55, h: 2.6, y: 1.75, c: PALETTE.treeDark },
    { r: 1.2, h: 2.3, y: 3.1, c: PALETTE.treeLight },
    { r: 0.85, h: 2.0, y: 4.35, c: PALETTE.treeLight },
  ];
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 8);
    cone.translate(0, t.y, 0);
    parts.push(paint(cone, t.c));

    // Snow lying on the upper half of each tier, poking proud of the green.
    const sh = t.h * 0.5;
    const snow = new THREE.ConeGeometry(t.r * 0.63, sh, 8);
    snow.translate(0, t.y + t.h * 0.5 - sh * 0.5, 0);
    parts.push(paint(snow, PALETTE.treeSnow));
  }
  return mergeGeos(parts);
}

function rockGeometry() {
  const rock = new THREE.DodecahedronGeometry(1, 0);
  rock.scale(1, 0.7, 1.1);
  rock.translate(0, 0.45, 0);
  const cap = new THREE.SphereGeometry(0.82, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, 0.5, 1);
  cap.translate(0, 0.82, 0);
  return mergeGeos([paint(rock, PALETTE.rock), paint(cap, PALETTE.treeSnow)]);
}

function cabinGeometry() {
  const parts = [];
  const walls = new THREE.BoxGeometry(4.2, 2.6, 5.0);
  walls.translate(0, 1.3, 0);
  parts.push(paint(walls, PALETTE.cabinWall));

  const base = new THREE.BoxGeometry(4.4, 0.4, 5.2);
  base.translate(0, 0.2, 0);
  parts.push(paint(base, PALETTE.cabinDark));

  // Gable roof: two snow-laden slabs leaning against a ridge.
  for (const dir of [-1, 1]) {
    const slab = new THREE.BoxGeometry(3.4, 0.42, 5.8);
    slab.translate(dir * 1.42, 3.35, 0);
    slab.rotateZ(dir * -0.62);
    const g = paint(slab, PALETTE.treeSnow);
    parts.push(g);
  }

  const chimney = new THREE.BoxGeometry(0.62, 1.7, 0.62);
  chimney.translate(1.1, 3.6, -1.3);
  parts.push(paint(chimney, PALETTE.cabinDark));
  const chimneyCap = new THREE.BoxGeometry(0.8, 0.22, 0.8);
  chimneyCap.translate(1.1, 4.5, -1.3);
  parts.push(paint(chimneyCap, PALETTE.treeSnow));

  return mergeGeos(parts);
}

function windowGeometry() {
  const g = new THREE.PlaneGeometry(0.8, 0.7);
  g.translate(0, 1.55, 2.52);
  return paint(g, PALETTE.cabinWindow);
}

function poleGeometry() {
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.09, 0.09, 2.4, 5);
  pole.translate(0, 1.2, 0);
  parts.push(paint(pole, 0xe2643c));
  const flag = new THREE.BoxGeometry(0.05, 0.5, 0.42);
  flag.translate(0, 2.1, 0.2);
  parts.push(paint(flag, 0xf2ede4));
  return mergeGeos(parts);
}

// --- Scenery manager --------------------------------------------------------

class ChunkProps {
  constructor(group, materials) {
    this.trees = new THREE.InstancedMesh(materials.tree, materials.propMat, CAP.trees);
    this.rocks = new THREE.InstancedMesh(materials.rock, materials.propMat, CAP.rocks);
    this.cabins = new THREE.InstancedMesh(materials.cabin, materials.propMat, CAP.cabins);
    this.windows = new THREE.InstancedMesh(materials.window, materials.windowMat, CAP.windows);
    this.poles = new THREE.InstancedMesh(materials.pole, materials.propMat, CAP.poles);

    for (const m of [this.trees, this.rocks, this.cabins, this.poles]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      group.add(m);
    }
    this.windows.frustumCulled = false;
    this.windows.count = 0;
    group.add(this.windows);

    /** Collidable props: {x, z, radius}. */
    this.obstacles = [];
    /** Chimney world positions for smoke. */
    this.chimneys = [];
  }
}

export class Scenery {
  constructor(scene) {
    const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const windowMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.materials = {
      propMat,
      windowMat,
      tree: treeGeometry(),
      rock: rockGeometry(),
      cabin: cabinGeometry(),
      window: windowGeometry(),
      pole: poleGeometry(),
    };

    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.pool = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._scl = new THREE.Vector3();
    this._color = new THREE.Color();
  }

  _acquire() {
    return this.pool.pop() || new ChunkProps(this.group, this.materials);
  }

  /** Places all props for one terrain chunk. Deterministic in `index`. */
  populate(chunkKey, index) {
    const existing = this.chunks.get(chunkKey);
    if (existing) this.pool.push(existing);
    const props = this._acquire();
    this.chunks.set(chunkKey, props);

    props.obstacles.length = 0;
    props.chimneys.length = 0;

    const rng = makeRng(index * 2654435761 + 12345);
    const z0 = index * CHUNK.length;
    const halfW = SLOPE.halfWidth;

    let nTrees = 0;
    let nRocks = 0;
    let nCabins = 0;
    let nWindows = 0;
    let nPoles = 0;

    // Trees: dense just off the corridor, thinning out up the valley sides.
    const attempts = 190;
    for (let i = 0; i < attempts && nTrees < CAP.trees; i++) {
      const z = z0 + rng() * CHUNK.length;
      const side = rng() < 0.5 ? -1 : 1;
      const bias = Math.pow(rng(), 1.8); // cluster near the piste edge
      // Keep a clear margin of untracked snow before the tree line starts.
      const d = side * (halfW + 9 + bias * 100);
      const x = pisteCenter(z) + d;
      if (rng() > 1.05 - bias * 0.55) continue;

      const y = terrainHeight(x, z);
      terrainNormal(x, z, this._n);
      if (this._n.y < 0.72) continue; // too steep to hold a tree

      const scale = 0.75 + rng() * 0.85;
      this._q.setFromUnitVectors(this._up, this._n.lerp(this._up, 0.55).normalize());
      this._q.multiply(
        new THREE.Quaternion().setFromAxisAngle(this._up, rng() * Math.PI * 2)
      );
      this._m.compose(
        this._pos.set(x, y - 0.15, z),
        this._q,
        this._scl.set(scale, scale * (0.9 + rng() * 0.3), scale)
      );
      // Subtle per-tree tint so the forest does not read as one flat green.
      const tint = 0.86 + rng() * 0.24;
      this._color.setRGB(tint * (0.95 + rng() * 0.1), tint, tint * (0.93 + rng() * 0.12));
      props.trees.setColorAt(nTrees, this._color);
      props.trees.setMatrixAt(nTrees++, this._m);
      props.obstacles.push({ x, z, radius: 0.8 * scale });
    }

    // Rocks poking out of the ungroomed snow.
    for (let i = 0; i < 22 && nRocks < CAP.rocks; i++) {
      const z = z0 + rng() * CHUNK.length;
      const side = rng() < 0.5 ? -1 : 1;
      const d = side * (halfW + 10 + rng() * 90);
      const x = pisteCenter(z) + d;
      if (rng() < 0.55) continue;
      const y = terrainHeight(x, z);
      const s = 0.7 + rng() * 1.5;
      this._q.setFromAxisAngle(this._up, rng() * Math.PI * 2);
      this._m.compose(
        this._pos.set(x, y - 0.2, z),
        this._q,
        this._scl.set(s, s * 0.8, s)
      );
      props.rocks.setMatrixAt(nRocks++, this._m);
      props.obstacles.push({ x, z, radius: 0.85 * s });
    }

    // A hamlet every few chunks, always well clear of the piste.
    if (rng() < 0.45) {
      const side = rng() < 0.5 ? -1 : 1;
      const clusterZ = z0 + 8 + rng() * (CHUNK.length - 16);
      const clusterD = side * (halfW + 30 + rng() * 45);
      const count = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < count && nCabins < CAP.cabins; i++) {
        const z = clusterZ + (rng() - 0.5) * 26;
        const x = pisteCenter(z) + clusterD + (rng() - 0.5) * 26;
        const y = terrainHeight(x, z);
        terrainNormal(x, z, this._n);
        if (this._n.y < 0.8) continue;
        const rot = rng() * Math.PI * 2;
        this._q.setFromAxisAngle(this._up, rot);
        const s = 0.9 + rng() * 0.5;
        this._m.compose(
          this._pos.set(x, y - 0.25, z),
          this._q,
          this._scl.set(s, s, s)
        );
        props.cabins.setMatrixAt(nCabins++, this._m);
        props.obstacles.push({ x, z, radius: 3.2 * s });
        if (nWindows < CAP.windows) props.windows.setMatrixAt(nWindows++, this._m);

        // Chimney offset (1.1, 4.5, -1.3) in cabin space.
        const cx = Math.cos(rot);
        const sx = Math.sin(rot);
        props.chimneys.push({
          x: x + s * (1.1 * cx + -1.3 * sx),
          y: y - 0.25 + s * 4.6,
          z: z + s * (-1.1 * sx + -1.3 * cx),
        });
      }
    }

    // Piste markers along the corridor edge.
    for (let i = 0; i < 4 && nPoles < CAP.poles; i++) {
      const z = z0 + (i + 0.5) * (CHUNK.length / 4);
      const side = rng() < 0.5 ? -1 : 1;
      const x = pisteCenter(z) + side * (halfW + 1.5);
      const y = terrainHeight(x, z);
      this._q.setFromAxisAngle(this._up, 0);
      this._m.compose(
        this._pos.set(x, y, z),
        this._q,
        this._scl.set(1, 1, 1)
      );
      props.poles.setMatrixAt(nPoles++, this._m);
    }

    props.trees.count = nTrees;
    props.rocks.count = nRocks;
    props.cabins.count = nCabins;
    props.windows.count = nWindows;
    props.poles.count = nPoles;
    for (const m of [props.trees, props.rocks, props.cabins, props.windows, props.poles]) {
      m.instanceMatrix.needsUpdate = true;
    }
    if (props.trees.instanceColor) props.trees.instanceColor.needsUpdate = true;
  }

  /** Obstacles within `range` metres ahead/behind the rider. */
  collectObstacles(z, range, out) {
    out.length = 0;
    for (const props of this.chunks.values()) {
      for (const o of props.obstacles) {
        if (Math.abs(o.z - z) < range) out.push(o);
      }
    }
    return out;
  }

  collectChimneys(z, range, out) {
    out.length = 0;
    for (const props of this.chunks.values()) {
      for (const c of props.chimneys) {
        if (c.z - z > -40 && c.z - z < range) out.push(c);
      }
    }
    return out;
  }
}

// --- Distant backdrop -------------------------------------------------------

function mountainBand(opts) {
  const { radius, count, minH, maxH, rock, rockDark, snowLine, hazeMix, base } = opts;
  const rng = makeRng(opts.seed);
  const tris = [];
  const snow = new THREE.Color(PALETTE.farMountainSnow);
  const haze = new THREE.Color(PALETTE.haze);
  const cRock = new THREE.Color(rock).lerp(haze, hazeMix);
  const cRockDark = new THREE.Color(rockDark).lerp(haze, hazeMix);
  const cSnow = snow.clone().lerp(haze, hazeMix * 0.7);
  const cSnowShade = snow.clone().lerp(cRockDark, 0.35).lerp(haze, hazeMix * 0.7);

  // Rock fades into the haze at its base, so ridges dissolve into the valley
  // instead of ending on a hard horizontal band.
  const footRock = cRock.clone().lerp(haze, 0.72);
  const footRockDark = cRockDark.clone().lerp(haze, 0.72);

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.18;
    const spread = ((Math.PI * 2) / count) * (0.9 + rng() * 1.5);
    const h = minH + Math.pow(rng(), 1.6) * (maxH - minH);
    const r = radius * (0.85 + rng() * 0.3);

    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const halfWidth = r * spread * 0.5;

    const apex = dir.clone().multiplyScalar(r).setY(base + h);
    const skew = (rng() - 0.5) * halfWidth * 0.7;
    apex.addScaledVector(tangent, skew);
    const bl = dir.clone().multiplyScalar(r).addScaledVector(tangent, -halfWidth).setY(base);
    const br = dir.clone().multiplyScalar(r).addScaledVector(tangent, halfWidth).setY(base);
    const bc = dir.clone().multiplyScalar(r).addScaledVector(tangent, skew).setY(base);

    // Two faces per peak give the flat, poster-like light/shade split.
    for (const [p1, p2, col, colSnow, foot] of [
      [bl, bc, cRock, cSnow, footRock],
      [bc, br, cRockDark, cSnowShade, footRockDark],
    ]) {
      const f = snowLine + (rng() - 0.5) * 0.14;
      const s1 = p1.clone().lerp(apex, f);
      const s2 = p2.clone().lerp(apex, f);
      tris.push([p1, p2, s2, [foot, foot, col]]);
      tris.push([p1, s2, s1, [foot, col, col]]);
      tris.push([s1, s2, apex, colSnow]);
    }
  }
  return facets(tris);
}

export function buildBackdrop() {
  const group = new THREE.Group();
  // Double-sided: the peak fans ring the camera and winding order varies.
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: false,
    side: THREE.DoubleSide,
  });

  const layers = [
    {
      radius: 3600, count: 34, minH: 700, maxH: 1400, base: -120,
      rock: 0x8fbbe4, rockDark: 0x74a2d2,
      snowLine: 0.62, hazeMix: 0.4, seed: 7,
    },
    {
      radius: 2500, count: 28, minH: 460, maxH: 1000, base: -160,
      rock: PALETTE.farMountainRock, rockDark: PALETTE.farMountainDeep,
      snowLine: 0.58, hazeMix: 0.18, seed: 19,
    },
    {
      radius: 1650, count: 22, minH: 250, maxH: 580, base: -180,
      rock: 0x4d84bd, rockDark: 0x33639b,
      snowLine: 0.55, hazeMix: 0.05, seed: 33,
    },
    // Low rolling foothills so the valley floor is not an empty white plate.
    {
      radius: 1080, count: 34, minH: 40, maxH: 150, base: -196,
      rock: 0xd2e4f5, rockDark: 0xb9d3ec,
      snowLine: 0.3, hazeMix: 0.12, seed: 51,
    },
  ];
  for (const l of layers) {
    const mesh = new THREE.Mesh(mountainBand(l), mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Dark conifer band that hides the join between mountains and snowfield.
  const forestTris = [];
  const forestCol = new THREE.Color(PALETTE.farForest).lerp(new THREE.Color(PALETTE.haze), 0.25);
  const rng = makeRng(101);
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * Math.PI * 2 + rng() * 0.02;
    const r = 1400 + rng() * 320;
    const w = 26 + rng() * 26;
    const h = 40 + rng() * 60;
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const tan = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const y = -186;
    const l = dir.clone().multiplyScalar(r).addScaledVector(tan, -w).setY(y);
    const rr = dir.clone().multiplyScalar(r).addScaledVector(tan, w).setY(y);
    const top = dir.clone().multiplyScalar(r).setY(y + h);
    forestTris.push([l, rr, top, forestCol]);
  }
  const forest = new THREE.Mesh(facets(forestTris), mat);
  forest.frustumCulled = false;
  group.add(forest);

  // Pale snowfield plate filling everything below the treeline.
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(4200, 48),
    new THREE.MeshBasicMaterial({ color: 0xd3e5f4, fog: false })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -200;
  plate.frustumCulled = false;
  group.add(plate);

  group.renderOrder = -1;
  return group;
}

export function buildSky() {
  const geo = new THREE.SphereGeometry(5200, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(PALETTE.skyTop) },
      horizonColor: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vH = normalize(world.xyz - cameraPosition).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying float vH;
      void main() {
        float t = smoothstep(-0.06, 0.55, vH);
        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -2;
  return sky;
}
