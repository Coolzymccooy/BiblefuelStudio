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

/**
 * A working account accumulates projects forever. The list used to render
 * every one of them above the new-project form, so at a few hundred projects
 * the form was several screens down and starting new work meant scrolling
 * past all your old work to reach it.
 */
describe('ProjectHistory with a long history', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      projectId: `p${i}`,
      title: `Project ${i}`,
      status: 'done',
      style: 'cinematic-bible',
      updatedAt: Date.now() - i * 60_000,
    }));

  it('shows only the most recent few, so the form stays reachable', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(many(50) as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    expect(await screen.findByText('Project 0')).toBeInTheDocument();
    expect(screen.getByText('Project 4')).toBeInTheDocument();
    expect(screen.queryByText('Project 5')).toBeNull();
    expect(screen.queryByText('Project 49')).toBeNull();
  });

  it('a short history is shown whole, with no expander and no search', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(many(3) as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    expect(await screen.findByText('Project 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('"Show all" reveals the rest inside a scroll box, and collapses again', async () => {
    const user = userEvent.setup();
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(many(50) as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await screen.findByText('Project 0');

    await user.click(screen.getByRole('button', { name: /show all 50/i }));
    expect(screen.getByText('Project 49')).toBeInTheDocument();
    // Capped height, or 1000 projects simply pushes the form down again.
    expect(screen.getByTestId('project-history-list').className).toMatch(/overflow-y-auto/);

    await user.click(screen.getByRole('button', { name: /show fewer/i }));
    expect(screen.queryByText('Project 49')).toBeNull();
  });

  it('search finds an old project without scrolling to it', async () => {
    const user = userEvent.setup();
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(many(50) as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await screen.findByText('Project 0');

    await user.type(screen.getByRole('searchbox'), 'Project 47');
    expect(await screen.findByText('Project 47')).toBeInTheDocument();
    expect(screen.queryByText('Project 0')).toBeNull();
  });

  it('a search that matches nothing says so instead of rendering an empty list', async () => {
    const user = userEvent.setup();
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(many(50) as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await screen.findByText('Project 0');

    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(await screen.findByText(/no projects match/i)).toBeInTheDocument();
  });
});
