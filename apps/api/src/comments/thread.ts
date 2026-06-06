/**
 * Pure thread-id assignment (spec §5). A new top-level comment becomes its own
 * thread root: its `threadId` equals its own id. A reply inherits the parent's
 * `threadId` so the whole conversation shares one thread.
 */
export function resolveThreadId(
  newCommentId: string,
  parentThreadId: string | null | undefined,
): string {
  return parentThreadId ?? newCommentId;
}
