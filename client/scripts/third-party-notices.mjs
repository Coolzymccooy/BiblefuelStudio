// Writes client/public/third-party-notices.txt from jassub's own COPYRIGHT file.
// Run after upgrading jassub:  node scripts/third-party-notices.mjs  (from client/)
//
// The Lyric video preview ships jassub's WebAssembly build, which contains
// fribidi (LGPL-2.1+), FreeType (FTL), harfbuzz, fontconfig, expat, brotli and
// libass. Their licences ask for these notices to go with the program.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jassubDir = path.join(root, 'node_modules', 'jassub');
const pkg = JSON.parse(fs.readFileSync(path.join(jassubDir, 'package.json'), 'utf8'));
const upstream = fs.readFileSync(path.join(jassubDir, 'dist', 'COPYRIGHT'), 'utf8');

// jassub 1.8.8's COPYRIGHT has one garbled entry under brotli: about 22 000
// characters of brotli's built-in dictionary taken for a copyright holder.
// No real notice line is anywhere near this long, so such lines are left out.
const MAX_LINE = 400;
const lines = upstream.split(/\r?\n/);
const kept = lines.filter((l) => l.length <= MAX_LINE);
const dropped = lines.length - kept.length;

const header = [
  'Open-source credits — BibleFuel Studio',
  '',
  'The lyric video preview uses jassub to draw the words in your browser.',
  '',
  `jassub ${pkg.version}`,
  `Licence: ${pkg.license}`,
  'Source: https://github.com/ThaUnknown/jassub',
  '',
  'jassub contains these libraries, each under its own licence, listed in full below:',
  'libass (ISC), fribidi (LGPL-2.1 or later), FreeType (FreeType Licence),',
  'harfbuzz, fontconfig, expat and brotli. The source code of each is available',
  'from its own project, and jassub\'s source (with how it builds them) at the link above.',
  '',
  'Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.',
  '',
  '---------------------------------------------------------------------------',
  '',
];

const out = `${header.join('\n')}${kept.join('\n').trimEnd()}\n`;
const target = path.join(root, 'public', 'third-party-notices.txt');
fs.writeFileSync(target, out, 'utf8');
console.log(`Wrote ${path.relative(root, target)} (${kept.length} lines; ${dropped} garbled line(s) left out).`);
