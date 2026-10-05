import { describe, expect, it } from 'vitest';

import { manualPositionChoice } from './manual-position';

const ids = ['a', 'b', 'c', 'd'] as const;

describe('manualPositionChoice', () => {
  it('moves a middle item up between the two tasks that will surround it', () => {
    expect(manualPositionChoice(ids, 2, 'up')).toEqual({ beforeId: 'a', afterId: 'b' });
    expect(manualPositionChoice(ids, 2, 'up')).not.toMatchObject({ beforeId: 'c' });
  });

  it('moves a middle item down between the two tasks that will surround it', () => {
    expect(manualPositionChoice(ids, 1, 'down')).toEqual({ beforeId: 'c', afterId: 'd' });
  });

  it('moves the second item to the front with only the new successor', () => {
    expect(manualPositionChoice(ids, 1, 'up')).toEqual({ afterId: 'a' });
    expect(manualPositionChoice(ids, 0, 'up')).toBeNull();
  });

  it('moves onto the end of a partial page with only the new predecessor', () => {
    expect(manualPositionChoice(['a', 'b', 'c'], 1, 'down')).toEqual({ beforeId: 'c' });
    expect(manualPositionChoice(['a', 'b', 'c'], 2, 'down')).toBeNull();
  });
});
