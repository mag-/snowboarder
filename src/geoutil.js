import * as THREE from 'three';

/** Paints every vertex of a geometry a single colour. */
export function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Minimal stand-in for BufferGeometryUtils.mergeGeometries so the game can ship
 * with only three's core build vendored. Handles position/normal/color.
 */
export function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  let offset = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const c = g.attributes.color.array;
    position.set(p, offset * 3);
    normal.set(n, offset * 3);
    color.set(c, offset * 3);
    offset += g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return out;
}

/**
 * Builds a triangle soup with flat normals.
 * Each entry is [a, b, c, colour] where colour is one Color for the whole
 * triangle or an array of three for a per-vertex gradient.
 */
export function facets(tris) {
  const position = new Float32Array(tris.length * 9);
  const color = new Float32Array(tris.length * 9);
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const normal = new Float32Array(tris.length * 9);

  tris.forEach((tri, i) => {
    const [a, b, c, col] = tri;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    nrm.crossVectors(ab, ac).normalize();
    for (let v = 0; v < 3; v++) {
      const p = [a, b, c][v];
      const vc = Array.isArray(col) ? col[v] : col;
      const o = i * 9 + v * 3;
      position[o] = p.x;
      position[o + 1] = p.y;
      position[o + 2] = p.z;
      normal[o] = nrm.x;
      normal[o + 1] = nrm.y;
      normal[o + 2] = nrm.z;
      color[o] = vc.r;
      color[o + 1] = vc.g;
      color[o + 2] = vc.b;
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return geo;
}
