import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { seriesApi } from '../../../lib/bibleApi';
import { SeriesQuickPanel, type SeriesQuickPanelProps } from '../SeriesQuickPanel';

beforeEach(() => vi.restoreAllMocks());

const PLAN = {
  seriesId: 's1',
  chapterReference: 'John 3',
  book: 'John',
  chapter: 3,
  translation: 'kjv',
  totalParts: 2,
  segments: [
    { partNumber: 1, totalParts: 2, reference: 'John 3:1-7', verseFrom: 1, verseTo: 7, verses: [], hook: 'You must be born again.', caption: 'Jesus and Nicodemus on the new birth.', youVersionUrl: '' },
    { partNumber: 2, totalParts: 2, reference: 'John 3:8-15', verseFrom: 8, verseTo: 15, verses: [], hook: 'The wind blows where it wishes.', caption: 'Wind and Spirit.', youVersionUrl: '' },
  ],
};

function setup(over: Partial<SeriesQuickPanelProps> = {}) {
  vi.spyOn(seriesApi, 'list').mockResolvedValue({ series: [] } as any);
  const props: SeriesQuickPanelProps = {
    defaultAspect: 'portrait',
    onViewJobs: vi.fn(),
    ...over,
  };
  render(React.createElement(SeriesQuickPanel, props));
  return props;
}

describe('SeriesQuickPanel', () => {
  it('previews the verse partition and shows EVERY segment in full', async () => {
    const user = userEvent.setup();
    const preview = vi.spyOn(seriesApi, 'preview').mockResolvedValue({ plan: PLAN } as any);
    setup();
    await user.click(screen.getByRole('button', { name: /preview segments/i }));
    expect(preview).toHaveBeenCalledWith({ reference: 'John 3', parts: 5, translation: 'kjv' });
    expect(await screen.findByText('John 3:1-7')).toBeInTheDocument();
    expect(screen.getByText('You must be born again.')).toBeInTheDocument();
    expect(screen.getByText('Jesus and Nicodemus on the new birth.')).toBeInTheDocument();
  });

  it('refuses to generate before a preview - same guard as the Series page', () => {
    const generate = vi.spyOn(seriesApi, 'generate');
    setup();
    expect(screen.getByRole('button', { name: /generate series/i })).toBeDisabled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates with the PROJECT frame - one Output frame, everywhere', async () => {
    const user = userEvent.setup();
    vi.spyOn(seriesApi, 'preview').mockResolvedValue({ plan: PLAN } as any);
    const generate = vi.spyOn(seriesApi, 'generate').mockResolvedValue({
      series: { seriesId: 's1', userId: 'u', chapterReference: 'John 3', book: 'John', chapter: 3, translation: 'kjv', totalParts: 2, jobIds: ['j1', 'j2'], createdAt: new Date().toISOString() },
      plan: PLAN,
      jobIds: ['j1', 'j2'],
    } as any);
    setup({ defaultAspect: 'landscape' });
    await user.click(screen.getByRole('button', { name: /preview segments/i }));
    await screen.findByText('John 3:1-7');
    await user.click(screen.getByRole('button', { name: /generate series/i }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ aspect: 'landscape', durationSec: 22 }));
    expect(await screen.findByText(/2 jobs/)).toBeInTheDocument();
  });

  it('hands off to Queue to watch the jobs', async () => {
    const user = userEvent.setup();
    vi.spyOn(seriesApi, 'list').mockResolvedValue({ series: [
      { seriesId: 's0', userId: 'u', chapterReference: 'Psalms 91', book: 'Psalms', chapter: 91, translation: 'kjv', totalParts: 5, jobIds: ['a', 'b', 'c', 'd', 'e'], createdAt: new Date().toISOString() },
    ] } as any);
    const props: SeriesQuickPanelProps = { defaultAspect: 'portrait', onViewJobs: vi.fn() };
    render(React.createElement(SeriesQuickPanel, props));
    await user.click(await screen.findByRole('button', { name: /watch the jobs in queue/i }));
    expect(props.onViewJobs).toHaveBeenCalled();
  });
});
