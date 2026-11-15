// Yard 7: an original 54 x 54 metre dusk compound. Three lanes run south to north from the
// Sable spawn to the Warden spawn, split halfway by a mid wall with three gaps. Site A sits
// in the north-west, Site B in the north-east, and a water tower marks the middle of the map.
// Every solid is a collider for movement and a surface a bullet stops on.
//
// The waypoint graph (~34 nodes) is the bots' road map: routes are breadth-first searches
// over it, so a bot never walks through a wall to reach a site.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { bfsPath } from './util.js';

export const MAP_HALF = 27;
export const SITES = {
  A: { key: 'A', x: -16, z: -16, radius: 4.6 },
  B: { key: 'B', x: 16, z: -16, radius: 4.6 },
};
export const SPAWNS = {
  sable: [
    { x: 0, z: 23, yaw: 0 },
    { x: -3.2, z: 23, yaw: 0 },
    { x: 3.2, z: 23, yaw: 0 },
  ],
  warden: [
    { x: 0, z: -23, yaw: Math.PI },
    { x: -3.2, z: -23, yaw: Math.PI },
    { x: 3.2, z: -23, yaw: Math.PI },
  ],
};

// Waypoint positions [x, z] and their bidirectional links.
const WAYPOINTS = [
  [0, 23], [-8, 22], [8, 22], [-18, 18], [0, 16], [18, 18],
  [-18, 8], [-6, 8], [6, 8], [18, 8],
  [-12, 0], [0, 0], [12, 0],
  [-18, -8], [-6, -8], [6, -8], [18, -8],
  [-12, -13], [0, -13], [12, -13],
  [-16, -16], [16, -16], [-21, -16], [21, -16], [-8, -19], [8, -19],
  [0, -23], [-8, -22], [8, -22],
  [-23, 4], [23, 4], [-23, -8], [23, -8], [0, -4],
];
const LINKS = [
  [1, 2, 4], [0, 3, 7], [0, 5, 8], [1, 6, 29], [0, 7, 8, 11], [2, 9, 30],
  [3, 10, 29], [1, 4, 10, 11], [2, 4, 11, 12], [5, 12, 30],
  [6, 7, 13, 31], [4, 7, 8, 14, 15, 33], [8, 9, 16, 32],
  [10, 17, 22, 31], [10, 11, 17, 18, 33], [11, 12, 18, 19, 33], [12, 19, 23, 32],
  [13, 14, 20, 24], [14, 15, 24, 25, 33], [15, 16, 21, 25],
  [17, 22, 24], [19, 23, 25], [13, 20], [16, 21], [17, 18, 20, 27], [18, 19, 21, 28],
  [27, 28, 18], [26, 24], [26, 25],
  [3, 6, 10, 31], [5, 9, 12, 32], [13, 29], [16, 30], [11, 14, 15, 18],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const mat = {};
  for (const name of Object.keys(PALETTE)) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: 0.04,
    });
  }
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a4234, roughness: 1, metalness: 0 });

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(rTop, rBottom, h, x, y, z, material, collide = true, segments = 14) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 4.6 m walls, open to the dusk sky.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(54.8, 0.4, 54.8), groundMat);
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3().setFromObject(ground));
  shootables.push(ground);
  box(0.6, 4.6, 55, -27.3, 2.3, 0, mat.surface);
  box(0.6, 4.6, 55, 27.3, 2.3, 0, mat.surface);
  box(55, 4.6, 0.6, 0, 2.3, -27.3, mat.surface);
  box(55, 4.6, 0.6, 0, 2.3, 27.3, mat.surface);

  // Mid wall at z = 0 with three gaps (centred x = -12, 0, +12, each 3.6 m wide).
  box(13.2, 3.4, 0.6, -20.4, 1.7, 0, mat.hairline);
  box(8.4, 3.4, 0.6, -6, 1.7, 0, mat.hairline);
  box(8.4, 3.4, 0.6, 6, 1.7, 0, mat.hairline);
  box(13.2, 3.4, 0.6, 20.4, 1.7, 0, mat.hairline);

  // Lane cover: crates, low walls and barrels, so every lane has corners to play around.
  box(2.4, 1.1, 1.2, -18, 0.55, 13, mat.sand);
  box(1.2, 1.1, 2.4, -21, 0.55, -3, mat.sand);
  box(2.4, 1.1, 1.2, 18, 0.55, 13, mat.sand);
  box(1.2, 1.1, 2.4, 21, 0.55, -3, mat.sand);
  box(3.2, 1.1, 0.8, -4, 0.55, 11, mat.rust);
  box(3.2, 1.1, 0.8, 4, 0.55, 11, mat.rust);
  box(1.6, 1.6, 1.6, -9, 0.8, -6, mat.sand);
  box(1.6, 1.6, 1.6, 13, 0.8, 5, mat.sand);
  box(2.2, 0.9, 2.2, -3, 0.45, -11, mat.hairline);
  box(2.2, 0.9, 2.2, 3, 0.45, -11, mat.hairline);
  cylinder(0.55, 0.55, 1.15, -15, 0.58, 5, mat.rust);
  cylinder(0.55, 0.55, 1.15, 15, 0.58, -11, mat.rust);
  cylinder(0.55, 0.55, 1.15, -23, 0.58, -13, mat.rust);
  cylinder(0.55, 0.55, 1.15, 23, 0.58, 13, mat.rust);
  // Site cover: crates to plant behind.
  box(1.8, 1.2, 1.8, -18.5, 0.6, -18.5, mat.sand);
  box(1.8, 1.2, 1.8, -13.5, 0.6, -13.5, mat.sand);
  box(1.8, 1.2, 1.8, 18.5, 0.6, -18.5, mat.sand);
  box(1.8, 1.2, 1.8, 13.5, 0.6, -13.5, mat.sand);
  // Spawn cover.
  box(2.6, 1.1, 1.0, -6, 0.55, 20, mat.hairline);
  box(2.6, 1.1, 1.0, 6, 0.55, 20, mat.hairline);
  box(2.6, 1.1, 1.0, -6, 0.55, -20, mat.hairline);
  box(2.6, 1.1, 1.0, 6, 0.55, -20, mat.hairline);

  // Site paint: flat markers on the ground, one colour per site.
  const paintA = new THREE.Mesh(new THREE.BoxGeometry(7, 0.04, 7), new THREE.MeshStandardMaterial({ color: 0x3fb8a6, roughness: 0.9 }));
  paintA.position.set(-16, 0.02, -16);
  paintA.receiveShadow = true;
  group.add(paintA);
  const paintB = paintA.clone();
  paintB.material = new THREE.MeshStandardMaterial({ color: 0xe0683a, roughness: 0.9 });
  paintB.position.set(16, 0.02, -16);
  group.add(paintB);

  // Floating site letters, drawn on canvas at load (no external assets): two crossed
  // planes per site so the letter reads from any approach. Decor only — never shot at.
  function siteLetter(letter, color, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx2d = canvas.getContext('2d');
    ctx2d.font = '700 190px system-ui, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.lineWidth = 16;
    ctx2d.strokeStyle = 'rgba(16,21,28,0.9)';
    ctx2d.strokeText(letter, 128, 136);
    ctx2d.fillStyle = color;
    ctx2d.fillText(letter, 128, 136);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const geo = new THREE.PlaneGeometry(3.4, 3.4);
    for (const rotation of [0, Math.PI / 2]) {
      const plane = new THREE.Mesh(geo, material);
      plane.position.set(x, 4.6, z);
      plane.rotation.y = rotation;
      group.add(plane);
    }
  }
  siteLetter('A', '#3fb8a6', -16, -16);
  siteLetter('B', '#e0683a', 16, -16);

  // Water tower landmark at (9, -7): four legs, a tank and a cone roof.
  for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    box(0.35, 6.4, 0.35, 9 + lx, 3.2, -7 + lz, mat.rust);
  }
  cylinder(2.3, 2.3, 2.8, 9, 7.8, -7, mat.surface, false, 18);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 18), mat.accent);
  roof.position.set(9, 9.9, -7);
  roof.castShadow = true;
  group.add(roof);
  shootables.push(roof);

  // Dusk light: a low warm sun from the west, a cool sky fill, and a long view distance.
  scene.background = new THREE.Color(0x1c2836);
  scene.fog = new THREE.Fog(new THREE.Color(0x1c2836), 42, 110);
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(0x3a2f22), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb36b), 2.6);
  sun.position.set(-24, 20, 14);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x8fb4d8), 0.65);
  fill.position.set(18, 12, -14);
  scene.add(fill);

  // Shared scratch objects for collision and sight tests; reused, never allocated per call.
  const probe = new THREE.Box3();
  const raycaster = new THREE.Raycaster();
  const rayDir = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const seen = new Uint8Array(WAYPOINTS.length);
  const queue = [];
  const parent = new Int16Array(WAYPOINTS.length);
  const pathOut = [];

  function overlaps(x, y, z, height, radius, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // Axis-separated box movement against the colliders: slide along walls, land on floors.
  // `body` carries position (feet) and velocity; returns nothing, mutates in place.
  function moveBox(body, dt, height, radius) {
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, height, radius, 0.04)) {
      body.position.x = nextX;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, height, radius, 0.04)) {
      body.position.z = nextZ;
    } else {
      body.velocity.z = 0;
    }
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, height, radius, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
  }

  function hasLineOfSight(ax, ay, az, bx, by, bz) {
    rayDir.set(bx - ax, by - ay, bz - az);
    const distance = rayDir.length();
    if (distance < 0.001) return true;
    rayDir.divideScalar(distance);
    rayOrigin.set(ax, ay, az);
    raycaster.set(rayOrigin, rayDir);
    raycaster.far = distance - 0.05;
    return raycaster.intersectObjects(shootables, false).length === 0;
  }

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const dx = WAYPOINTS[i][0] - x;
      const dz = WAYPOINTS[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  return {
    colliders,
    shootables,
    waypoints: WAYPOINTS,
    siteAt(x, z) {
      for (const key of ['A', 'B']) {
        const site = SITES[key];
        const dx = x - site.x;
        const dz = z - site.z;
        if (dx * dx + dz * dz <= site.radius * site.radius) return key;
      }
      return null;
    },
    overlaps,
    moveBox,
    hasLineOfSight,
    nearestWaypoint,
    findPath(fromX, fromZ, toX, toZ) {
      const from = nearestWaypoint(fromX, fromZ);
      const to = nearestWaypoint(toX, toZ);
      bfsPath(LINKS, from, to, pathOut, seen, queue, parent);
      return pathOut;
    },
  };
}
