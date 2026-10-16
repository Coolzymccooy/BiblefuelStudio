import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SceneLibraryPicker } from '../SceneLibraryPicker';
import { AmbientLibraryPicker } from '../../ambient/AmbientLibraryPicker';
import { storyApi } from '../../../lib/storyApi';
import { ambientApi, type LibraryImage } from '../../../lib/ambientApi';

vi.mock('../../AuthedImage', () => ({
    AuthedImage: ({ className }: { className?: string }) => <img alt="" data-testid="tile-img" className={className} />,
}));

const library = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `img_${i}`, url: `/outputs/imagelib-${i}.png`, source: 'generated',
})) as unknown as LibraryImage[];

afterEach(() => vi.restoreAllMocks());

// iPhone Safari stretched the grid's rows to fit its scroll box, so a full
// library collapsed into thin overlapping strips (the fix BackgroundLibraryModal
// got in 9695c582). content-start keeps each row its own height, and the
// picture fills its tile absolutely so it can never size the row.
function expectStableTiles() {
    const imgs = screen.getAllByTestId('tile-img');
    expect(imgs).toHaveLength(30);
    const grid = imgs[0].parentElement!.parentElement!;
    expect(grid.className).toMatch(/\bcontent-start\b/);
    for (const img of imgs) {
        expect(img.className).toMatch(/\babsolute\b/);
        expect(img.className).toMatch(/\binset-0\b/);
        expect(img.parentElement!.className).toMatch(/\brelative\b/);
    }
}

describe('library picker grids keep real tile heights on a phone', () => {
    it('Story: Choose a picture for a scene', async () => {
        vi.spyOn(storyApi, 'listLibraryImages').mockResolvedValue(library(30));
        render(<SceneLibraryPicker projectId="p" sceneId="s" sceneNumber={2} onClose={() => {}} onChosen={() => {}} aspect="portrait" />);
        await screen.findAllByTestId('tile-img');
        expectStableTiles();
    });

    it('Ambient: Choose a picture for a movement', async () => {
        vi.spyOn(ambientApi, 'listLibraryImages').mockResolvedValue(library(30));
        render(<AmbientLibraryPicker projectId="p" movementId="m" movementNumber={1} onClose={() => {}} onChosen={() => {}} />);
        await screen.findAllByTestId('tile-img');
        expectStableTiles();
    });
});
