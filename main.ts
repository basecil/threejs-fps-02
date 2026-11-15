// SABLE LINE — hand-in program for the threejs-fps-02 bounty (Node 22, stdlib only).
// The game lives in game/ beside this file as plain static files: ES modules the browser
// loads with three.js from an import map, no build step, no network request. This program
// copies game/ and screenshots/ into the grader's /output and writes /output/dossier.json,
// the summary the judge reads, using the kit's vendored library.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The gate's own caps (reference/gate.json): the text cap shapes the dossier's bytes, the
// rest refuse an entry the scorer would refuse — at most 4 screenshots, each at most 256 KiB;
// game/ at most 993 files and 48 MiB in all, sharing /output's 1000-entry cap with the
// screenshots and the dossier itself.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
