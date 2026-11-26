import { useEffect, useState } from "react";
import { type ApiResult, api } from "./api";

/**
 * Load a GET endpoint; re-runs when the path changes. It also asks again when `again` changes
 * (a count, such as useSessionsElsewhere), and from that moment has no answer until the new
 * one comes: the old one is not shown meanwhile.
 */
export function useApi<T>(path: string | null, again = 0): ApiResult<T> | null {
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  const [answered, setAnswered] = useState(again);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setResult(null);
    api<T>(path).then((r) => {
      if (!live) return;
      setResult(r);
      setAnswered(again);
    });
    return () => {
      live = false;
    };
  }, [path, again]);
  return answered === again ? result : null;
}
