import { describe, it, expect } from 'vitest';
import { qbLocalTimestamp } from '../enqueue';

describe('qbLocalTimestamp', () => {
  it('formats in America/Los_Angeles with no zone suffix (QB reads local time)', () => {
    // 2026-09-25 20:13:25 UTC = 13:13:25 PDT
    expect(qbLocalTimestamp(new Date('2026-09-25T20:13:25Z'))).toBe('2026-09-25T13:13:25');
  });
  it('handles winter time and midnight', () => {
    // 2026-01-15 08:00:00 UTC = 00:00:00 PST
    expect(qbLocalTimestamp(new Date('2026-01-15T08:00:00Z'))).toBe('2026-01-15T00:00:00');
  });
});
