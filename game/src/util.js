// Small shared math: a seedable random stream, clamps, angles and a breadth-first search
// over the waypoint graph. No allocations in the hot paths that use these.

export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest turn between two headings, in (-PI, PI].
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Breadth-first search over an adjacency list. `out` is filled with node indices from the
// node after `start` through `goal` (empty when start === goal or no route exists). The
// caller reuses the same arrays across calls; nothing is allocated here.
export function bfsPath(adjacency, start, goal, out, seen, queue, parent) {
  out.length = 0;
  if (start === goal) return out;
  for (let i = 0; i < adjacency.length; i += 1) seen[i] = 0;
  queue.length = 0;
  queue.push(start);
  seen[start] = 1;
  parent[start] = -1;
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    if (node === goal) {
      found = true;
      break;
    }
    const neighbours = adjacency[node];
    for (let i = 0; i < neighbours.length; i += 1) {
      const next = neighbours[i];
      if (!seen[next]) {
        seen[next] = 1;
        parent[next] = node;
        queue.push(next);
      }
    }
  }
  if (!found) return out;
  let node = goal;
  const reversed = [];
  while (node !== start && node !== -1) {
    reversed.push(node);
    node = parent[node];
  }
  for (let i = reversed.length - 1; i >= 0; i -= 1) out.push(reversed[i]);
  return out;
}
