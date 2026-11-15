// The one place game state lives. Every module reads or writes this object; nothing keeps
// a second copy of a round number, a score or a wallet. Times are sim seconds.

// Economy and round rules, tuned so the first buy matters: $800 opens with a pistol and a
// grenade, a rifle needs a won round or two kills.
export const ECONOMY = {
  start: 800,
  kill: 300,
  win: 3000,
  loss: 1900,
  maxMoney: 16000,
};

export const ROUND = {
  buySeconds: 15,
  liveSeconds: 100,
  winScore: 5,
  plantSeconds: 3,
  defuseSeconds: 5,
  bombSeconds: 35,
  endPauseSeconds: 3.5,
};

export const TEAMS = {
  sable: { name: 'Sable', label: 'SABLE', attackers: true },
  warden: { name: 'Warden', label: 'WARDEN', attackers: false },
};

export function createState() {
  return {
    // 'buy' | 'live' | 'roundEnd' | 'matchEnd'
    phase: 'buy',
    round: 1,
    score: { sable: 0, warden: 0 },
    phaseTime: ROUND.buySeconds,
    simTime: 0,
    // The charge: planted at a site, ticking, or carried by a living attacker.
    bomb: {
      planted: false,
      site: null, // 'A' | 'B'
      x: 0,
      z: 0,
      timer: 0,
      carrier: 'player', // entity id carrying it while unplanted
    },
    // Per-entity wallets and loadouts, keyed by entity id.
    money: {},
    kills: {},
    deaths: {},
    // Kill feed entries, newest last: { killer, killerTeam, victim, victimTeam, headshot, time }.
    feed: [],
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    roundEndAt: 0,
  };
}
