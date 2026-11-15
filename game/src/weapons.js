// The armoury: four hitscan guns and two grenades, with the buy prices the economy runs on.
// Damage falls off past each gun's range; headshots multiply it. Spread punishes moving,
// firing on the run and spraying, while crouching and aiming down sights tighten it —
// stopping to aim pays. View models are chunky, oversized and bright, with a bright front
// sight, so the gun reads clearly in a screenshot.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp } from './util.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', kind: 'pistol', price: 0, damage: 34, headMult: 4,
    mag: 12, reserve: 48, gap: 0.16, auto: false, reload: 1.5,
    spreadStill: 0.0035, spreadMove: 0.03, pellets: 1, falloffStart: 12, sound: 'pistol',
  },
  vk47: {
    id: 'vk47', name: 'VK-47', kind: 'rifle', price: 2500, damage: 36, headMult: 4,
    mag: 30, reserve: 90, gap: 0.1, auto: true, reload: 2.3,
    spreadStill: 0.004, spreadMove: 0.034, pellets: 1, falloffStart: 18, sound: 'rifle',
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel-9', kind: 'smg', price: 1500, damage: 26, headMult: 4,
    mag: 32, reserve: 96, gap: 0.072, auto: true, reload: 1.9,
    spreadStill: 0.006, spreadMove: 0.04, pellets: 1, falloffStart: 10, sound: 'smg',
  },
  m870: {
    id: 'm870', name: 'M870', kind: 'shotgun', price: 1200, damage: 9, headMult: 2,
    mag: 6, reserve: 24, gap: 0.85, auto: false, reload: 2.6,
    spreadStill: 0.05, spreadMove: 0.09, pellets: 8, falloffStart: 8, sound: 'shotgun',
  },
};

export const GEAR = {
  flash: { id: 'flash', name: 'Flashbang', price: 200, desc: 'Blinds anyone facing it' },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 300, desc: 'Blocks sight for 15s' },
  kevlar: { id: 'kevlar', name: 'Kevlar vest', price: 650, desc: 'Halves damage taken' },
};

const HIP_POS = { x: 0.26, y: -0.24, z: -0.5 };
const ADS_POS = { x: 0, y: -0.185, z: -0.42 };

export function createWeapons(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
  const bright = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.35 });
  const sight = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.8, metalness: 0.05 });

  // One chunky view model per gun; only the current one is visible.
  function buildModel(def) {
    const model = new THREE.Group();
    const long = def.kind === 'rifle' || def.kind === 'shotgun';
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, long ? 0.62 : 0.4), bright);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, long ? 0.55 : 0.3), dark);
    barrel.position.set(0, 0.03, long ? -0.55 : -0.32);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.13), def.kind === 'shotgun' ? wood : dark);
    grip.position.set(0, -0.16, 0.14);
    grip.rotation.x = 0.25;
    // Bright front sight post: the thing the eye finds first.
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.03), sight);
    post.position.set(0, 0.11, long ? -0.72 : -0.42);
    model.add(receiver, barrel, grip, post);
    if (def.kind === 'rifle' || def.kind === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.12), dark);
      mag.position.set(0, -0.19, -0.05);
      mag.rotation.x = 0.12;
      model.add(mag);
    }
    if (def.kind === 'rifle') {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.3), wood);
      stock.position.set(0, -0.02, 0.44);
      model.add(stock);
    }
    if (def.kind === 'shotgun') {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.3), wood);
      pump.position.set(0, -0.03, -0.42);
      model.add(pump);
    }
    model.position.set(HIP_POS.x, HIP_POS.y, HIP_POS.z);
    // Chunky but not screen-filling: the raw boxes read as a slab at full scale.
    model.scale.setScalar(0.6);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  for (const id of Object.keys(WEAPONS)) models[id] = buildModel(WEAPONS[id]);

  // A round additive flash reads as a muzzle flare; a rotated square reads as a glitch.
  const flash = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  flash.position.set(0.24, -0.19, -0.82);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.26, -0.16, -0.7);
  camera.add(flashLight);

  const state = {
    current: 'p9',
    mag: WEAPONS.p9.mag,
    reserve: WEAPONS.p9.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flashLeft: 0,
    kick: 0,
    bloom: 0,
    ads: 0, // 0 hip, 1 aimed
    bobPhase: 0,
  };
  // Ammo is kept per weapon so switching never loses a magazine.
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

  function def() {
    return WEAPONS[state.current];
  }

  function showCurrent() {
    for (const id of Object.keys(models)) models[id].visible = id === state.current;
  }
  showCurrent();

  function step(dt, moving, aiming) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flashLeft = Math.max(0, state.flashLeft - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.9);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    state.ads += ((aiming ? 1 : 0) - state.ads) * Math.min(1, dt * 10);
    const model = models[state.current];
    let px = HIP_POS.x + (ADS_POS.x - HIP_POS.x) * state.ads;
    let py = HIP_POS.y + (ADS_POS.y - HIP_POS.y) * state.ads;
    let pz = HIP_POS.z + (ADS_POS.z - HIP_POS.z) * state.ads + state.kick;
    let rx = state.kick * 2.4;
    if (moving) {
      state.bobPhase += dt * 9;
      py += Math.sin(state.bobPhase) * 0.008;
      px += Math.cos(state.bobPhase * 0.5) * 0.006;
    }
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / def().reload;
      rx = -0.6 * Math.sin(progress * Math.PI);
      pz += 0.06 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        ammo[state.current].mag = state.mag;
        ammo[state.current].reserve = state.reserve;
      }
    }
    model.position.set(px, py, pz);
    model.rotation.x = rx;
    flash.visible = state.flashLeft > 0;
    flashLight.intensity = state.flashLeft > 0 ? 20 : 0;
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flashLeft = 0.06;
      state.kick = 0.06;
      state.bloom = Math.min(0.03, state.bloom + 0.004);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      ammo[state.current].mag = state.mag;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def().mag || state.reserve === 0) return false;
      state.reloadLeft = def().reload;
      return true;
    },
    switchTo(id) {
      if (!WEAPONS[id] || id === state.current) return;
      ammo[state.current].mag = state.mag;
      ammo[state.current].reserve = state.reserve;
      state.current = id;
      state.mag = ammo[id].mag;
      state.reserve = ammo[id].reserve;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.15);
      showCurrent();
    },
    refillAll() {
      for (const id of Object.keys(WEAPONS)) {
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
      state.mag = ammo[state.current].mag;
      state.reserve = ammo[state.current].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flashLeft = 0;
      state.kick = 0;
      state.bloom = 0;
    },
    // Spread in radians: still base, plus movement, airtime and bloom; crouch and ADS tighten.
    spread(speed, airborne, crouching, aiming) {
      const d = def();
      let s = d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove + state.bloom;
      if (airborne) s += 0.03;
      if (crouching) s *= 0.7;
      if (aiming) s *= 0.45;
      return s;
    },
    // Damage at a range in metres: full inside falloffStart, down to 55% at 45 m.
    damageAt(distance) {
      const d = def();
      if (distance <= d.falloffStart) return d.damage;
      const t = Math.min(1, (distance - d.falloffStart) / (45 - d.falloffStart));
      return d.damage * (1 - 0.45 * t);
    },
  };
}
