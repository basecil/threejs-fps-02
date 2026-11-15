// The five bots: Rook and Vesper beside the player on Sable, Bram, Onyx and Fenn holding
// the sites for the Warden. Each bot runs a small state machine — route, hold, engage,
// investigate, search, plant, defuse — over the waypoint graph, with staggered perception:
// a vision cone plus line-of-sight plus smoke blocking, hearing of gunshots, and a
// 0.3–0.6 s reaction delay before the first shot. Targets are compared by entity identity
// (kind plus reference), never by rebuilt wrappers, so a reaction timer is never reset by
// seeing the same enemy twice.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { SITES } from './world.js';
import { angleDelta, clamp, dist2 } from './util.js';

const EYE = 1.5;
const CHEST = 1.2;
const HEIGHT = 1.72;
const RADIUS = 0.34;
const WALK = 4.3;
const PERCEIVE_GAP = 0.12;
const VISION_RANGE = 42;
const VISION_HALF_ANGLE = 0.96; // ~55 degrees each way
const LOST_SECONDS = 2.5;

const ROSTER = [
  { id: 'rook', name: 'Rook', team: 'sable', weapon: 'vk47', skill: 1.0 },
  { id: 'vesper', name: 'Vesper', team: 'sable', weapon: 'kestrel', skill: 1.15 },
  { id: 'bram', name: 'Bram', team: 'warden', weapon: 'vk47', skill: 1.0 },
  { id: 'onyx', name: 'Onyx', team: 'warden', weapon: 'kestrel', skill: 1.1 },
  { id: 'fenn', name: 'Fenn', team: 'warden', weapon: 'm870', skill: 1.25 },
];

