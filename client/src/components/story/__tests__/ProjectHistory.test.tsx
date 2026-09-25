import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../../lib/storyApi';
import { ProjectHistory } from '../ProjectHistory';

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => vi.restoreAllMocks());

const LIST = [
  { projectId: 'a', title: 'Alpha', status: 'done', style: 'cinematic-bible', updatedAt: Date.now() - 5 * 60_000 },
  { projectId: 'b', title: 'Beta', status: 'error', style: 'cinematic-bible', updatedAt: Date.now() - 3 * 3_600_000 },
];

describe('ProjectHistory', () => {
  it('renders a row per project with title and status', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(LIST as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('renders nothing when the list is empty', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue([] as any);
    const { container } = renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await waitFor(() => expect(storyApi.listProjects).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="project-history"]')).toBeNull();
  });

  it('Open calls onOpen with the project id', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(LIST as any);
    const onOpen = vi.fn();
    renderWith(<ProjectHistory onOpen={onOpen} activeId={null} />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getAllByRole('button', { name: /open/i })[0]);
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('Delete confirms then calls storyApi.deleteProject', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(LIST as any);
    const del = vi.spyOn(storyApi, 'deleteProject').mockResolvedValue(undefined);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(del).toHaveBeenCalledWith('a');
  });
});
