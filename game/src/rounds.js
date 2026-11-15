// The round machine: buy phase, live round, round end, match end. It owns the timers, the
// scores and the economy, and calls hooks when the phase changes so main.js can reset
// positions and loadouts. A round ends by elimination, by the charge detonating or being
// defused, or by the clock — with the charge planted, the clock no longer ends the round.

import { ECONOMY, ROUND } from './state.js';

export function createRounds(state, hooks) {
  function payRound(winner) {
    for (const id of Object.keys(state.money)) {
      const team = hooks.teamOf(id);
      const amount = team === winner ? ECONOMY.win : ECONOMY.loss;
      state.money[id] = Math.min(ECONOMY.maxMoney, (state.money[id] ?? 0) + amount);
    }
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.score[winner] += 1;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.phase = 'roundEnd';
    state.phaseTime = ROUND.endPauseSeconds;
    payRound(winner);
    hooks.onRoundEnd(winner, reason);
    if (state.score[winner] >= ROUND.winScore) {
      state.matchWinner = winner;
    }
  }

  function nextRound() {
    if (state.matchWinner) {
      state.phase = 'matchEnd';
      hooks.onMatchEnd(state.matchWinner);
      return;
    }
    state.round += 1;
    state.phase = 'buy';
    state.phaseTime = ROUND.buySeconds;
    state.roundWinner = null;
    state.roundReason = '';
    state.bomb.planted = false;
    state.bomb.site = null;
    state.bomb.timer = 0;
    state.bomb.carrier = 'player';
    hooks.onRoundStart(state.round);
  }

  return {
    endRound,
    nextRound,
    plant(site, x, z) {
      if (state.phase !== 'live' || state.bomb.planted) return false;
      state.bomb.planted = true;
      state.bomb.site = site;
      state.bomb.x = x;
      state.bomb.z = z;
      state.bomb.timer = ROUND.bombSeconds;
      hooks.onBombPlanted(site);
      return true;
    },
    defuse() {
      if (!state.bomb.planted) return false;
      state.bomb.planted = false;
      endRound('warden', 'Charge defused');
      return true;
    },
    // A kill pays the killer and may end the round by elimination. With the charge planted
    // and the attackers wiped out, the round runs on: the defenders still have to defuse.
    onKill(killerId, victimTeam, alive) {
      if (killerId && state.money[killerId] !== undefined) {
        state.money[killerId] = Math.min(ECONOMY.maxMoney, state.money[killerId] + ECONOMY.kill);
      }
      if (state.phase !== 'live') return;
      if (alive.sable === 0 && alive.warden === 0) {
        endRound('warden', 'Both teams eliminated');
      } else if (alive.warden === 0) {
        endRound('sable', 'Warden eliminated');
      } else if (alive.sable === 0 && !state.bomb.planted) {
        endRound('warden', 'Sable eliminated');
      }
    },
    step(dt) {
      if (state.phase === 'buy') {
        state.phaseTime -= dt;
        if (state.phaseTime <= 0) {
          state.phase = 'live';
          state.phaseTime = ROUND.liveSeconds;
          hooks.onPhase('live');
        }
        return;
      }
      if (state.phase === 'live') {
        if (state.bomb.planted) {
          state.bomb.timer -= dt;
          hooks.onBombTick(state.bomb.timer);
          if (state.bomb.timer <= 0) {
            state.bomb.planted = false;
            endRound('sable', 'Charge detonated');
          }
          return;
        }
        state.phaseTime -= dt;
        if (state.phaseTime <= 0) endRound('warden', 'Time expired');
        return;
      }
      if (state.phase === 'roundEnd') {
        state.phaseTime -= dt;
        if (state.phaseTime <= 0) nextRound();
      }
    },
    startMatch() {
      state.phase = 'buy';
      state.phaseTime = ROUND.buySeconds;
      state.round = 1;
      state.score.sable = 0;
      state.score.warden = 0;
      state.roundWinner = null;
      state.roundReason = '';
      state.matchWinner = null;
      state.bomb.planted = false;
      state.bomb.site = null;
      state.bomb.timer = 0;
      state.bomb.carrier = 'player';
      state.feed.length = 0;
      hooks.onRoundStart(1);
    },
  };
}
