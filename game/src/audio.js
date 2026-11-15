// Every sound is synthesized with WebAudio: filtered noise bursts and short oscillators.
// No audio files, no network, nothing to load. The context is created lazily on the first
// user gesture, so autoplay policies never block the game.

const NOISE_SECONDS = 1;

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function burst({ duration, frequency, type = 'lowpass', gain = 0.5, when = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(amp).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
  }

  function tone({ frequency, end = null, duration, type = 'sine', gain = 0.3, when = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (end !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // weapon: 'pistol' | 'rifle' | 'smg' | 'shotgun'; distant shots are quieter and duller.
  function shot(weapon, distant = false) {
    const scale = distant ? 0.35 : 1;
    if (weapon === 'shotgun') {
      burst({ duration: 0.22, frequency: distant ? 500 : 900, gain: 0.8 * scale });
      tone({ frequency: 110, end: 45, duration: 0.18, type: 'triangle', gain: 0.5 * scale });
    } else if (weapon === 'rifle') {
      burst({ duration: 0.11, frequency: distant ? 700 : 1600, gain: 0.55 * scale });
      tone({ frequency: 180, end: 70, duration: 0.09, type: 'square', gain: 0.22 * scale });
    } else if (weapon === 'smg') {
      burst({ duration: 0.08, frequency: distant ? 800 : 2200, gain: 0.42 * scale });
    } else {
      burst({ duration: 0.09, frequency: distant ? 600 : 1400, gain: 0.5 * scale });
      tone({ frequency: 220, end: 90, duration: 0.07, type: 'square', gain: 0.18 * scale });
    }
  }

  return {
    unlock() {
      ensure();
    },
    shot,
    dryFire() {
      tone({ frequency: 1400, duration: 0.04, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 500, duration: 0.05, type: 'square', gain: 0.15 });
      tone({ frequency: 700, duration: 0.05, type: 'square', gain: 0.15, when: 0.18 });
    },
    hit(kill) {
      tone({ frequency: kill ? 880 : 660, duration: 0.07, type: 'sine', gain: 0.25 });
      if (kill) tone({ frequency: 1320, duration: 0.12, type: 'sine', gain: 0.25, when: 0.07 });
    },
    hurt() {
      burst({ duration: 0.12, frequency: 300, gain: 0.4 });
    },
    buy() {
      tone({ frequency: 920, duration: 0.08, type: 'sine', gain: 0.25 });
      tone({ frequency: 1380, duration: 0.12, type: 'sine', gain: 0.25, when: 0.08 });
    },
    denied() {
      tone({ frequency: 180, duration: 0.14, type: 'square', gain: 0.2 });
    },
    plantTick() {
      tone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.18 });
    },
    bombBeep(urgent) {
      tone({ frequency: urgent ? 1500 : 1000, duration: 0.09, type: 'square', gain: 0.28 });
    },
    explosion() {
      burst({ duration: 1.1, frequency: 220, gain: 0.9 });
      tone({ frequency: 60, end: 28, duration: 1.0, type: 'sine', gain: 0.8 });
    },
    flashRing() {
      tone({ frequency: 2400, duration: 0.7, type: 'sine', gain: 0.16 });
    },
    smokePop() {
      burst({ duration: 0.3, frequency: 400, gain: 0.35 });
    },
    roundWin() {
      tone({ frequency: 523, duration: 0.14, type: 'triangle', gain: 0.3 });
      tone({ frequency: 659, duration: 0.14, type: 'triangle', gain: 0.3, when: 0.14 });
      tone({ frequency: 784, duration: 0.24, type: 'triangle', gain: 0.3, when: 0.28 });
    },
    roundLoss() {
      tone({ frequency: 392, duration: 0.16, type: 'triangle', gain: 0.28 });
      tone({ frequency: 311, duration: 0.26, type: 'triangle', gain: 0.28, when: 0.16 });
    },
    footstep() {
      burst({ duration: 0.05, frequency: 250, gain: 0.08 });
    },
  };
}
