// SABLE LINE — boot and the one loop. A fixed 60 Hz simulation feeds rendering at the
// display's rate; shooting, planting, grenades and bot brains all run on sim time, so the
// game plays the same on any frame rate. ?shot=start|play|buy|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady. window.__sable exposes the live state for scripted play-tests.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SPAWNS, SITES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, GEAR } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createState, ECONOMY, ROUND } from './state.js';
import { createAudio } from './audio.js';
import { mulberry32, clamp } from './util.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const audio = createAudio();
const world = createWorld(scene);
const effects = createEffects(scene);
const grenades = createGrenades(scene, world);
const playerBody = createPlayer(world, SPAWNS.sable[0]);
const weapons = createWeapons(camera);

const player = {
  id: 'player',
  name: 'You',
  kind: 'player',
  team: 'sable',
  alive: true,
  health: 100,
  kevlar: false,
  body: playerBody.state,
  grenades: { flash: 0, smoke: 0 },
  primary: null, // owned primary weapon id, or null for the pistol alone
  flashUntil: 0,
  flashPeak: 0,
};
const sounds = [];
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// Scratch vectors: the shot direction and the tracer start are never the same object.
const shootDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const camDir = new THREE.Vector3();
const sphereTo = new THREE.Vector3();
const aimPoint = new THREE.Vector3();

let started = false;
let paused = false;
let frozen = false;
let selected = 'gun'; // 'gun' | 'flash' | 'smoke'
let throwCooldown = 0;
let prevFiring = false;
let plantProgress = 0;
let plantSite = null;
let lastBombBeep = -1;
let accumulator = 0;
let lastTime = performance.now();
let spectateId = null;

const hud = createHud(world, {
  onPlay() {
    audio.unlock();
    if (shot) return;
    if (state.phase === 'matchEnd') restartMatch();
    input.requestLock();
  },
  onBuy(id) {
    buyItem(id);
  },
  onBuyClose() {
    closeBuy(true);
  },
});

const input = createInput(renderer.domElement, onLockChange);

function teamOf(id) {
  if (id === 'player') return 'sable';
  const bot = bots.byId(id);
  return bot ? bot.team : 'sable';
}

function aliveCounts() {
  return {
    sable: (player.alive ? 1 : 0) + bots.aliveCount('sable'),
    warden: bots.aliveCount('warden'),
  };
}

function resetLoadoutForRound() {
  player.health = 100;
  player.alive = true;
  player.grenades.flash = 0;
  player.grenades.smoke = 0;
  player.flashUntil = 0;
  player.flashPeak = 0;
  playerBody.reset(SPAWNS.sable[0]);
  weapons.refillAll();
  weapons.switchTo(player.primary ?? 'p9');
  selected = 'gun';
  plantProgress = 0;
  plantSite = null;
  spectateId = null;
  grenades.reset();
  bombMesh.visible = false;
  bombLight.intensity = 0;
  hud.hideBomb();
  hud.hidePlant();
  hud.setCharge(true);
  // Bots spend their winnings: a rifle when they can afford one, kevlar when flush.
  for (const bot of bots.bots) {
    const money = state.money[bot.id] ?? 0;
    if (money >= WEAPONS.vk47.price && bot.weapon !== 'vk47') {
      state.money[bot.id] -= WEAPONS.vk47.price;
      bot.weapon = 'vk47';
    } else if (money >= WEAPONS.kestrel.price && bot.weapon === 'p9') {
      state.money[bot.id] -= WEAPONS.kestrel.price;
      bot.weapon = 'kestrel';
    }
    if (!bot.kevlar && (state.money[bot.id] ?? 0) >= GEAR.kevlar.price) {
      state.money[bot.id] -= GEAR.kevlar.price;
      bot.kevlar = true;
    }
  }
  bots.planRound(SPAWNS);
}

