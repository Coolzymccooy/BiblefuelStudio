import { describe, it, expect } from 'vitest';
import { thumbnailBody, youtubeVideoId } from '../youtubeThumbnail';

describe('youtubeVideoId', () => {
  it('reads the id from every common link shape, or a bare id', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=Awlj9uLvOCQ&t=3485s',
      'youtube.com/watch?v=Awlj9uLvOCQ',
      'https://m.youtube.com/watch?v=Awlj9uLvOCQ',
      'https://youtu.be/Awlj9uLvOCQ?si=abc',
      'https://www.youtube.com/shorts/Awlj9uLvOCQ',
      'https://www.youtube.com/live/Awlj9uLvOCQ',
      'https://www.youtube.com/embed/Awlj9uLvOCQ',
      '  Awlj9uLvOCQ ',
    ]) expect(youtubeVideoId(link), link).toBe('Awlj9uLvOCQ');
  });

  it('finds nothing in a link that is not a YouTube video', () => {
    for (const link of ['', 'hello', 'https://vimeo.com/123', 'https://www.youtube.com/@sthillwaters', 'https://evil.com/watch?v=Awlj9uLvOCQ', 'https://youtube.com.evil.com/watch?v=Awlj9uLvOCQ', 'https://youtu.be/short']) {
      expect(youtubeVideoId(link), link).toBe('');
    }
  });
});

describe('thumbnailBody', () => {
  it('sends the tagline only with the title', () => {
    const d = { path: '/outputs/p.png', title: ' Be Still ', withTitle: true, tagline: ' 2 hours ' };
    expect(thumbnailBody(d)).toEqual({ thumbnailPath: '/outputs/p.png', title: 'Be Still', thumbnailTitle: true, thumbnailTagline: '2 hours' });
    expect(thumbnailBody({ ...d, withTitle: false }).thumbnailTagline).toBe('');
  });
});
