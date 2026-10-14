import { describe, it, expect } from 'vitest';
import { lyricDownloadUrl } from '../lyricDownload';

describe('lyricDownloadUrl', () => {
  it('points at the finished file and names the download after the song', () => {
    expect(lyricDownloadUrl('lyric-1.mp4', 'My Time')).toMatch(/\/outputs\/lyric-1\.mp4\?dl=My%20Time\.mp4$/);
  });
  it('takes only the file name when given a path', () => {
    expect(lyricDownloadUrl('/srv/out/lyric-1.mp4', 'T')).toMatch(/\/outputs\/lyric-1\.mp4\?dl=T\.mp4$/);
  });
  it('keeps path and punctuation characters out of the saved name', () => {
    const url = lyricDownloadUrl('lyric-1.mp4', 'AC/DC: "Back" in?');
    expect(decodeURIComponent(url.split('?dl=')[1])).toBe('AC DC Back in.mp4');
  });
  it('falls back to a plain name when the title is empty', () => {
    expect(decodeURIComponent(lyricDownloadUrl('lyric-1.mp4', '  ').split('?dl=')[1])).toBe('lyric-video.mp4');
  });
});
