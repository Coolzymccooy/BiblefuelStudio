import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: { styles: vi.fn(), update: vi.fn() },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import type { CartoonProject } from '../../../lib/cartoonTypes';
import { StyleStep, STYLE_CHANGE_WARNING } from '../StyleStep';

const styles = [
  { id: 'family3d', label: '3D family film' },
  { id: 'storybook', label: 'Storybook' },
  { id: 'clay', label: 'Claymation' },
];

function project(withPortrait: boolean): CartoonProject {
  return {
    id: 'c1',
    meta: { title: 'T', verse: { reference: '', text: '' }, aspect: 'portrait', style: 'family3d' },
    cast: {
      Eli: { name: 'Eli', look: 'a boy', voice: '', approved: withPortrait, shelfId: null, portrait: withPortrait ? { status: 'done', url: '/p.png', error: null } : null },
    },
    running: { pictures: false, film: false, render: false },
  } as unknown as CartoonProject;
}

describe('StyleStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cartoonApi.styles).mockResolvedValue({ styles, defaultStyle: 'family3d' });
    vi.mocked(cartoonApi.update).mockResolvedValue(project(false));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('offers the three styles, each with a line on how it looks', async () => {
    render(<StyleStep project={project(false)} onSaved={() => {}} onNext={() => {}} />);
    expect(await screen.findByRole('radio', { name: /3D family film/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Storybook/ })).not.toBeChecked();
    expect(screen.getByText(/painted, textured, warm paper tones/i)).toBeInTheDocument();
  });

  it('changes the style straight away when no portrait exists yet', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<StyleStep project={project(false)} onSaved={() => {}} onNext={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Claymation/ }));
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { style: 'clay' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('warns before changing the style once portraits exist, and keeps it when declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StyleStep project={project(true)} onSaved={() => {}} onNext={() => {}} />);
    expect(STYLE_CHANGE_WARNING).toBe('Changing the style means making each portrait again in the new style.');
    fireEvent.click(await screen.findByRole('radio', { name: /Storybook/ }));
    expect(confirm).toHaveBeenCalledWith(STYLE_CHANGE_WARNING);
    expect(cartoonApi.update).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('radio', { name: /Storybook/ }));
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { style: 'storybook' }));
  });
});
