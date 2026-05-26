import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UnauthedOnly } from '../UnauthedOnly';

describe('UnauthedOnly', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders children when no BF_TOKEN in localStorage', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UnauthedOnly redirect="/app"><div>Landing</div></UnauthedOnly>} />
          <Route path="/app" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Landing')).toBeInTheDocument();
  });

  it('redirects to /app when BF_TOKEN is present', () => {
    localStorage.setItem('BF_TOKEN', 'fake.jwt.value');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UnauthedOnly redirect="/app"><div>Landing</div></UnauthedOnly>} />
          <Route path="/app" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Landing')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('ignores literal "null"/"undefined" string tokens', () => {
    localStorage.setItem('BF_TOKEN', 'null');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UnauthedOnly redirect="/app"><div>Landing</div></UnauthedOnly>} />
          <Route path="/app" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Landing')).toBeInTheDocument();
  });
});
