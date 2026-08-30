import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CaptionPreview } from '../CaptionPreview';

/**
 * The stage previews the caption LOOK - the operator picks Marker and the
 * canvas must change at once, not after a render.
 */
describe('CaptionPreview', () => {
  it('Marker puts dark script on a highlighter block, per word', () => {
    render(<CaptionPreview text="You are more" style={{ preset: 'marker' }} progress={1} />);
    const el = screen.getByTestId('caption-preview');
    expect(el).toHaveAttribute('data-preset', 'marker');
    const word = el.querySelector('span') as HTMLElement;
    expect(word.style.background).toContain('245, 217, 10');
    expect(el.style.color).toBe('rgb(20, 18, 16)');
  });

  it('per-word motion reveals words against the playhead', () => {
    render(<CaptionPreview text="one two three four" style={{ preset: 'cinematic-worship', motion: 'words' }} progress={0.5} />);
    const words = Array.from(screen.getByTestId('caption-preview').querySelectorAll('span')) as HTMLElement[];
    expect(words.map((w) => w.style.opacity)).toEqual(['1', '1', '0', '0']);
  });

  it('at rest (playhead on the line start) the whole line shows so the look can be judged', () => {
    render(<CaptionPreview text="one two three" style={{ preset: 'cinematic-worship', motion: 'words' }} progress={0} />);
    const words = Array.from(screen.getByTestId('caption-preview').querySelectorAll('span')) as HTMLElement[];
    expect(words.map((w) => w.style.opacity)).toEqual(['1', '1', '1']);
  });

  it('Karaoke Pop highlights the spoken word in magenta and sets uppercase', () => {
    render(<CaptionPreview text="trust him always" style={{ preset: 'karaoke-pop' }} progress={0.5} />);
    const words = Array.from(screen.getByTestId('caption-preview').querySelectorAll('span')) as HTMLElement[];
    expect(words[1].style.color).toBe('rgb(255, 47, 179)');
    expect(words[0].textContent).toBe('TRUST');
  });

  it('browser-only picks degrade to their closest renderable look, as the server does', () => {
    render(<CaptionPreview text="x" style={{ preset: 'glass-chrome' }} progress={1} />);
    expect(screen.getByTestId('caption-preview')).toHaveAttribute('data-preset', 'cinematic-worship');
  });

  it('Headline sits at the top of frame regardless of layout', () => {
    render(<CaptionPreview text="x" style={{ preset: 'headline', layout: 'bottom' }} progress={1} />);
    expect(screen.getByTestId('caption-preview').className).toContain('top-[8%]');
  });
});
