import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";

/** Loads from the API, optionally polling (paused while the tab is hidden). No demo fallback: this is a live, private feature. */
export function useLive<T>(fetcher: (s: AbortSignal) => Promise<T>, deps: readonly unknown[], opts: { every?: number; enabled?: boolean } = {}) {
  const { every, enabled = true } = opts;
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: enabled });
  const [nonce, setNonce] = useState(0);
  const f = useRef(fetcher);
  f.current = fetcher;
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    let ctrl = new AbortController();
    const run = () => {
      ctrl.abort();
      ctrl = new AbortController();
      f.current(ctrl.signal)
        .then((data) => !cancelled && setState({ data, loading: false }))
        .catch((e: unknown) => {
          if (cancelled || ctrl.signal.aborted) return;
          setState((s) => ({ data: s.data, loading: false, error: e instanceof ApiError ? (e.detail ?? e.message) : "unexpected error" }));
        });
    };
    run();
    const id = every ? window.setInterval(() => !document.hidden && run(), every) : 0;
    return () => {
      cancelled = true;
      ctrl.abort();
      if (id) window.clearInterval(id);
    };
  }, [...deps, nonce, enabled, every]);
  return { ...state, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