const rounds = createRounds(state, {
  teamOf,
  onRoundStart() {
    resetLoadoutForRound();
    if (started) hud.banner(`Round ${state.round}`, state.round === 1 ? 'Sable attacks — plant the charge or eliminate the Warden' : '', 2200);
  },
  onPhase(phase) {
    if (phase === 'live') {
      if (hud.buyOpen) closeBuy(false);
      hud.banner(`Round ${state.round}`, 'Go — the sites are north', 1400);
    }
  },
  onRoundEnd(winner, reason) {
    hud.hidePlant();
    hud.hideBomb();
    const title = winner === 'sable' ? 'SABLE WINS THE ROUND' : 'WARDEN WINS THE ROUND';
    hud.banner(title, reason, 3000);
    if (winner === 'sable') audio.roundWin();
    else audio.roundLoss();
    if (reason === 'Charge detonated') {
      audio.explosion();
      hud.setFlash(0.5);
      setTimeout(() => hud.setFlash(0), 350);
    }
  },
  onMatchEnd(winner) {
    const score = `${state.score.sable} – ${state.score.warden}`;
    hud.showOverlay('end', {
      copy: winner === 'sable'
        ? `Sable takes the match ${score}. Yard 7 is yours — play again to run it back.`
        : `Warden takes the match ${score}. The sites held — play again to run it back.`,
    });
    input.exitLock();
  },
  onBombPlanted() {
    bombMesh.position.set(state.bomb.x, 0.25, state.bomb.z);
    bombMesh.visible = true;
    lastBombBeep = -1;
    audio.bombBeep(false);
    bots.onBombPlanted();
  },
  onBombTick(timer) {
    hud.setBomb(timer, ROUND.bombSeconds);
    const whole = Math.ceil(timer);
    if (whole !== lastBombBeep && (whole <= 10 || whole % 2 === 0)) {
      lastBombBeep = whole;
      audio.bombBeep(whole <= 10);
    }
  },
});

const bots = createBots(scene, world, {
  rng: random,
  state,
  grenades,
  sounds,
  getPlayer() {
    return player;
  },
  fireHitscan(origin, dir, def, shooter) {
    fireHitscan(origin, dir, def, shooter);
  },
  onPlant(site, bot) {
    const sitePos = SITES[site];
    rounds.plant(site, sitePos.x, sitePos.z);
    pushSound(bot.pos.x, bot.pos.z, 40);
  },
  onDefuse() {
    rounds.defuse();
  },
});

// The planted charge: a dark box with a blinking red light.
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.3, 0.3),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 }),
);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.danger), 0, 5);
bombLight.position.y = 0.4;
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const shootables = world.shootables.concat(bots.hitMeshes);

function pushSound(x, z, radius) {
  sounds.push({ x, z, radius, time: state.simTime });
}

