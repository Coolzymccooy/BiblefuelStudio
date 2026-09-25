import { describe, it, expect } from 'vitest';
import { fileMatchesAccept } from '../useFileDrop';

const f = (name: string, type = '') => ({ name, type });

describe('fileMatchesAccept', () => {
    it('accepts everything when the list is empty/undefined', () => {
        expect(fileMatchesAccept(f('x.bin'), undefined)).toBe(true);
        expect(fileMatchesAccept(f('x.bin'), [])).toBe(true);
    });

    it('matches by extension (case-insensitive)', () => {
        expect(fileMatchesAccept(f('photo.PNG'), ['.png', '.jpg'])).toBe(true);
        expect(fileMatchesAccept(f('clip.mp4'), ['.png', '.jpg'])).toBe(false);
    });

    it('matches by exact mime type', () => {
        expect(fileMatchesAccept(f('a', 'audio/mpeg'), ['audio/mpeg'])).toBe(true);
        expect(fileMatchesAccept(f('a', 'video/mp4'), ['audio/mpeg'])).toBe(false);
    });

    it('matches by mime wildcard', () => {
        expect(fileMatchesAccept(f('a.png', 'image/png'), ['image/*'])).toBe(true);
        expect(fileMatchesAccept(f('a.mp4', 'video/mp4'), ['image/*'])).toBe(false);
    });

    it('matches if any entry matches (mixed list)', () => {
        const accept = ['image/*', '.mp4', '.mov', '.webm'];
        expect(fileMatchesAccept(f('bg.webp', 'image/webp'), accept)).toBe(true);
        expect(fileMatchesAccept(f('bg.mov', ''), accept)).toBe(true);
        expect(fileMatchesAccept(f('sermon.mp3', 'audio/mpeg'), accept)).toBe(false);
    });
});
