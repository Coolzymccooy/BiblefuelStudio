import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ScriptQuickPanel, type ScriptQuickPanelProps, type QuickScript } from '../ScriptQuickPanel';

const SCRIPT: QuickScript = {
  title: 'Peace in the Storm',
  hook: 'In the chaos, calm awaits you.',
  verse: 'When you face storms, remember: Jesus is in your boat with you.',
  reference: 'Mark 4:39',
  reflection: 'His presence brings peace that the world cannot give.',
  cta: 'Save this for when you need peace.',
};

function setup(over: Partial<ScriptQuickPanelProps> = {}) {
  const props: ScriptQuickPanelProps = {
    isGenerating: false,
    scripts: [],
    onGenerate: vi.fn(),
    onAddToCaptions: vi.fn(),
    ...over,
  };
  render(React.createElement(ScriptQuickPanel, props));
  return props;
}

describe('ScriptQuickPanel', () => {
  it('generates with the configured fields', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByLabelText(/CTA Style/i), 'share');
    await user.selectOptions(screen.getByLabelText(/Script type/i), 'anxiety');
    await user.click(screen.getByRole('button', { name: /generate/i }));
    expect(props.onGenerate).toHaveBeenCalledWith({
      count: 1,
      ctaStyle: 'share',
      lengthSeconds: 20,
      scriptType: 'anxiety',
    });
  });

  it('says the library is shared when empty, instead of a dead end', () => {
    setup();
    expect(screen.getByText(/library is shared/i)).toBeInTheDocument();
  });

  it('shows every part of a generated script - nothing clipped away', () => {
    setup({ scripts: [SCRIPT] });
    expect(screen.getByText(SCRIPT.hook)).toBeInTheDocument();
    expect(screen.getByText(SCRIPT.verse)).toBeInTheDocument();
    expect(screen.getByText(SCRIPT.reflection)).toBeInTheDocument();
    expect(screen.getByText(SCRIPT.cta)).toBeInTheDocument();
  });

  it('lands the script on the captions lane', async () => {
    const user = userEvent.setup();
    const props = setup({ scripts: [SCRIPT] });
    await user.click(screen.getByRole('button', { name: /add to captions lane/i }));
    expect(props.onAddToCaptions).toHaveBeenCalledWith(SCRIPT);
  });

  it('clamps the count to the same 1-5 bound the Scripts page uses', async () => {
    const user = userEvent.setup();
    const props = setup();
    const count = screen.getByLabelText(/Count/i);
    await user.clear(count);
    await user.type(count, '9');
    await user.click(screen.getByRole('button', { name: /generate/i }));
    expect(props.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ count: 5 }));
  });
});