function raySphere(origin, dir, cx, cy, cz, radius) {
  sphereTo.set(cx - origin.x, cy - origin.y, cz - origin.z);
  const tca = sphereTo.dot(dir);
  if (tca < 0) return Infinity;
  const d2 = sphereTo.lengthSq() - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// One hitscan shot: the nearest of world, bots and (for bot shooters) the player wins.
// No friendly fire — a same-team hit passes through to whatever is behind it.
function fireHitscan(origin, dir, def, shooter) {
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(shootables, false);
  let endDistance = 70;
  let hitPoint = null;
  let hitEntity = null;
  let hitPart = null;
  for (const hit of hits) {
    const entity = hit.object.userData.entity;
    if (entity === shooter) continue; // a bot never blocks its own shot
    if (entity && entity.alive && entity.team === shooter.team) continue;
    if (entity && entity !== shooter && entity.alive) {
      hitEntity = entity;
      hitPart = hit.object.userData.part ?? 'torso';
    }
    endDistance = hit.distance;
    hitPoint = hit.point;
    break;
  }
  // The player has no mesh: two spheres, head and torso.
  if (shooter.team !== 'sable' && player.alive) {
    const headT = raySphere(origin, dir, player.body.position.x, player.body.position.y + 1.55, player.body.position.z, 0.22);
    const bodyT = raySphere(origin, dir, player.body.position.x, player.body.position.y + 1.0, player.body.position.z, 0.45);
    const t = Math.min(headT, bodyT);
    if (t < endDistance) {
      hitEntity = player;
      hitPart = headT <= bodyT ? 'head' : 'torso';
      endDistance = t;
      hitPoint = null;
    }
  }
  const end = aimPoint.copy(origin).addScaledVector(dir, endDistance);
  effects.tracer(origin, end);
  if (hitEntity) {
    const distance = endDistance;
    let damage = def.damage;
    if (distance > def.falloffStart) {
      const t = Math.min(1, (distance - def.falloffStart) / (45 - def.falloffStart));
      damage = def.damage * (1 - 0.45 * t);
    }
    if (hitPart === 'head') damage *= def.headMult;
    if (hitEntity.kevlar) damage *= 0.5;
    damageEntity(hitEntity, Math.round(damage), hitPart === 'head', shooter);
    effects.spark(hitPoint ?? end, true, 4);
  } else if (hitPoint) {
    effects.spark(hitPoint, false, 3);
  }
  const shooterPos = shooter.kind === 'player' ? shooter.body.position : shooter.pos;
  pushSound(shooterPos.x, shooterPos.z, 30);
  const distToPlayer = Math.hypot(shooterPos.x - player.body.position.x, shooterPos.z - player.body.position.z);
  audio.shot(def.sound, shooter !== player && distToPlayer > 12);
}

function damageEntity(target, amount, headshot, attacker) {
  if (!target.alive) return;
  target.health -= amount;
  if (target === player) {
    hud.damageFlash();
    audio.hurt();
  }
  if (attacker === player) {
    hud.hitMarker(target.health <= 0, shot ? 4000 : 90);
    audio.hit(target.health <= 0);
  }
  if (target.health > 0) return;
  target.alive = false;
  target.health = 0;
  if (target.kind === 'bot') {
    target.fall = 0;
    target.target = null;
    target.channel = null;
  }
  state.kills[attacker.id] = (state.kills[attacker.id] ?? 0) + 1;
  state.deaths[target.id] = (state.deaths[target.id] ?? 0) + 1;
  state.feed.push({ killer: attacker.name, killerTeam: attacker.team, victim: target.name, victimTeam: target.team, headshot, time: state.simTime });
  hud.killfeedAdd({ killer: attacker.name, killerTeam: attacker.team, victim: target.name, victimTeam: target.team, headshot });
  if (state.bomb.carrier === target.id && !state.bomb.planted) {
    const next = bots.bots.find((b) => b.alive && b.team === 'sable');
    state.bomb.carrier = next ? next.id : null;
    if (next) {
      next.objective = 'plant';
      next.state = 'route';
    }
  }
  if (target === player) {
    spectateId = (bots.bots.find((b) => b.alive && b.team === 'sable') ?? {}).id ?? null;
    hud.setCharge(false);
    if (hud.buyOpen) closeBuy(false);
  }
  rounds.onKill(attacker.id, target.team, aliveCounts());
}

function buyItems() {
  const money = state.money.player ?? 0;
  const items = [];
  for (const id of ['vk47', 'kestrel', 'm870']) {
    const def = WEAPONS[id];
    items.push({
      id, name: def.name, price: def.price, owned: player.primary === id,
      desc: `${def.damage} dmg · ${def.mag}-round mag${def.pellets > 1 ? ` · ${def.pellets} pellets` : ''}`,
      disabled: player.primary === id || money < def.price,
    });
  }
  items.push({ ...GEAR.flash, owned: false, disabled: money < GEAR.flash.price || player.grenades.flash >= 2 });
  items.push({ ...GEAR.smoke, owned: false, disabled: money < GEAR.smoke.price || player.grenades.smoke >= 2 });
  items.push({ ...GEAR.kevlar, owned: player.kevlar, disabled: player.kevlar || money < GEAR.kevlar.price });
  return items;
}

function buyItem(id) {
  if (state.phase !== 'buy') {
    audio.denied();
    closeBuy(true);
    return;
  }
  const price = WEAPONS[id]?.price ?? GEAR[id]?.price;
  if (price === undefined || (state.money.player ?? 0) < price) {
    audio.denied();
    return;
  }
  if (WEAPONS[id]) {
    if (player.primary === id) {
      audio.denied();
      return;
    }
    state.money.player -= price;
    player.primary = id;
    weapons.switchTo(id);
    selected = 'gun';
  } else if (id === 'flash' || id === 'smoke') {
    if (player.grenades[id] >= 2) {
      audio.denied();
      return;
    }
    state.money.player -= price;
    player.grenades[id] += 1;
  } else if (id === 'kevlar') {
    if (player.kevlar) {
      audio.denied();
      return;
    }
    state.money.player -= price;
    player.kevlar = true;
    hud.setArmor(true);
  }
  audio.buy();
  hud.setMoney(state.money.player);
  hud.setGrenades(player.grenades.flash, player.grenades.smoke);
  if (hud.buyOpen) hud.showBuy(buyItems(), state.money.player);
}

function openBuy() {
  if (state.phase !== 'buy' || !player.alive) return;
  hud.showBuy(buyItems(), state.money.player ?? 0);
  input.exitLock();
}

function closeBuy(relock) {
  hud.hideBuy();
  if (relock && started && state.phase !== 'matchEnd' && !shot) input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    hud.hideOverlay();
    audio.unlock();
  } else if (started && !hud.buyOpen && state.phase !== 'matchEnd') {
    paused = true;
    hud.showOverlay('paused');
  }
}