export function createBots(scene, world, ctx) {
  const teamMat = {
    sable: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sable), roughness: 0.7 }),
    warden: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.warden), roughness: 0.7 }),
  };
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.68, 0.3);
  const headGeo = new THREE.BoxGeometry(0.27, 0.27, 0.27);
  const bandGeo = new THREE.BoxGeometry(0.29, 0.09, 0.29);
  const legGeo = new THREE.BoxGeometry(0.17, 0.72, 0.2);
  const armGeo = new THREE.BoxGeometry(0.13, 0.6, 0.15);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.55);

  const bots = [];
  const hitMeshes = [];
  const eyePos = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const targetPos = new THREE.Vector3();

  function buildMesh(bot) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, teamMat[bot.team]);
    torso.position.y = 1.08;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    head.userData.part = 'head';
    const band = new THREE.Mesh(bandGeo, teamMat[bot.team]);
    band.position.y = 1.68;
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.12, 0.36, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.12, 0.36, 0);
    const armL = new THREE.Mesh(armGeo, teamMat[bot.team]);
    armL.position.set(-0.34, 1.1, -0.08);
    armL.rotation.x = -0.7;
    const armR = new THREE.Mesh(armGeo, teamMat[bot.team]);
    armR.position.set(0.34, 1.1, -0.08);
    armR.rotation.x = -0.7;
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.14, 1.28, -0.35);
    group.add(torso, head, band, legL, legR, armL, armR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    torso.userData.entity = bot;
    head.userData.entity = bot;
    hitMeshes.push(torso, head);
    return { group, torso, head };
  }

  for (let i = 0; i < ROSTER.length; i += 1) {
    const spec = ROSTER[i];
    const bot = {
      ...spec,
      kind: 'bot',
      health: 100,
      alive: true,
      kevlar: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      onGround: true,
      yaw: 0,
      pitch: 0,
      state: 'hold',
      path: [],
      pathCursor: 0,
      goalX: 0,
      goalZ: 0,
      objective: null,
      target: null,
      targetX: 0,
      targetZ: 0,
      lastSeenAt: 0,
      reactionAt: 0,
      nextPerceive: i * 0.024,
      burstLeft: 0,
      nextShotAt: 0,
      nextBurstAt: 0,
      strafeDir: 1,
      strafeUntil: 0,
      blindUntil: 0,
      blindStrength: 0,
      holdYaw: 0,
      holdUntil: 0,
      channel: null, // { kind: 'plant'|'defuse', progress, seconds }
      fall: 0,
      index: i,
    };
    bot.mesh = buildMesh(bot);
    // world.moveBox drives bodies through .position/.velocity; alias the bot's own
    // .pos/.vel vectors so the mover and the brain share one position.
    bot.position = bot.pos;
    bot.velocity = bot.vel;
    bots.push(bot);
  }

  function byId(id) {
    return bots.find((b) => b.id === id) ?? null;
  }

  function enemiesOf(bot) {
    const list = [];
    const player = ctx.getPlayer();
    if (player.alive && player.team !== bot.team) list.push(player);
    for (const other of bots) {
      if (other.alive && other.team !== bot.team) list.push(other);
    }
    return list;
  }

  function canSee(bot, enemy, simTime) {
    if (simTime < bot.blindUntil) return false;
    const ex = enemy.kind === 'player' ? enemy.body.position.x : enemy.pos.x;
    const ez = enemy.kind === 'player' ? enemy.body.position.z : enemy.pos.z;
    const ey = enemy.kind === 'player' ? enemy.body.position.y + enemy.body.eye * 0.8 : CHEST;
    const dx = ex - bot.pos.x;
    const dz = ez - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VISION_RANGE) return false;
    const facing = -Math.sin(bot.yaw) * dx + -Math.cos(bot.yaw) * dz;
    const angle = Math.acos(clamp(facing / (dist || 1), -1, 1));
    if (angle > VISION_HALF_ANGLE) return false;
    if (!world.hasLineOfSight(bot.pos.x, EYE, bot.pos.z, ex, ey, ez)) return false;
    if (ctx.grenades.smokeBlocks(bot.pos.x, EYE, bot.pos.z, ex, ey, ez)) return false;
    return true;
  }

  function perceive(bot, simTime) {
    const enemies = enemiesOf(bot);
    let seen = null;
    let seenDist = Infinity;
    for (const enemy of enemies) {
      const ex = enemy.kind === 'player' ? enemy.body.position.x : enemy.pos.x;
      const ez = enemy.kind === 'player' ? enemy.body.position.z : enemy.pos.z;
      if (!canSee(bot, enemy, simTime)) continue;
      const d = dist2(bot.pos.x, bot.pos.z, ex, ez);
      if (d < seenDist) {
        seenDist = d;
        seen = enemy;
      }
    }
    if (seen) {
      // Identity compare: a new target restarts the reaction timer; the same one never does.
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reactionAt = simTime + 0.3 + ctx.rng() * 0.3;
      }
      bot.targetX = seen.kind === 'player' ? seen.body.position.x : seen.pos.x;
      bot.targetZ = seen.kind === 'player' ? seen.body.position.z : seen.pos.z;
      bot.lastSeenAt = simTime;
      if (bot.state !== 'engage' && bot.state !== 'defuse') bot.state = 'engage';
      return;
    }
    // Hearing: a recent loud sound nearby pulls the bot to investigate.
    if (bot.state === 'route' || bot.state === 'hold') {
      for (const sound of ctx.sounds) {
        if (simTime - sound.time > 1.2) continue;
        if (dist2(bot.pos.x, bot.pos.z, sound.x, sound.z) < sound.radius) {
          bot.state = 'investigate';
          bot.goalX = sound.x;
          bot.goalZ = sound.z;
          setPath(bot, sound.x, sound.z);
          break;
        }
      }
    }
  }

  function setPath(bot, x, z) {
    const found = world.findPath(bot.pos.x, bot.pos.z, x, z);
    bot.path = found.slice();
    bot.pathCursor = 0;
    bot.goalX = x;
    bot.goalZ = z;
  }

  function followPath(bot, dt, speed) {
    let tx = bot.goalX;
    let tz = bot.goalZ;
    if (bot.pathCursor < bot.path.length) {
      const node = world.waypoints[bot.path[bot.pathCursor]];
      tx = node[0];
      tz = node[1];
      if (dist2(bot.pos.x, bot.pos.z, tx, tz) < 1.1) {
        bot.pathCursor += 1;
        return followPath(bot, dt, speed);
      }
    }
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      bot.vel.x = 0;
      bot.vel.z = 0;
      return true;
    }
    bot.vel.x = (dx / dist) * speed;
    bot.vel.z = (dz / dist) * speed;
    const wantYaw = Math.atan2(-dx, -dz);
    bot.yaw += angleDelta(bot.yaw, wantYaw) * Math.min(1, dt * 8);
    world.moveBox(bot, dt, HEIGHT, RADIUS);
    return false;
  }

  function faceTarget(bot, dt) {
    const dx = bot.targetX - bot.pos.x;
    const dz = bot.targetZ - bot.pos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    bot.yaw += angleDelta(bot.yaw, wantYaw) * Math.min(1, dt * 10);
  }

  function tryShoot(bot, simTime) {
    if (!bot.target || !bot.target.alive) return;
    if (simTime < bot.reactionAt) return;
    if (simTime < bot.blindUntil) return;
    const ex = bot.target.kind === 'player' ? bot.target.body.position.x : bot.target.pos.x;
    const ez = bot.target.kind === 'player' ? bot.target.body.position.z : bot.target.pos.z;
    const ey = bot.target.kind === 'player' ? bot.target.body.position.y + bot.target.body.eye * 0.8 : CHEST;
    if (!world.hasLineOfSight(bot.pos.x, EYE, bot.pos.z, ex, ey, ez)) return;
    if (ctx.grenades.smokeBlocks(bot.pos.x, EYE, bot.pos.z, ex, ey, ez)) return;
    if (simTime < bot.nextBurstAt) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(ctx.rng() * 3);
      bot.nextBurstAt = simTime + 0.5 + ctx.rng() * 0.4;
    }
    if (simTime < bot.nextShotAt) return;
    const def = WEAPONS[bot.weapon];
    bot.nextShotAt = simTime + def.gap + 0.02;
    bot.burstLeft -= 1;
    // Aim error grows with range; skill scales it down. Shotguns fire every pellet.
    const dist = dist2(bot.pos.x, bot.pos.z, ex, ez);
    const error = (0.012 + dist * 0.0011) * bot.skill;
    eyePos.set(bot.pos.x, EYE, bot.pos.z);
    targetPos.set(ex, ey, ez);
    for (let pellet = 0; pellet < def.pellets; pellet += 1) {
      shotDir.subVectors(targetPos, eyePos).normalize();
      shotDir.x += (ctx.rng() * 2 - 1) * error;
      shotDir.y += (ctx.rng() * 2 - 1) * error;
      shotDir.z += (ctx.rng() * 2 - 1) * error;
      shotDir.normalize();
      ctx.fireHitscan(eyePos, shotDir, def, bot);
    }
  }

  function stepBot(bot, dt, simTime) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.mesh.group.rotation.x = -bot.fall * 1.5;
      return;
    }
    // Bots only play while the round is live: they hold their spawns through the buy phase
    // and freeze the moment a round ends.
    if (ctx.state.phase !== 'live') {
      bot.mesh.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.mesh.group.rotation.y = bot.yaw;
      return;
    }
    if (simTime >= bot.nextPerceive) {
      bot.nextPerceive = simTime + PERCEIVE_GAP;
      perceive(bot, simTime);
    }
    if (bot.target && (!bot.target.alive || simTime - bot.lastSeenAt > LOST_SECONDS)) {
      if (bot.state === 'engage') {
        bot.state = 'search';
        setPath(bot, bot.targetX, bot.targetZ);
      }
      bot.target = null;
    }
    const blind = simTime < bot.blindUntil;
    switch (bot.state) {
      case 'route': {
        if (followPath(bot, dt, WALK)) {
          if (bot.objective === 'plant' && ctx.state.bomb.carrier === bot.id) {
            bot.state = 'plant';
            bot.channel = { kind: 'plant', progress: 0, seconds: 3 };
          } else {
            bot.state = 'hold';
            bot.holdYaw = bot.yaw;
            bot.holdUntil = simTime + 6;
          }
        }
        break;
      }
      case 'hold': {
        bot.vel.x = 0;
        bot.vel.z = 0;
        // A carrier that reaches its site plants; a carrier holding elsewhere runs for it.
        if (bot.team === 'sable' && ctx.state.bomb.carrier === bot.id && !ctx.state.bomb.planted) {
          if (world.siteAt(bot.pos.x, bot.pos.z)) {
            bot.state = 'plant';
            bot.channel = { kind: 'plant', progress: 0, seconds: 3 };
            break;
          }
          bot.state = 'route';
          setPath(bot, bot.goalX, bot.goalZ);
          break;
        }
        // Scan slowly; defenders watch their site, attackers watch the lane they came up.
        bot.yaw = bot.holdYaw + Math.sin(simTime * 0.45 + bot.index * 2.1) * 0.6;
        if (simTime > bot.holdUntil && bot.team === 'sable' && !ctx.state.bomb.planted) {
          bot.state = 'route';
          setPath(bot, bot.goalX, bot.goalZ);
        }
        break;
      }
      case 'engage': {
        faceTarget(bot, dt);
        if (!blind) {
          // Strafe: pick a side every second or so, keep moving while shooting.
          if (simTime > bot.strafeUntil) {
            bot.strafeDir = ctx.rng() < 0.5 ? -1 : 1;
            bot.strafeUntil = simTime + 0.7 + ctx.rng() * 0.8;
          }
          const sin = Math.sin(bot.yaw);
          const cos = Math.cos(bot.yaw);
          bot.vel.x = cos * bot.strafeDir * 1.6;
          bot.vel.z = -sin * bot.strafeDir * 1.6;
          world.moveBox(bot, dt, HEIGHT, RADIUS);
          tryShoot(bot, simTime);
        }
        break;
      }
      case 'investigate': {
        if (followPath(bot, dt, WALK)) {
          bot.state = 'hold';
          bot.holdYaw = bot.yaw;
          bot.holdUntil = simTime + 3;
        }
        break;
      }
      case 'search': {
        if (followPath(bot, dt, WALK)) {
          bot.state = 'hold';
          bot.holdYaw = bot.yaw;
          bot.holdUntil = simTime + 2;
        }
        break;
      }
      case 'plant': {
        bot.vel.x = 0;
        bot.vel.z = 0;
        if (ctx.state.bomb.planted) {
          bot.state = 'hold';
          bot.channel = null;
          break;
        }
        bot.channel.progress += dt;
        if (bot.channel.progress >= bot.channel.seconds) {
          ctx.onPlant(world.siteAt(bot.pos.x, bot.pos.z) || 'A', bot);
          bot.channel = null;
          bot.state = 'hold';
        }
        break;
      }
      case 'defuse': {
        const bomb = ctx.state.bomb;
        if (!bomb.planted) {
          bot.state = 'hold';
          bot.channel = null;
          break;
        }
        const d = dist2(bot.pos.x, bot.pos.z, bomb.x, bomb.z);
        if (d > 2.2) {
          followPath(bot, dt, WALK + 0.6);
          break;
        }
        bot.vel.x = 0;
        bot.vel.z = 0;
        if (!bot.channel) bot.channel = { kind: 'defuse', progress: 0, seconds: 5 };
        bot.channel.progress += dt;
        if (bot.channel.progress >= bot.channel.seconds) {
          ctx.onDefuse(bot);
          bot.channel = null;
          bot.state = 'hold';
        }
        break;
      }
      default:
        break;
    }
    bot.mesh.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.mesh.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    hitMeshes,
    byId,
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
    blind(bot, until, strength) {
      // A new flash never shortens a blind already in force: take the longer one.
      // (Overwriting here let one flashbang cancel a much longer blind.)
      bot.blindUntil = Math.max(bot.blindUntil, until);
      bot.blindStrength = Math.max(bot.blindStrength, strength);
      if (bot.state === 'engage') bot.state = 'hold';
    },
    // Round setup: attackers pick a site each and run for it; defenders split across the
    // sites and mid. Called fresh every round from the spawn table.
    planRound(spawns) {
      const sableSites = ctx.rng() < 0.5 ? ['A', 'B'] : ['B', 'A'];
      const spawnIndex = { rook: 1, vesper: 2, bram: 0, onyx: 1, fenn: 2 };
      let sableIndex = 0;
      for (const bot of bots) {
        bot.health = 100;
        bot.alive = true;
        bot.fall = 0;
        bot.target = null;
        bot.channel = null;
        bot.blindUntil = 0;
        bot.blindStrength = 0;
        bot.burstLeft = 0;
        bot.nextShotAt = 0;
        bot.nextBurstAt = 0;
        bot.mesh.group.rotation.set(0, 0, 0);
        bot.mesh.group.visible = true;
        const spawn = spawns[bot.team][spawnIndex[bot.id]];
        bot.pos.set(spawn.x, 0, spawn.z);
        bot.vel.set(0, 0, 0);
        bot.yaw = spawn.yaw;
        bot.mesh.group.position.copy(bot.pos);
        bot.mesh.group.rotation.y = bot.yaw;
        if (bot.team === 'sable') {
          const site = SITES[sableSites[sableIndex % 2]];
          sableIndex += 1;
          bot.objective = 'plant';
          bot.goalX = site.x;
          bot.goalZ = site.z;
          setPath(bot, site.x, site.z);
          bot.state = 'route';
        } else {
          const holdSpots = { bram: [-13, -13], onyx: [13, -13], fenn: [0, -6] };
          const [hx, hz] = holdSpots[bot.id];
          bot.objective = 'defend';
          bot.goalX = hx;
          bot.goalZ = hz;
          setPath(bot, hx, hz);
          bot.state = 'route';
        }
      }
    },
    // The bomb is down: every living defender runs for it; the nearest defuses, the rest
    // take covering positions around the site.
    onBombPlanted() {
      const bomb = ctx.state.bomb;
      let nearest = null;
      let nearestD = Infinity;
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'warden') continue;
        const d = dist2(bot.pos.x, bot.pos.z, bomb.x, bomb.z);
        if (d < nearestD) {
          nearestD = d;
          nearest = bot;
        }
      }
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'warden') continue;
        bot.channel = null;
        if (bot === nearest) {
          bot.state = 'defuse';
          setPath(bot, bomb.x, bomb.z);
        } else {
          bot.state = 'route';
          bot.objective = 'cover';
          bot.goalX = bomb.x + (bot.id === 'onyx' ? 4 : -4);
          bot.goalZ = bomb.z + 4;
          setPath(bot, bot.goalX, bot.goalZ);
        }
      }
    },
    step(dt, simTime) {
      for (const bot of bots) stepBot(bot, dt, simTime);
    },
  };
}
