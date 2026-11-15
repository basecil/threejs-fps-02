# SABLE LINE — a three.js tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made famous,
built on three.js 0.187.0 from static files with no build step and no network request.
An entry for make.fun's `threejs-fps-02` bounty.

## The game

You are Sable, attacking the dusk compound **Yard 7** with Rook and Vesper against Bram,
Onyx and Fenn of the Warden. First team to 5 rounds wins.

- **Rounds:** 15 s buy phase, then 100 s live. Win by eliminating the other team, or —
  as Sable — by planting the charge at Site A or Site B (hold F, 3 s) and holding it
  through the 35 s fuse. Defenders defuse in 5 s.
- **Economy:** $800 start, +$300 per kill, +$3000 for a round win, +$1900 for a loss.
- **Arsenal:** P9 pistol, VK-47 rifle ($2500), Kestrel-9 SMG ($1500), M870 shotgun
  ($1200, 8 pellets), flashbang ($200), smoke grenade ($300), kevlar ($650).
- **Gunplay:** hitscan with headshot multipliers, distance falloff, recoil and spread
  that punish firing on the move; crouching and aiming down sights tighten the group.
- **Bots:** a state machine (route, hold, engage, investigate, search, plant, defuse)
  over a 34-node waypoint graph with BFS pathfinding, vision cone plus line-of-sight
  plus smoke blocking, hearing, and a 0.3–0.6 s reaction delay.
- **Presentation:** synthesized WebAudio sound effects, a minimap that never shows
  enemies, kill feed, round banners, and a fixed 60 Hz simulation kept apart from
  rendering.

## Play it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Click to play: WASD to move, mouse
to look, click to fire, R to reload, B for the buy menu, 1/2 for weapons, 3/4 for
grenades, F (hold) to plant the charge.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes
`dossier.json` with the kit's `buildDossier`.

## Layout

- `game/index.html` — page shell, HUD, the one import map
- `game/src/` — one module per job: `palette`, `util`, `state`, `audio`, `input`,
  `world` (map + waypoints), `player`, `weapons`, `grenades`, `effects`, `bots`,
  `rounds`, `hud`, `main`
- `game/vendor/three/` — the kit's three.js 0.187.0 files, byte for byte
- `screenshots/` — four real renders of the game's own code
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged
- `serve.ts` — the kit's static dev server, unchanged

## License

MIT — see `LICENSE`.
