import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";

export type DataStatus = "loading" | "live" | "demo";

export interface Resource<T> {
  data: T | undefined;
  status: DataStatus;
  /** Why demo data is showing (API unreachable, forced demo mode...). */
  reason?: string;
  reload: () => void;
}

export const FORCE_DEMO = (import.meta.env?.VITE_DATA_MODE as string | undefined) === "demo";

/**
 * Loads from the API. Only when the API itself is unreachable / errors (or demo mode is forced)
 * do we substitute demo fixtures, and then `status` is "demo" so the UI says so. A successful
 * response, even an empty list, is always "live": an empty marketplace is shown as empty.
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  demo: () => T,
  deps: readonly unknown[],
): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, "reload">>({ data: undefined, status: "loading" });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  const demoRef = useRef(demo);
  fetcherRef.current = fetcher;
  demoRef.current = demo;

  useEffect(() => {
    if (FORCE_DEMO) {
      setState({ data: demoRef.current(), status: "demo", reason: "demo mode" });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, status: "loading" }));
    fetcherRef
      .current(ctrl.signal)
      .then((data) => setState({ data, status: "live" }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        const reason =
          e instanceof ApiError
            ? e.kind === "http" && e.status === 404
              ? "API has no discovery routes (Arkiv writer not configured)"
              : e.message
            : "unexpected error";
        setState({ data: demoRef.current(), status: "demo", reason });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** Small honest label shown on every screen that reads from the API. */
export function DataBadge({ status, reason, source = "ARKIV + CHAIN" }: { status: DataStatus; reason?: string; source?: string }) {
  if (status === "loading") {
    return (
      <span className="data-badge loading" role="status">
        <i /> SYNCING WITH ARKIV…
      </span>
    );
  }
  if (status === "live") {
    return (
      <span className="data-badge live">
        <i /> LIVE · {source}
      </span>
    );
  }
  return (
    <span className="data-badge demo" role="status" title={reason}>
      <i /> DEMO DATA{reason ? ` · ${reason}` : ""}
    </span>
  );
}
