import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HelpPage } from '../HelpPage';

describe('HelpPage: Connect an agent', () => {
  it('shows the agent guide, rendered from docs/mcp.md', () => {
    render(<HelpPage />);
    expect(screen.getByRole('heading', { name: 'Connect an agent' })).toBeTruthy();
    expect(screen.getAllByText(/bearer_token_env_var/).length).toBeGreaterThan(0);
  });

  it('renders the guide headings and fenced code blocks, not raw markdown', () => {
    render(<HelpPage />);
    expect(screen.getByRole('heading', { name: 'Get a key' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Waiting for jobs' })).toBeTruthy();
    expect(document.querySelectorAll('pre code').length).toBeGreaterThan(3);
    expect(document.body.textContent).not.toContain('```');
  });
});
