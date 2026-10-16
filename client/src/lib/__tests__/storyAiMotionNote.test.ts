import { describe, it, expect } from 'vitest';
import { storyAiMotionNote } from '../storyAiMotionNote';
import type { StoryProject, StoryScene } from '../storyTypes';

const CAP = "This would take October's AI video spend to $30.38 of $30.";

function scene(over: Partial<StoryScene> = {}): StoryScene {
    return {
        id: 's', text: 't', startMs: 0, endMs: 5000, imagePrompt: 'p', imagePath: '/a.png', imageStatus: 'done',
        promptEditedByUser: false, ...over,
    };
}

function project(scenes: StoryScene[], note: string | null = null, autoStartedAt: number | null = 1): Pick<StoryProject, 'aiMotion' | 'scenes'> {
    return { aiMotion: { quality: 'standard', autoStartedAt, note }, scenes };
}

describe('storyAiMotionNote', () => {
    it('no AI motion: nothing to say', () => {
        expect(storyAiMotionNote({ aiMotion: null, scenes: [scene()] })).toBeNull();
        expect(storyAiMotionNote({ scenes: [scene()] })).toBeNull();
    });

    it("shows the server's note as it is when no clip hit the cap", () => {
        expect(storyAiMotionNote(project([scene({ aiVideoStatus: 'done' })]))).toBeNull();
        expect(storyAiMotionNote(project([scene({ aiVideoStatus: 'done' })], '1 of 2 scenes animated: monthly AI budget reached')))
            .toBe('1 of 2 scenes animated: monthly AI budget reached');
        expect(storyAiMotionNote(project([scene({ aiVideoStatus: 'error', aiVideoError: 'BytePlus refused the prompt.' })]))).toBeNull();
    });

    it('a clip that failed on the cap: the note counts what was really animated', () => {
        const scenes = [
            scene({ id: 'a', aiVideoStatus: 'done' }),
            scene({ id: 'b', aiVideoStatus: 'done' }),
            scene({ id: 'c', aiVideoStatus: 'error', aiVideoError: CAP }),
        ];
        expect(storyAiMotionNote(project(scenes))).toBe('2 of 3 scenes animated: monthly AI budget reached');
        expect(storyAiMotionNote(project(scenes, '3 of 4 scenes animated: monthly AI budget reached')))
            .toBe('2 of 3 scenes animated: monthly AI budget reached');
    });

    it("the user's own clip is not counted as a scene to animate", () => {
        const scenes = [
            scene({ id: 'a', aiVideoStatus: 'done' }),
            scene({ id: 'b', aiVideoStatus: 'error', aiVideoError: CAP }),
            scene({ id: 'c', mediaKind: 'video', videoUrl: '/mine.mp4' }),
        ];
        expect(storyAiMotionNote(project(scenes))).toBe('1 of 2 scenes animated: monthly AI budget reached');
    });

    it('waits while clips are still being made', () => {
        const scenes = [
            scene({ id: 'a', aiVideoStatus: 'generating' }),
            scene({ id: 'b', aiVideoStatus: 'error', aiVideoError: CAP }),
        ];
        expect(storyAiMotionNote(project(scenes))).toBeNull();
    });

    it('before the automatic try, only the stored note shows', () => {
        const scenes = [scene({ aiVideoStatus: 'error', aiVideoError: CAP })];
        expect(storyAiMotionNote(project(scenes, null, null))).toBeNull();
    });
});
