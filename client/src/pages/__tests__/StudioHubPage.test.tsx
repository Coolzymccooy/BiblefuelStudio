import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { StudioHubPage } from '../StudioHubPage';

function renderHub() {
  return render(<MemoryRouter><StudioHubPage /></MemoryRouter>);
}

describe('StudioHubPage', () => {
  afterEach(() => useAuth.setState({ isSuperAdmin: false }));

  it('shows Scene script to super admins', () => {
    useAuth.setState({ isSuperAdmin: true });
    renderHub();
    expect(screen.getByRole('link', { name: /Scene script/ }).getAttribute('href')).toBe('/app/scene-script');
  });

  it('hides Scene script from everyone else', () => {
    useAuth.setState({ isSuperAdmin: false });
    renderHub();
    expect(screen.queryByRole('link', { name: /Scene script/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Lyric video/ })).toBeTruthy();
  });
});
