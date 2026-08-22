import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScenesPanel, type ScenesPanelProps } from '../ScenesPanel';
import { buildWorshipDocumentaryProject } from '../../../lib/timelineProject';
import { addEffectToScene } from '../../../lib/timelineEffects';

function setup(over: Partial<ScenesPanelProps> = {}) {
  const project = buildWorshipDocumentaryProject({ title: 'T' });
  const props: ScenesPanelProps = {
    project,
    selectedSceneId: null,
    onSelectScene: vi.fn(),
    onAddEffect: vi.fn(),
    onRemoveEffect: vi.fn(),
    effectOption: {},
    onEffectOptionChange: vi.fn(),
    ...over,
  };
  render(<ScenesPanel {...props} />);
  return { props, project };
}

describe('ScenesPanel', () => {
  it('explains itself when there is no project', () => {
    setup({ project: null });
    expect(screen.getByText(/create a documentary timeline first/i)).toBeInTheDocument();
  });

  it('lists every scene as a real button', () => {
    const { project } = setup();
    for (const s of project.scenes) {
      expect(screen.getByRole('button', { name: new RegExp(s.label, 'i') })).toBeInTheDocument();
    }
  });

  it('selecting a scene reports it upward', async () => {
    const user = userEvent.setup();
    const { props, project } = setup();
    await user.click(screen.getByRole('button', { name: new RegExp(project.scenes[1].label, 'i') }));
    expect(props.onSelectScene).toHaveBeenCalledWith(project.scenes[1].id);
  });

  it('hides the effect controls until a scene is chosen', () => {
    setup();
    expect(screen.getByText(/select a scene to add effects/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^glow$/i })).not.toBeInTheDocument();
  });

  it('offers all four effects once a scene is selected', () => {
    const project = buildWorshipDocumentaryProject({ title: 'T' });
    setup({ project, selectedSceneId: project.scenes[0].id });
    for (const label of ['Transition', 'Grade', 'Glow', 'Light leak']) {
      // Anchored: "Glow" is also a substring of the scene "Afterglow / closing".
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
    }
  });

  it('adds an effect to the SELECTED scene', async () => {
    const user = userEvent.setup();
    const project = buildWorshipDocumentaryProject({ title: 'T' });
    const target = project.scenes[2];
    const { props } = setup({ project, selectedSceneId: target.id });
    await user.click(screen.getByRole('button', { name: /^glow$/i }));
    expect(props.onAddEffect).toHaveBeenCalledWith(target.id, 'glow', undefined);
  });

  it('passes the chosen option for effects that have one', async () => {
    const user = userEvent.setup();
    const project = buildWorshipDocumentaryProject({ title: 'T' });
    const target = project.scenes[0];
    const { props } = setup({
      project, selectedSceneId: target.id, effectOption: { grade: 'cinematic' },
    });
    await user.click(screen.getByRole('button', { name: /^grade$/i }));
    expect(props.onAddEffect).toHaveBeenCalledWith(target.id, 'grade', 'cinematic');
  });

  it('lists only the effects on the selected scene', () => {
    const base = buildWorshipDocumentaryProject({ title: 'T' });
    const withFx = addEffectToScene(base, { sceneId: base.scenes[0].id, effect: 'grade' });
    const both = addEffectToScene(withFx, { sceneId: base.scenes[4].id, effect: 'glow' });
    setup({ project: both, selectedSceneId: base.scenes[0].id });
    expect(screen.getByRole('button', { name: /remove grade/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove glow/i })).not.toBeInTheDocument();
  });

  it('removes an effect by its clip id', async () => {
    const user = userEvent.setup();
    const base = buildWorshipDocumentaryProject({ title: 'T' });
    const withFx = addEffectToScene(base, { sceneId: base.scenes[0].id, effect: 'grade' });
    const clip = withFx.tracks.find((t) => t.kind === 'effects')!.clips[0];
    const { props } = setup({ project: withFx, selectedSceneId: base.scenes[0].id });
    await user.click(screen.getByRole('button', { name: /remove grade/i }));
    expect(props.onRemoveEffect).toHaveBeenCalledWith(clip.id);
  });

  it('says so when the selected scene has no effects', () => {
    const project = buildWorshipDocumentaryProject({ title: 'T' });
    setup({ project, selectedSceneId: project.scenes[0].id });
    expect(screen.getByText(/no effects on this scene yet/i)).toBeInTheDocument();
  });
});
