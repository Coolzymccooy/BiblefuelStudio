import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: {
    examples: vi.fn(),
    styles: vi.fn(),
    parse: vi.fn(),
    create: vi.fn(),
    write: vi.fn(),
    update: vi.fn(),
  },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import { ScriptStep } from '../ScriptStep';

const SAMPLE = '# The Lost Lamb\nVerse: Luke 15:4\n\nScene: Hillside at dusk, wide\nEli: "Pip? Pip, where are you?"';
const examples = ['lamb', 'david', 'jonah', 'loaves', 'ruth'].map((id, i) => ({
  id, title: `Example ${i + 1}`, verse: `Luke 15:${i + 1}`, blurb: `Blurb ${i + 1}`, markdown: `# Example ${i + 1}`,
}));

const estimate = { clips: 2, seconds: 12, usd: 1.5, images: 2, imageUsd: 0.08, spentUsd: 0, totalUsd: 1.5, benchmarkUsd: 10, overBenchmark: false, shotIds: [] };
const preview = {
  id: 'preview', meta: { title: 'T', verse: { reference: 'Luke 15:4', text: '' }, aspect: 'portrait', style: 'family3d' },
  cast: {}, scenes: [{ id: 'a', place: 'Behind the rock', note: '' }],
  shots: [{ id: 's1', sceneId: 'a', speaker: 'Eli', line: 'Hello', action: null, note: '', seconds: 4, firstFrame: 'fresh', clip: null }],
  warnings: [], source: { ignored: [], warnings: [] },
};

function Opened() {
  const { id } = useParams();
  return <p>Opened cartoon {id}</p>;
}

function renderStep() {
  return render(
    <MemoryRouter initialEntries={['/app/scene-script/cartoon/new']}>
      <Routes>
        <Route path="/app/scene-script/cartoon/new" element={<ScriptStep />} />
        <Route path="/app/scene-script/cartoon/:id" element={<Opened />} />
      </Routes>
    </MemoryRouter>,
  );
}

const editor = () => screen.getByRole('textbox', { name: 'Your script' }) as HTMLTextAreaElement;

