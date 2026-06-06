/** A debounced function with a `flush` to invoke any pending call immediately. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush: () => void;
  cancel: () => void;
}

/**
 * Returns a debounced wrapper around `fn`. The wrapped call fires `fn` once
 * `wait` ms have elapsed since the last invocation; `flush` runs it now with
 * the most recent args, and `cancel` discards a pending call.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const run = (): void => {
    timer = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const debounced = ((...args: A): void => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, wait);
  }) as Debounced<A>;

  debounced.flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };

  debounced.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  return debounced;
}
