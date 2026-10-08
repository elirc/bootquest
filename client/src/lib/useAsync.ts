import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'ready'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: Error };

/** Minimal request hook: stale responses from a previous `deps` set are dropped. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: undefined, error: undefined });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'loading' ? s : { status: 'loading', data: undefined, error: undefined }));
    fn().then(
      (data) => live && setState({ status: 'ready', data, error: undefined }),
      (err: unknown) =>
        live && setState({ status: 'error', data: undefined, error: err instanceof Error ? err : new Error(String(err)) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
