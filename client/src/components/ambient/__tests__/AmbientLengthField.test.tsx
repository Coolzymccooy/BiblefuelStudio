import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmbientLengthField } from '../AmbientLengthField';

function Harness({ initial = '120' }: { initial?: string }) {
  const [minutes, setMinutes] = useState(initial);
  return (
    <>
      <AmbientLengthField minutes={minutes} onChange={setMinutes} />
      <output data-testid="value">{minutes}</output>
    </>
  );
}

describe('AmbientLengthField', () => {
  it('asks in plain words and answers with what the number means', () => {
    render(<Harness />);
    expect(screen.getByText('How long should it play?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 hours/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 hours · 7 verses · ready in roughly 40 minutes')).toBeInTheDocument();
  });

  it('a preset is one tap, and the readout follows it', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /1 hour/ }));
    expect(screen.getByTestId('value')).toHaveTextContent('60');
    expect(screen.getByText(/^1 hour · 3 verses/)).toBeInTheDocument();
  });

  it('marks the short length as the one to test with', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /10 min/ })).toHaveTextContent(/quick test/i);
  });

  it('custom reveals a box for any other length', async () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/custom length/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /custom/i }));
    const box = screen.getByLabelText(/custom length/i);
    await userEvent.clear(box);
    await userEvent.type(box, '45');
    expect(screen.getByTestId('value')).toHaveTextContent('45');
    expect(screen.getByText(/^45 minutes · 2 verses/)).toBeInTheDocument();
  });

  it('a length that is not a preset opens straight into custom', () => {
    render(<Harness initial="45" />);
    expect(screen.getByLabelText(/custom length/i)).toHaveValue(45);
    expect(screen.getByRole('button', { name: /custom/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