function throwSelected() {
  if (selected !== 'flash' && selected !== 'smoke') return;
  if (player.grenades[selected] <= 0 || throwCooldown > 0) return;
  camera.getWorldDirection(camDir);
  muzzlePos.copy(camera.position).addScaledVector(camDir, 0.5);
  if (!grenades.throwGrenade(muzzlePos, camDir, selected, state.simTime)) return;
  player.grenades[selected] -= 1;
  throwCooldown = 0.5;
  hud.setGrenades(player.grenades.flash, player.grenades.smoke);
  if (player.grenades[selected] === 0) selected = 'gun';
}

function playerShoot() {
  if (!weapons.ready()) {
    if (weapons.state.mag === 0 && weapons.state.cooldown === 0 && weapons.state.reloadLeft === 0) {
      audio.dryFire();
      weapons.state.cooldown = 0.3;
    }
    return;
  }
  if (!weapons.takeRound()) return;
  const def = weapons.def();
  camera.getWorldDirection(camDir);
  muzzlePos.copy(camera.position).addScaledVector(camDir, 0.6);
  muzzlePos.y -= 0.12;
  const speed = playerBody.groundSpeed();
  const spread = weapons.spread(speed, !player.body.onGround, player.body.crouching, input.state.aiming);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    shootDir.copy(camDir);
    shootDir.x += (random() * 2 - 1) * spread;
    shootDir.y += (random() * 2 - 1) * spread;
    shootDir.z += (random() * 2 - 1) * spread;
    shootDir.normalize();
    fireHitscan(muzzlePos, shootDir, def, player);
  }
  weapons.pullTrigger();
  const kick = def.kind === 'shotgun' ? 0.028 : def.kind === 'rifle' ? 0.011 : 0.008;
  playerBody.recoil(kick + random() * 0.004, (random() * 2 - 1) * 0.004);
}

function step(dt) {
  state.simTime += dt;
  throwCooldown = Math.max(0, throwCooldown - dt);
  for (let i = sounds.length - 1; i >= 0; i -= 1) {
    if (state.simTime - sounds[i].time > 2) sounds.splice(i, 1);
  }

  // Continuous input: movement always, firing and planting only while live.
  playerBody.step(dt, input.state.keys);
  weapons.step(dt, playerBody.groundSpeed() > 0.5, input.state.aiming && selected === 'gun');
  const firing = input.state.firing && !hud.buyOpen;
  const def = weapons.def();
  const triggerEdge = firing && !prevFiring;
  prevFiring = firing;
  if (player.alive && state.phase === 'live' && !paused) {
    if (selected === 'gun') {
      if (def.auto ? firing : triggerEdge) playerShoot();
    } else if (triggerEdge) {
      throwSelected();
    }
    if (input.wasPressed('KeyR') && weapons.reload()) audio.reload();
  }

  // Planting: hold F inside a site while carrying the charge.
  const site = world.siteAt(player.body.position.x, player.body.position.z);
  if (
    player.alive && state.phase === 'live' && !state.bomb.planted
    && state.bomb.carrier === 'player' && site && input.state.keys.has('KeyF')
  ) {
    if (plantSite !== site) {
      plantSite = site;
      plantProgress = 0;
    }
    plantProgress += dt;
    hud.setPlant(plantProgress / ROUND.plantSeconds, `Planting at Site ${site}…`);
    if (Math.floor(plantProgress * 2) !== Math.floor((plantProgress - dt) * 2)) audio.plantTick();
    if (plantProgress >= ROUND.plantSeconds) {
      const sitePos = SITES[site];
      rounds.plant(site, sitePos.x, sitePos.z);
      plantProgress = 0;
      plantSite = null;
      hud.hidePlant();
    }
  } else {
    if (plantProgress > 0) hud.hidePlant();
    plantProgress = 0;
    plantSite = null;
  }

  grenades.step(dt, state.simTime, (fx, fy, fz) => {
    // A flash detonates: blind the player and every bot that faces it.
    if (player.alive) {
      const strength = grenades.flashStrength(
        player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z,
        player.body.yaw, player.body.pitch, fx, fy, fz,
      );
      if (strength > 0.05) {
        // A weaker second flash never shortens a blind already in force.
        const until = state.simTime + 0.5 + strength * 2.2;
        if (until > player.flashUntil) {
          player.flashUntil = until;
          player.flashPeak = strength;
        }
        audio.flashRing();
      }
    }
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const strength = grenades.flashStrength(bot.pos.x, 1.5, bot.pos.z, bot.yaw, 0, fx, fy, fz);
      if (strength > 0.05) bots.blind(bot, state.simTime + 0.5 + strength * 2.5, strength);
    }
    pushSound(fx, fz, 25);
  }, (sx, sy, sz) => {
    audio.smokePop();
    pushSound(sx, sz, 15);
  });

  bots.step(dt, state.simTime);
  effects.step(dt);
  rounds.step(dt);
  input.endStep();
}