describe('ScriptStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cartoonApi.examples).mockResolvedValue({ examples, placeholder: SAMPLE });
    vi.mocked(cartoonApi.styles).mockResolvedValue({ styles: [{ id: 'family3d', label: '3D family film' }, { id: 'clay', label: 'Claymation' }], defaultStyle: 'family3d' });
  });

  it('the empty editor shows the placeholder sample', async () => {
    renderStep();
    await waitFor(() => expect(editor().placeholder).toBe(SAMPLE));
    expect(editor().value).toBe('');
    expect(screen.getByRole('button', { name: /^next/i })).toBeDisabled();
  });

  it('over 40 s disables Next and names the scene to trim', async () => {
    vi.mocked(cartoonApi.parse).mockResolvedValue({
      preview: preview as never,
      check: { storySec: 40, filmSec: 45.5, ok: false, overBySec: 5.5, trimScene: { id: 'a', place: 'Behind the rock' }, tooLong: [], tooMany: false },
      fits: false,
      estimate,
    });
    renderStep();
    fireEvent.change(editor(), { target: { value: SAMPLE } });
    expect(await screen.findByText('5.5 s over: trim "Behind the rock"', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(cartoonApi.parse).toHaveBeenCalledWith(SAMPLE);
    expect(screen.getByRole('button', { name: /^next/i })).toBeDisabled();
  });

  it('a slow reading of older text never replaces the newest one', async () => {
    const replies: ((v: unknown) => void)[] = [];
    vi.mocked(cartoonApi.parse).mockImplementation(() => new Promise((resolve) => { replies.push(resolve as never); }) as never);
    const reading = (filmSec: number) => ({
      preview, fits: true, estimate,
      check: { storySec: filmSec - 5.5, filmSec, ok: true, overBySec: 0, trimScene: null, tooLong: [], tooMany: false },
    });
    renderStep();
    fireEvent.change(editor(), { target: { value: 'first' } });
    await waitFor(() => expect(replies).toHaveLength(1), { timeout: 2000 });
    fireEvent.change(editor(), { target: { value: 'second' } });
    await waitFor(() => expect(replies).toHaveLength(2), { timeout: 2000 });
    replies[1](reading(20));
    expect(await screen.findByText('20 s of 40')).toBeInTheDocument();
    replies[0](reading(30));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('30 s of 40')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next/i })).not.toBeDisabled();
  });

  it('Write it for me fills the editor with the draft', async () => {
    const draft = '# Ruth Stays\nVerse: Ruth 1:16\n\nScene: A dusty road, wide\nRuth: "Where you go, I will go."';
    vi.mocked(cartoonApi.write).mockResolvedValue({ markdown: draft, verseText: 'Whither thou goest' });
    renderStep();
    await screen.findByLabelText('Style');
    fireEvent.change(screen.getByLabelText('Verse'), { target: { value: 'Ruth 1:16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write the draft' }));
    await waitFor(() => expect(editor().value).toBe(draft));
    expect(cartoonApi.write).toHaveBeenCalledWith({ verse: 'Ruth 1:16', theme: '', cast: '', style: 'family3d' });
  });

  it('while Write it for me runs, the editor and Next are off', async () => {
    let finish: (v: { markdown: string; verseText: string }) => void = () => {};
    vi.mocked(cartoonApi.write).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(cartoonApi.parse).mockResolvedValue({ preview: preview as never, check: { storySec: 4, filmSec: 9.5, ok: true, overBySec: 0, trimScene: null, tooLong: [], tooMany: false }, fits: true, estimate });
    renderStep();
    fireEvent.change(editor(), { target: { value: SAMPLE } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^next/i })).toBeEnabled(), { timeout: 2000 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(screen.getByLabelText('Verse'), { target: { value: 'Ruth 1:16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write the draft' }));
    await waitFor(() => expect(editor()).toHaveAttribute('readonly'));
    expect(screen.getByRole('button', { name: /^next/i })).toBeDisabled();
    finish({ markdown: '# Ruth', verseText: '' });
    await waitFor(() => expect(editor()).not.toHaveAttribute('readonly'));
    expect(editor().value).toBe('# Ruth');
  });

  it('an ignored line shows its own text', async () => {
    const withIgnored = { ...preview, source: { ignored: [{ lineNo: 7, text: 'Narrator speaks softly here' }], warnings: [] } };
    vi.mocked(cartoonApi.parse).mockResolvedValue({ preview: withIgnored as never, check: { storySec: 4, filmSec: 9.5, ok: true, overBySec: 0, trimScene: null, tooLong: [], tooMany: false }, fits: true, estimate });
    renderStep();
    fireEvent.change(editor(), { target: { value: SAMPLE } });
    expect(await screen.findByText('Line 7 not used: "Narrator speaks softly here"', undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it('an example creates a project and navigates to it', async () => {
    vi.mocked(cartoonApi.create).mockResolvedValue({ id: 'c42' } as never);
    renderStep();
    const buttons = await screen.findAllByRole('button', { name: /use this example/i });
    expect(buttons).toHaveLength(5);
    fireEvent.click(buttons[1]);
    expect(await screen.findByText('Opened cartoon c42')).toBeInTheDocument();
    expect(cartoonApi.create).toHaveBeenCalledWith({ exampleId: 'david' });
  });
});

describe('ScriptStep on a saved cartoon', () => {
  const saved = (clip: Record<string, unknown> | null) => ({
    id: 'c7',
    source: { markdown: SAMPLE, ignored: [], warnings: [] },
    shots: [{ ...preview.shots[0], clip }],
  }) as never;

  function renderSaved(project: never) {
    return render(
      <MemoryRouter initialEntries={['/app/scene-script/cartoon/c7']}>
        <Routes>
          <Route path="/app/scene-script/cartoon/c7" element={<ScriptStep project={project} />} />
          <Route path="/app/scene-script/cartoon/:id" element={<Opened />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cartoonApi.examples).mockResolvedValue({ examples, placeholder: SAMPLE });
    vi.mocked(cartoonApi.styles).mockResolvedValue({ styles: [], defaultStyle: 'family3d' });
    vi.mocked(cartoonApi.parse).mockResolvedValue({ preview: preview as never, check: { storySec: 4, filmSec: 9.5, ok: true, overBySec: 0, trimScene: null, tooLong: [], tooMany: false }, fits: true, estimate });
  });

  it('a locked script offers Start over, which makes a new cartoon from it', async () => {
    vi.mocked(cartoonApi.create).mockResolvedValue({ id: 'c8' } as never);
    renderSaved(saved({ status: 'done', taskId: 't1', libraryId: 'lib-1' }));
    expect(editor()).toHaveAttribute('readonly');
    expect(screen.getByText('Starts a new cartoon from this script. Clips you paid for stay in your library.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(await screen.findByText('Opened cartoon c8')).toBeInTheDocument();
    expect(cartoonApi.create).toHaveBeenCalledWith({ markdown: SAMPLE });
  });

  it('locks the lines exactly when the server does: not for an order refused before it was placed', () => {
    renderSaved(saved({ status: 'error', taskId: null, error: 'Over the monthly cap.' }));
    expect(editor()).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
  });

  it('locks the lines when only an earlier clip was ordered', () => {
    renderSaved(saved({ status: 'error', taskId: null, previous: { status: 'done', taskId: 't0' } }));
    expect(editor()).toHaveAttribute('readonly');
  });
});
