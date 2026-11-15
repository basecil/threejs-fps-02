// Pooled shot feedback: tracers and impact sparks. Fixed pools, no allocation while firing.
// The shot direction and the tracer endpoint use separate scratch vectors — reusing one
// vector for both corrupts the tracer the moment the direction is reused.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 40;
const TRACER_LIFE = 0.07;
const SPARK_LIFE = 0.35;

export function createEffects(scene) {
  const tracerGeo = new THREE.BoxGeometry(0.016, 0.016, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false });
  const sparkGeo = new THREE.TetrahedronGeometry(0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) });
  const bloodMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) });

  const tracers = [];
  const sparks = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }
  let tracerCursor = 0;
  let sparkCursor = 0;
  // Separate scratch vectors: one for the shot direction, one for the tracer endpoint.
  const shotDir = new THREE.Vector3();
  const tracerEnd = new THREE.Vector3();
  const tracerMid = new THREE.Vector3();

  function tracer(from, to) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
    tracerEnd.copy(to);
    shotDir.subVectors(tracerEnd, from);
    const length = shotDir.length();
    if (length < 0.5) return;
    tracerMid.addVectors(from, tracerEnd).multiplyScalar(0.5);
    slot.mesh.position.copy(tracerMid);
    slot.mesh.scale.set(1, 1, length);
    slot.mesh.lookAt(tracerEnd);
    slot.mesh.visible = true;
    slot.life = TRACER_LIFE;
  }

  function spark(point, blood, count = 5) {
    for (let i = 0; i < count; i += 1) {
      const slot = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      slot.mesh.position.copy(point);
      slot.mesh.material = blood ? bloodMat : sparkMat;
      slot.vel.set((Math.random() - 0.5) * 3, Math.random() * 2.5 + 1, (Math.random() - 0.5) * 3);
      slot.mesh.visible = true;
      slot.life = SPARK_LIFE * (0.6 + Math.random() * 0.4);
    }
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 9 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 9;
      s.mesh.rotation.y += dt * 7;
    }
  }

  return { tracer, spark, step };
}
