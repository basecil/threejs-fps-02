// The DOM HUD: health, armour, ammo, money, timer, score, minimap, kill feed, buy menu and
// the overlays. It never touches the simulation; main.js pushes numbers in and reads the
// play and buy callbacks out. The minimap never shows enemies — only the player, teammates
// and the planted charge.

import { MAP_HALF, SITES } from './world.js';

const COPY = {
  start: {
    title: 'SABLE <em>LINE</em>',
    copy: 'A round-based tactical FPS. You are Sable, attacking Yard 7 with Rook and Vesper against Bram, Onyx and Fenn of the Warden. First to 5 rounds — eliminate them, or plant the charge and hold the site.',
    action: 'Click to play',
  },
  paused: {
    title: 'SABLE <em>LINE</em>',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(world, callbacks) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoBox = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const armorTag = $('armor-tag');
  const moneyEl = $('money');
  const grenadeFlash = $('grenade-flash');
  const grenadeSmoke = $('grenade-smoke');
  const timerVal = $('timer-val');
  const roundLabel = $('round-label');
  const scoreSable = $('score-sable');
  const scoreWarden = $('score-warden');
  const scoreMid = $('score-mid');
  const objectiveEl = $('objective');
  const dmgdir = $('dmgdir');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombBox = $('bomb');
  const bombLabel = $('bomb-label');
  const bombFill = $('bomb-fill');
  const plantBox = $('plant');
  const plantLabel = $('plant-label');
  const plantFill = $('plant-fill');
  const hint = $('hint');
  const charge = $('charge');
  const flashEl = $('flash');
  const damageEl = $('damage');
  const buyBox = $('buy');
  const buyMoney = $('buy-money');
  const buyRows = $('buy-rows');
  const buyClose = $('buy-close');
  const hitmarker = $('hitmarker');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');

  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastObjective = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let dmgdirTimer = 0;
  let buyOpen = false;

  play.addEventListener('click', () => callbacks.onPlay());
  buyClose.addEventListener('click', () => callbacks.onBuyClose());

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function drawMinimap(player, teammates, bomb) {
    const size = minimap.width;
    const scale = size / (MAP_HALF * 2);
    const toX = (x) => (x + MAP_HALF) * scale;
    const toZ = (z) => (z + MAP_HALF) * scale;
    mapCtx.fillStyle = '#10151c';
    mapCtx.fillRect(0, 0, size, size);
    mapCtx.fillStyle = '#2b3644';
    for (const box of world.colliders) {
      const w = (box.max.x - box.min.x) * scale;
      const d = (box.max.z - box.min.z) * scale;
      const h = box.max.y - box.min.y;
      if (h < 0.5) continue; // the ground slab is the background, not a wall
      mapCtx.fillRect(toX(box.min.x), toZ(box.min.z), Math.max(1, w), Math.max(1, d));
    }
    mapCtx.fillStyle = '#3fb8a6';
    mapCtx.fillRect(toX(SITES.A.x - 3), toZ(SITES.A.z - 3), 6 * scale, 6 * scale);
    mapCtx.fillStyle = '#e0683a';
    mapCtx.fillRect(toX(SITES.B.x - 3), toZ(SITES.B.z - 3), 6 * scale, 6 * scale);
    if (bomb && bomb.planted) {
      mapCtx.fillStyle = '#e0483e';
      mapCtx.beginPath();
      mapCtx.arc(toX(bomb.x), toZ(bomb.z), 5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const mate of teammates) {
      if (!mate.alive) continue;
      mapCtx.fillStyle = '#3fb8a6';
      mapCtx.beginPath();
      mapCtx.arc(toX(mate.x), toZ(mate.z), 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // The player's arrow: canvas rotation is minus yaw (north is up, yaw 0 faces north).
    mapCtx.save();
    mapCtx.translate(toX(player.x), toZ(player.z));
    mapCtx.rotate(-player.yaw);
    mapCtx.fillStyle = '#ece5d8';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -7);
    mapCtx.lineTo(5, 5);
    mapCtx.lineTo(-5, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  return {
    get buyOpen() {
      return buyOpen;
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      if (hp === lastHealth) return;
      lastHealth = hp;
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthNum.classList.toggle('low', hp <= 30);
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
    },
    setArmor(has) {
      armorTag.textContent = has ? '◆ Kevlar' : '';
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyEl.textContent = `$${value}`;
      if (buyOpen) buyMoney.textContent = `Money $${value}`;
    },
    setGrenades(flash, smoke) {
      grenadeFlash.textContent = String(flash);
      grenadeSmoke.textContent = String(smoke);
    },
    setTimer(seconds, phase) {
      const text = formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerVal.textContent = text;
      timerVal.classList.toggle('low', seconds <= 10 && phase === 'live');
      roundLabel.textContent = phase === 'buy' ? 'Buy phase' : phase === 'live' ? 'Round live' : phase === 'roundEnd' ? 'Round over' : 'Match over';
    },
    setScore(sable, warden, round) {
      const text = `${sable}-${warden} R${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreSable.textContent = `SABLE ${sable}`;
      scoreWarden.textContent = `${warden} WARDEN`;
      scoreMid.textContent = `R${round}`;
    },
    // One line under the scoreboard naming the current objective; empty hides it.
    setObjective(html) {
      if (html === lastObjective) return;
      lastObjective = html;
      objectiveEl.hidden = html === '';
      objectiveEl.innerHTML = html;
    },
    setBomb(timer, total) {
      bombBox.hidden = false;
      bombLabel.textContent = `Charge planted — ${Math.max(0, timer).toFixed(1)}`;
      bombFill.style.width = `${Math.max(0, (timer / total) * 100)}%`;
    },
    hideBomb() {
      bombBox.hidden = true;
    },
    setPlant(progress, label) {
      plantBox.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
    },
    hidePlant() {
      plantBox.hidden = true;
    },
    setHint(html) {
      hint.hidden = false;
      hint.innerHTML = html;
    },
    hideHint() {
      hint.hidden = true;
    },
    setCharge(carrying) {
      charge.hidden = !carrying;
    },
    killfeedAdd(entry) {
      const div = document.createElement('div');
      const killerClass = entry.killerTeam === 'sable' ? 'sable' : 'warden';
      const victimClass = entry.victimTeam === 'sable' ? 'sable' : 'warden';
      div.innerHTML = `<span class="${killerClass}">${entry.killer}</span> ▸ <span class="${victimClass}">${entry.victim}</span>${entry.headshot ? ' ◎' : ''}`;
      killfeed.prepend(div);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => div.remove(), 6000);
    },
    banner(titleText, subText, ms = 2500) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.classList.remove('kill');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    // A red arc around the crosshair pointing toward whoever just shot the player.
    // angleRad is 0 when the attacker is straight ahead, positive to the right.
    showDamageDirection(angleRad) {
      dmgdir.style.transform = `translate(-50%, -50%) rotate(${angleRad * (180 / Math.PI)}deg)`;
      dmgdir.classList.add('on');
      clearTimeout(dmgdirTimer);
      dmgdirTimer = setTimeout(() => dmgdir.classList.remove('on'), 900);
    },
    setFlash(opacity) {
      flashEl.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    },
    damageFlash() {
      damageEl.style.opacity = '1';
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => {
        damageEl.style.opacity = '0';
      }, 220);
    },
    showBuy(items, money) {
      buyOpen = true;
      buyBox.hidden = false;
      buyMoney.textContent = `Money $${money}`;
      buyRows.replaceChildren();
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-row';
        button.disabled = item.disabled;
        button.innerHTML = `<b>${item.name}</b><span class="desc">${item.desc}${item.owned ? ' — owned' : ''}</span><span class="price">$${item.price}</span>`;
        button.addEventListener('click', () => callbacks.onBuy(item.id));
        buyRows.appendChild(button);
      }
    },
    hideBuy() {
      buyOpen = false;
      buyBox.hidden = true;
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      title.innerHTML = text.title;
      copy.textContent = mode === 'end' && data.copy ? data.copy : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    drawMinimap,
  };
}
