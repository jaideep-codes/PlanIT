/** Neighbors for `PATCH /tasks/:id/position`. The moving task's own id is never included. */
export interface ManualNeighbors {
  beforeId?: string;
  afterId?: string;
}

/**
 * Chooses neighbors for a one-step move on a page already in ascending manual order.
 * `beforeId` is the task that will sort earlier. `afterId` is the task that will sort later.
 * Moving to the front sends only `afterId`. Moving to the end of the loaded ids sends only
 * `beforeId`. Returns null when that step must stay disabled (first item up, or the last
 * loaded item down, including when this page is only a prefix).
 */
export function manualPositionChoice(
  ids: readonly string[],
  index: number,
  direction: 'up' | 'down',
): ManualNeighbors | null {
  if (index < 0 || index >= ids.length) return null;
  const movingId = ids[index];
  if (movingId === undefined) return null;

  if (direction === 'up') {
    if (index === 0) return null;
    const afterId = ids[index - 1];
    if (afterId === undefined || afterId === movingId) return null;
    const beforeId = index >= 2 ? ids[index - 2] : undefined;
    if (beforeId === undefined) return { afterId };
    if (beforeId === movingId || beforeId === afterId) return null;
    return { beforeId, afterId };
  }

  if (index >= ids.length - 1) return null;
  const beforeId = ids[index + 1];
  if (beforeId === undefined || beforeId === movingId) return null;
  const afterId = index + 2 < ids.length ? ids[index + 2] : undefined;
  if (afterId === undefined) return { beforeId };
  if (afterId === movingId || afterId === beforeId) return null;
  return { beforeId, afterId };
}
