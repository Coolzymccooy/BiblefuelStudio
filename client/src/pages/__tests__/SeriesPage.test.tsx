import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SeriesPage } from '../SeriesPage';
import { storyApi } from '../../lib/storyApi';
import { useAuth } from '../../hooks/useAuth';

const sendMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/sendToStoryVideo', () => ({ narrateAndSendToStory: (...a: unknown[]) => sendMock(...a) }));
vi.mock('../../components/BibleVerseLookup', () => ({ BibleVerseLookup: () => null }));
vi.mock('../../components/series/SeriesCaptionStyle', () => ({ SeriesCaptionStyle: () => null }));

// 26 + 26 words: 20 s of narration, 2 clips, 20 s at $0.0756 = $1.512.
const twentySix = (tag: string) => Array.from({ length: 26 }, (_, i) => `${tag}${i}`).join(' ');
const segment = (n: number) => ({
    partNumber: n, totalParts: 2, reference: `John 3:${n}`, verseFrom: n, verseTo: n,
    verses: [{ book: 'John', chapter: 3, verse: n, text: twentySix('v') }, { book: 'John', chapter: 3, verse: n + 1, text: twentySix('w') }],
    // The social caption is never narrated: only the verses are.
    hook: 'Hook.', caption: 'Part 1 of 2. Read on YouVersion: https://example.test', youVersionUrl: 'https://example.test',
});
vi.mock('../../lib/bibleApi', () => ({
    bibleApi: { listTranslations: () => Promise.resolve({ translations: [] }) },
    seriesApi: {
        list: () => Promise.resolve({ series: [] }),
        preview: (...a: unknown[]) => previewMock(...a),
    },
}));

const rates = (over = {}) => ({
    configured: true, usdPerSecond: { standard: 0.0756, high: 0.374 }, monthSpentUsd: 0, reservedUsd: 0, capUsd: 30, ...over,
});

async function renderWithPlan() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={qc}>
            <MemoryRouter><SeriesPage /></MemoryRouter>
        </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /preview segments/i }));
    await screen.findByText('Part 1 of 2');
}

let ratesSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    sendMock.mockReset();
    previewMock.mockReset();
    previewMock.mockResolvedValue({
        plan: { seriesId: 's', chapterReference: 'John 3', book: 'John', chapter: 3, translation: 'kjv', totalParts: 2, targetSeconds: 22, stretched: false, segments: [segment(1), segment(2)] },
    });
    sendMock.mockResolvedValue({ ok: true, projectId: 'p1' });
    ratesSpy = vi.spyOn(storyApi, 'animateRates').mockResolvedValue(rates());
});
afterEach(() => {
    vi.restoreAllMocks();
    useAuth.setState({ isSuperAdmin: false });
});

describe('SeriesPage: AI motion', () => {
    it('a normal account sees no AI motion option and never asks for the rates', async () => {
        useAuth.setState({ isSuperAdmin: false });
        await renderWithPlan();
        expect(screen.queryByLabelText('AI motion')).toBeNull();
        expect(ratesSpy).not.toHaveBeenCalled();
    });

    it('a super admin on a server without BytePlus sees no option', async () => {
        useAuth.setState({ isSuperAdmin: true });
        ratesSpy.mockResolvedValue(rates({ configured: false }));
        await renderWithPlan();
        await waitFor(() => expect(ratesSpy).toHaveBeenCalled());
        expect(screen.queryByLabelText('AI motion')).toBeNull();
    });

    it('a super admin sees the option on each part, with the estimate', async () => {
        useAuth.setState({ isSuperAdmin: true });
        await renderWithPlan();
        const boxes = await screen.findAllByLabelText('AI motion');
        expect(boxes).toHaveLength(2);
        expect(screen.getAllByText('about 2 clips · ≈ $1.51')).toHaveLength(2);
    });

    it("ticking one part sends it with AI motion, and leaves the other part's tick alone", async () => {
        useAuth.setState({ isSuperAdmin: true });
        await renderWithPlan();
        const [first, second] = await screen.findAllByLabelText('AI motion');
        fireEvent.click(first);
        expect((first as HTMLInputElement).checked).toBe(true);
        expect((second as HTMLInputElement).checked).toBe(false);
        fireEvent.click(screen.getAllByRole('button', { name: /send to story video/i })[0]);
        await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
        const [text, opts] = sendMock.mock.calls[0];
        expect(text).toBe(`${twentySix('v')} ${twentySix('w')}`);
        expect(opts).toMatchObject({ title: 'John 3:1 · Part 1', aiMotion: true });
    });

    it('an unticked part is sent without AI motion', async () => {
        useAuth.setState({ isSuperAdmin: true });
        await renderWithPlan();
        await screen.findAllByLabelText('AI motion');
        fireEvent.click(screen.getAllByRole('button', { name: /send to story video/i })[1]);
        await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
        expect(sendMock.mock.calls[0][1].aiMotion).toBe(false);
    });
});

describe('SeriesPage: verses per video', () => {
    it('previews on Auto at the video length by default', async () => {
        await renderWithPlan();
        expect(previewMock).toHaveBeenCalledWith({ reference: 'John 3', versesPerPart: 'auto', durationSec: 22, translation: 'kjv' });
        expect(screen.getByText(/4 verses → 2 videos: 1, 2/)).toBeInTheDocument();
    });

    it('sends the verses-per-video choice', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={qc}><MemoryRouter><SeriesPage /></MemoryRouter></QueryClientProvider>);
        fireEvent.change(screen.getByLabelText('Verses per video'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: /preview segments/i }));
        await waitFor(() => expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ versesPerPart: 2 })));
    });

    it('a preview that comes back after the choice changed is thrown away', async () => {
        let resolve: (v: unknown) => void = () => {};
        previewMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={qc}><MemoryRouter><SeriesPage /></MemoryRouter></QueryClientProvider>);
        fireEvent.click(screen.getByRole('button', { name: /preview segments/i }));
        fireEvent.change(screen.getByLabelText('Verses per video'), { target: { value: 'one' } });
        resolve({ plan: { seriesId: 's', chapterReference: 'John 3', book: 'John', chapter: 3, translation: 'kjv', totalParts: 2, segments: [segment(1), segment(2)] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /preview segments/i })).toBeEnabled());
        expect(screen.queryByText('Part 1 of 2')).toBeNull();
        expect(screen.getByRole('button', { name: /generate series/i })).toBeDisabled();
    });

    it('changing the choice after a preview clears it, so Generate never sends a different split', async () => {
        await renderWithPlan();
        expect(screen.getByRole('button', { name: /generate 2 videos/i })).toBeEnabled();
        fireEvent.change(screen.getByLabelText('Verses per video'), { target: { value: 'one' } });
        expect(screen.queryByText('Part 1 of 2')).toBeNull();
        expect(screen.getByRole('button', { name: /generate series/i })).toBeDisabled();
    });
});
