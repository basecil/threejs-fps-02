// Keyboard and mouse, and the pointer lock that turns the mouse into look.
//
// Pointer-lock warp guard: engaging pointer lock can deliver one huge synthetic mousemove
// as the cursor snaps to the centre. On every lock acquisition the look accumulator is
// reset and the first mousemove after the lock is discarded, so the view never jumps.

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, pressed, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };
  let discardNextMove = false;

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    if (discardNextMove) {
      discardNextMove = false;
      return;
    }
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked && !state.locked) {
      state.lookX = 0;
      state.lookY = 0;
      discardNextMove = true;
    }
    state.locked = locked;
    if (!locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(locked);
  });

  return {
    state,
    requestLock() {
      try {
        const result = canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // No user gesture yet: the play button click will lock instead.
      }
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Edge-triggered keys, consumed once per simulation step by the caller.
    wasPressed(code) {
      return pressed.has(code);
    },
    endStep() {
      pressed.clear();
    },
  };
}
