// Grenades: flashbangs and smoke. Both are physics objects with a fuse driven by the
// fixed-step sim clock, never wall time, so a slow frame cannot change when one pops.
// A flash blinds by distance, by whether the victim faces it, and by occlusion; smoke lays
// a volume that blocks bot line-of-sight for 15 seconds.

import * as THREE from 'three';
import { clamp } from './util.js';

const MAX_GRENADES = 8;
const FLASH_FUSE = 1.4;
const FLASH_RANGE = 22;
const FLASH_FULL = 6;
const SMOKE_SECONDS = 15;
const SMOKE_RADIUS = 3.4;
const GRAVITY = 18;

export function createGrenades(scene, world) {
  const flashMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.5, metalness: 0.4 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x5a6a72, roughness: 0.7, metalness: 0.2 });
  const shellGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10);
  const puffGeo = new THREE.SphereGeometry(1, 10, 8);
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xb9c0c4, transparent: true, opacity: 0.55, depthWrite: false });

  const thrown = [];
  const smokes = [];
  for (let i = 0; i < MAX_GRENADES; i += 1) {
    const mesh = new THREE.Mesh(shellGeo, flashMat);
    mesh.visible = false;
    scene.add(mesh);
    thrown.push({ mesh, active: false, kind: 'flash', pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0 });
  }

  function spawnPuff(x, y, z, scale) {
    const puff = new THREE.Mesh(puffGeo, puffMat);
    puff.position.set(x, y, z);
    puff.scale.setScalar(scale);
    scene.add(puff);
    return puff;
  }

  return {
    smokes,
    // A live smoke volume blocks sight between two points when the segment passes through it.
    smokeBlocks(ax, ay, az, bx, by, bz) {
      for (const smoke of smokes) {
        const cx = smoke.x;
        const cy = smoke.y;
        const cz = smoke.z;
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        const lenSq = dx * dx + dy * dy + dz * dz || 1;
        let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / lenSq;
        t = clamp(t, 0, 1);
        const px = ax + dx * t - cx;
        const py = ay + dy * t - cy;
        const pz = az + dz * t - cz;
        if (px * px + py * py + pz * pz < SMOKE_RADIUS * SMOKE_RADIUS) return true;
      }
      return false;
    },
    throwGrenade(from, dir, kind, simTime) {
      const slot = thrown.find((g) => !g.active);
      if (!slot) return false;
      slot.active = true;
      slot.kind = kind;
      slot.pos.copy(from);
      slot.vel.copy(dir).multiplyScalar(14);
      slot.vel.y += 3.2;
      slot.fuse = FLASH_FUSE;
      slot.mesh.material = kind === 'flash' ? flashMat : smokeMat;
      slot.mesh.visible = true;
      slot.mesh.position.copy(slot.pos);
      return true;
    },
    // Steps on sim time. `onFlash` receives the detonation point; `onSmoke` the new volume.
    step(dt, simTime, onFlash, onSmoke) {
      for (const g of thrown) {
        if (!g.active) continue;
        g.vel.y -= GRAVITY * dt;
        g.pos.addScaledVector(g.vel, dt);
        if (g.pos.y < 0.07) {
          g.pos.y = 0.07;
          g.vel.y = Math.abs(g.vel.y) * 0.42;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
        // Cheap wall bounce: clamp inside the compound, lose energy.
        if (g.pos.x < -26.6 || g.pos.x > 26.6) {
          g.pos.x = clamp(g.pos.x, -26.6, 26.6);
          g.vel.x *= -0.42;
        }
        if (g.pos.z < -26.6 || g.pos.z > 26.6) {
          g.pos.z = clamp(g.pos.z, -26.6, 26.6);
          g.vel.z *= -0.42;
        }
        g.mesh.position.copy(g.pos);
        g.fuse -= dt;
        if (g.fuse > 0) continue;
        g.active = false;
        g.mesh.visible = false;
        if (g.kind === 'flash') {
          onFlash(g.pos.x, g.pos.y, g.pos.z);
        } else {
          const puffs = [
            spawnPuff(g.pos.x, 1.1, g.pos.z, 2.6),
            spawnPuff(g.pos.x + 1.4, 1.6, g.pos.z + 0.6, 2.0),
            spawnPuff(g.pos.x - 1.3, 1.5, g.pos.z - 0.8, 2.0),
            spawnPuff(g.pos.x + 0.3, 2.2, g.pos.z - 1.2, 1.7),
          ];
          smokes.push({ x: g.pos.x, y: 1.4, z: g.pos.z, expiresAt: simTime + SMOKE_SECONDS, puffs });
          onSmoke(g.pos.x, g.pos.y, g.pos.z);
        }
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        if (simTime < smokes[i].expiresAt) continue;
        // Puffs share one geometry, so remove the meshes without disposing it.
        for (const puff of smokes[i].puffs) scene.remove(puff);
        smokes.splice(i, 1);
      }
    },
    // Blind strength 0..1 for one viewer: distance falloff, facing, and occlusion.
    flashStrength(x, y, z, viewYaw, viewPitch, fx, fy, fz) {
      const dx = fx - x;
      const dy = fy - y;
      const dz = fz - z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > FLASH_RANGE) return 0;
      if (!world.hasLineOfSight(x, y, z, fx, fy, fz)) return 0;
      const facing = (-Math.sin(viewYaw) * dx + -Math.cos(viewYaw) * dz) / (dist || 1);
      // Facing it fully blinds; turned away, only a quarter of the effect.
      const facingFactor = 0.25 + 0.75 * clamp((facing + 0.2) / 1.2, 0, 1);
      const distFactor = dist <= FLASH_FULL ? 1 : 1 - (dist - FLASH_FULL) / (FLASH_RANGE - FLASH_FULL);
      return clamp(distFactor * facingFactor, 0, 1);
    },
    reset() {
      for (const g of thrown) {
        g.active = false;
        g.mesh.visible = false;
      }
      for (const smoke of smokes) {
        for (const puff of smoke.puffs) scene.remove(puff);
      }
      smokes.length = 0;
    },
  };
}
