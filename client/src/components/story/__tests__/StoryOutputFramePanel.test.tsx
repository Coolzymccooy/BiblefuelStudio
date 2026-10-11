import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryOutputFramePanel } from '../StoryOutputFramePanel';

describe('StoryOutputFramePanel', () => {
  it('offers the same three output frames as the Render tab', () => {
    render(<StoryOutputFramePanel value="portrait" onChange={() => {}} />);
    const select = screen.getByRole('combobox', { name: /output frame/i });
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'Portrait (9:16)', 'Landscape (16:9)', 'Square (1:1)',
    ]);
    expect((select as HTMLSelectElement).value).toBe('portrait');
  });

  it('reports the chosen frame', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StoryOutputFramePanel value="portrait" onChange={onChange} />);
    await user.selectOptions(screen.getByRole('combobox', { name: /output frame/i }), 'square');
    expect(onChange).toHaveBeenCalledWith('square');
  });

  it('a project without a frame shows portrait', () => {
    render(<StoryOutputFramePanel value={undefined} onChange={() => {}} />);
    expect((screen.getByRole('combobox', { name: /output frame/i }) as HTMLSelectElement).value).toBe('portrait');
  });

  it('is locked while busy', () => {
    render(<StoryOutputFramePanel value="landscape" onChange={() => {}} busy />);
    expect(screen.getByRole('combobox', { name: /output frame/i })).toBeDisabled();
  });
});
