import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessForm } from '../AccessForm';

describe('AccessForm', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('submits valid form data to /api/access-requests and shows thank-you panel', async () => {
    render(<AccessForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), 'Ada Lovelace');
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/ministry/i), 'Difference Engine');
    await user.type(screen.getByLabelText(/sentence/i), 'A weekly devotional for engineers.');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/access-requests',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });
    expect(screen.getByText(/received/i)).toBeInTheDocument();
    expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument();
  });

  it('shows validation errors when fields are empty', async () => {
    render(<AccessForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('honeypot field is rendered off-screen but in the DOM', () => {
    render(<AccessForm />);
    const hp = screen.getByLabelText(/website/i, { selector: 'input' });
    expect(hp).toBeInTheDocument();
    expect(hp.getAttribute('tabindex')).toBe('-1');
    expect(hp).toHaveAttribute('autocomplete', 'off');
  });

  it('shows server error message on 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: 'SERVER' }),
    }) as unknown as typeof fetch;

    render(<AccessForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/ministry/i), 'O');
    await user.type(screen.getByLabelText(/sentence/i), 'p');
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});
