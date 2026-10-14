import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Lyric video preview ships jassub's WebAssembly build, which carries libraries
// (fribidi, FreeType, harfbuzz, ...) whose licences ask for their notices to travel with it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const notices = path.join(root, 'public', 'third-party-notices.txt');
const upstream = path.join(root, 'node_modules', 'jassub', 'dist', 'COPYRIGHT');

describe('third-party notices', () => {
  const text = fs.existsSync(notices) ? fs.readFileSync(notices, 'utf8') : '';

  it('is served with the app', () => {
    expect(text.length).toBeGreaterThan(1000);
  });

  it('names jassub, its licence and where its source is', () => {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'jassub', 'package.json'), 'utf8'));
    expect(text).toContain('jassub');
    expect(text).toContain(version.license);
    expect(text).toContain('https://github.com/ThaUnknown/jassub');
  });

  it('carries the FreeType credit line', () => {
    expect(text).toContain(
      'Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.',
    );
  });

  it('lists every project jassub lists, with the licence texts', () => {
    const projects = fs.readFileSync(upstream, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('# Project:'));
    expect(projects.length).toBeGreaterThan(5);
    for (const p of projects) expect(text).toContain(p);
    expect(text).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  });

  it('leaves out the garbled line in the upstream file', () => {
    expect(text.split(/\r?\n/).every((l) => l.length <= 400)).toBe(true);
  });
});
