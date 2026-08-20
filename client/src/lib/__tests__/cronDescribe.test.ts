import { describe, it, expect } from 'vitest';
import { describeCron } from '../cronDescribe';

describe('describeCron', () => {
  it('describes the Morning preset', () => {
    expect(describeCron('0 6 * * *', 'Europe/London')).toBe('Daily at 6:00am Europe/London');
  });

  it('describes the Night preset', () => {
    expect(describeCron('0 22 * * *', 'Europe/London')).toBe('Daily at 10:00pm Europe/London');
  });

  it('describes the Sunday preset', () => {
    expect(describeCron('0 9 * * 0', 'Europe/London')).toBe('Sundays at 9:00am Europe/London');
  });

  it('describes an every-N-hours expression', () => {
    expect(describeCron('0 */12 * * *', 'UTC')).toBe('Every 12 hours UTC');
  });

  it('handles midnight and noon without a 0 o clock', () => {
    expect(describeCron('0 0 * * *')).toBe('Daily at 12:00am');
    expect(describeCron('30 12 * * *')).toBe('Daily at 12:30pm');
  });

  it('echoes expressions it cannot confidently describe', () => {
    expect(describeCron('15 3 1 6 2')).toBe('15 3 1 6 2');
    expect(describeCron('not a cron')).toBe('not a cron');
  });

  it('reports empty input rather than inventing a time', () => {
    expect(describeCron('')).toBe('No time set');
  });
});
