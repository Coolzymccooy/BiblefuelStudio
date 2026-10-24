import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Import-local reads a folder on the server, so only the owner may use it
// (#112). The server says whether the caller may; the tab shows only then.
const getMock = vi.fn();
vi.mock('../../lib/api', () => ({
    api: {
        get: (...a: unknown[]) => getMock(...a),
        post: vi.fn(async () => ({ ok: true, data: {} })),
        delete: vi.fn(async () => ({ ok: true, data: {} })),
        patch: vi.fn(async () => ({ ok: true, data: {} })),
    },
}));

import { BackgroundsPage } from '../BackgroundsPage';

function serverSays(allowed: boolean) {
    getMock.mockImplementation(async (url: string) => {
        if (url === '/api/library/import-local') return { ok: true, data: { ok: true, allowed } };
        return { ok: true, data: { ok: true, library: { items: [] }, videos: [] } };
    });
}

describe('BackgroundsPage local packs', () => {
    beforeEach(() => getMock.mockReset());

    it('hides the Local Packs tab when the server says the caller may not import', async () => {
        serverSays(false);
        render(<BackgroundsPage />);
        await waitFor(() => expect(getMock).toHaveBeenCalledWith('/api/library/import-local'));
        expect(screen.queryByRole('button', { name: /local packs/i })).not.toBeInTheDocument();
    });

    it('shows the Local Packs tab for the owner', async () => {
        serverSays(true);
        render(<BackgroundsPage />);
        expect(await screen.findByRole('button', { name: /local packs/i })).toBeInTheDocument();
    });
});
