import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SecretField } from '../SecretField';

const base = { label: 'Instagram Access Token', value: '', saved: true, cleared: false, onChange: () => {}, onClear: () => {} };

describe('SecretField', () => {
    it('a saved secret says so, is masked, and offers Clear', () => {
        const onClear = vi.fn();
        render(<SecretField {...base} onClear={onClear} />);
        const input = screen.getByLabelText('Instagram Access Token');
        expect(input).toHaveAttribute('type', 'password');
        expect(input).toHaveAttribute('placeholder', 'Instagram Access Token: saved, leave blank to keep');
        fireEvent.click(screen.getByRole('button', { name: 'Clear saved Instagram Access Token' }));
        expect(onClear).toHaveBeenCalled();
    });

    it('a cleared secret says it will be removed, and Clear goes away', () => {
        render(<SecretField {...base} cleared />);
        expect(screen.getByLabelText('Instagram Access Token')).toHaveAttribute('placeholder', 'Instagram Access Token: will be removed when you save');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('nothing saved: no Clear button', () => {
        render(<SecretField {...base} saved={false} />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