function handleDiscreteKeys() {
  if (input.wasPressed('KeyB')) {
    if (hud.buyOpen) closeBuy(true);
    else if (state.phase === 'buy' && player.alive) openBuy();
  }
  if (input.wasPressed('Digit1') && player.primary) {
    weapons.switchTo(player.primary);
    selected = 'gun';
  }
  if (input.wasPressed('Digit2')) {
    weapons.switchTo('p9');
    selected = 'gun';
  }
  if (input.wasPressed('Digit3') && player.grenades.flash > 0) selected = 'flash';
  if (input.wasPressed('Digit4') && player.grenades.smoke > 0) selected = 'smoke';
  if (input.wasPressed('Escape') && hud.buyOpen) closeBuy(true);
}

function syncCamera() {
  if (!player.alive && spectateId) {
    const target = bots.byId(spectateId);
    if (target && target.alive) {
      camera.position.set(target.pos.x, target.pos.y + 1.6, target.pos.z);
      camera.rotation.set(0, target.yaw, 0, 'YXZ');
      return;
    }
  }
  const body = player.body;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const targetFov = 74 - weapons.state.ads * 19;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.3;
    camera.updateProjectionMatrix();
  }
}

function syncHud() {
  const def = weapons.def();
  if (selected === 'gun') hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name);
  else hud.setAmmo(player.grenades[selected], 0, selected === 'flash' ? 'Flashbang' : 'Smoke');
  hud.setHealth(player.health);
  hud.setMoney(state.money.player ?? 0);
  hud.setGrenades(player.grenades.flash, player.grenades.smoke);
  const timer = state.bomb.planted ? state.bomb.timer : state.phaseTime;
  hud.setTimer(state.phase === 'matchEnd' ? 0 : timer, state.phase);
  hud.setScore(state.score.sable, state.score.warden, state.round);
  hud.setCharge(state.bomb.carrier === 'player' && !state.bomb.planted && player.alive);
  const mates = bots.bots.filter((b) => b.team === 'sable').map((b) => ({ x: b.pos.x, z: b.pos.z, alive: b.alive }));
  hud.drawMinimap(
    { x: player.body.position.x, z: player.body.position.z, yaw: player.body.yaw },
    mates,
    state.bomb,
  );
  // Flash overlay decays from its peak over the blind window.
  if (state.simTime < player.flashUntil) {
    const total = 0.5 + player.flashPeak * 2.2;
    const remain = (player.flashUntil - state.simTime) / total;
    hud.setFlash(player.flashPeak * remain);
  } else if (player.flashPeak > 0) {
    player.flashPeak = 0;
    hud.setFlash(0);
  }
  // Context hint: planting, or the buy menu while the buy phase runs.
  const site = world.siteAt(player.body.position.x, player.body.position.z);
  if (player.alive && state.phase === 'live' && !state.bomb.planted && state.bomb.carrier === 'player' && site) {
    hud.setHint('Hold <kbd>F</kbd> to plant the charge at Site ' + site);
  } else if (player.alive && state.phase === 'buy' && !hud.buyOpen) {
    hud.setHint('Press <kbd>B</kbd> to buy — round starts in ' + Math.ceil(state.phaseTime) + 's');
  } else {
    hud.hideHint();
  }
  if (state.bomb.planted) {
    bombLight.intensity = Math.sin(state.simTime * 7) > 0 ? 2.5 : 0.3;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused && started) {
    handleDiscreteKeys();
    const look = input.takeLook();
    if (input.state.locked && player.alive) playerBody.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = player.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(clamp(dy / length, -1, 1));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function restartMatch() {
  for (const id of ['player', 'rook', 'vesper', 'bram', 'onyx', 'fenn']) {
    state.money[id] = ECONOMY.start;
    state.kills[id] = 0;
    state.deaths[id] = 0;
  }
  player.primary = null;
  player.kevlar = false;
  hud.setArmor(false);
  for (const bot of bots.bots) {
    bot.weapon = bot.id === 'rook' || bot.id === 'bram' ? 'vk47' : bot.id === 'vesper' || bot.id === 'onyx' ? 'kestrel' : 'm870';
    bot.kevlar = false;
  }
  rounds.startMatch();
}

function runShot(name) {
  started = true;
  hud.hideOverlay();
  restartMatch();
  if (name === 'start') {
    settle(30);
    playerBody.look(0, 0);
    hud.showOverlay('start');
  } else if (name === 'buy') {
    settle(30);
    hud.showBuy(buyItems(), state.money.player);
  } else if (name === 'play') {
    state.phase = 'live';
    state.phaseTime = 87;
    player.body.position.set(0, 0, 8);
    player.body.yaw = 0;
    player.body.pitch = 0;
    const bram = bots.byId('bram');
    bram.pos.set(1.5, 0, -6);
    bram.yaw = Math.PI;
    bram.state = 'hold';
    bram.holdYaw = Math.PI;
    bram.holdUntil = state.simTime + 60;
    settle(10);
    aimPoint.set(1.5, 1.2, -6);
    aimAt(aimPoint);
    playerShoot();
    settle(1);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  } else if (name === 'end') {
    state.score.sable = 5;
    state.score.warden = 3;
    state.round = 8;
    state.phase = 'matchEnd';
    state.matchWinner = 'sable';
    hud.setCharge(false);
    player.body.position.set(-10, 0, -8);
    aimPoint.set(-16, 1.2, -16);
    aimAt(aimPoint);
    settle(5);
    hud.showOverlay('end', { copy: 'Sable takes the match 5 – 3. Yard 7 is yours — play again to run it back.' });
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Clicking the canvas re-locks the pointer after the buy menu auto-closed at round start.
renderer.domElement.addEventListener('click', () => {
  if (started && !input.state.locked && !hud.buyOpen && state.phase !== 'matchEnd' && !shot) {
    input.requestLock();
  }
});

// Scripted play-test hooks: live state and choreography helpers. The game never reads these.
window.__sable = {
  state,
  player,
  bots,
  rounds,
  weapons,
  grenades,
  world,
  hud,
  input,
  get simTime() {
    return state.simTime;
  },
  getBot(id) {
    return bots.byId(id);
  },
  setMoney(n) {
    state.money.player = n;
    hud.setMoney(n);
  },
  blindBot(id, seconds) {
    const bot = bots.byId(id);
    if (bot) bots.blind(bot, state.simTime + seconds, 1);
  },
  unblindBot(id) {
    const bot = bots.byId(id);
    if (bot) {
      bot.blindUntil = 0;
      bot.blindStrength = 0;
    }
  },
  teleportBot(id, x, z, yaw) {
    const bot = bots.byId(id);
    if (!bot) return;
    bot.pos.set(x, 0, z);
    bot.vel.set(0, 0, 0);
    if (yaw !== undefined) bot.yaw = yaw;
    bot.state = 'hold';
    bot.holdYaw = bot.yaw;
    bot.holdUntil = state.simTime + 120;
    bot.target = null;
    bot.mesh.group.position.copy(bot.pos);
    bot.mesh.group.rotation.y = bot.yaw;
  },
  teleportPlayer(x, z, yaw) {
    player.body.position.set(x, 0, z);
    player.body.velocity.set(0, 0, 0);
    if (yaw !== undefined) player.body.yaw = yaw;
    player.body.pitch = 0;
    syncCamera();
  },
  damagePlayer(n) {
    damageEntity(player, n, false, bots.byId('bram'));
  },
  healPlayer() {
    player.health = 100;
    player.alive = true;
  },
  forceLive() {
    state.phase = 'live';
    state.phaseTime = ROUND.liveSeconds;
    if (hud.buyOpen) hud.hideBuy();
  },
  forceBuy() {
    state.phase = 'buy';
    state.phaseTime = ROUND.buySeconds;
  },
  plantAt(site) {
    const sitePos = SITES[site];
    this.teleportPlayer(sitePos.x, sitePos.z, 0);
  },
  buyItem(id) {
    buyItem(id);
  },
  shootOnce() {
    if (player.alive && state.phase === 'live') playerShoot();
  },
  clearSounds() {
    sounds.length = 0;
  },
};

syncCamera();
if (shot) runShot(shot);
else {
  restartMatch();
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
