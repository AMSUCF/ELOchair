import { useEffect, useState } from "react";
import { type ApiResult, api } from "./api";

/** Load a GET endpoint; re-runs when the path changes. */
export function useApi<T>(path: string | null): ApiResult<T> | null {
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setResult(null);
    api<T>(path).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return result;
}
