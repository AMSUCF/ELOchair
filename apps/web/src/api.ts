import type { ConferenceConfig, LocalizedText } from "@elochair/schema";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/** JSON over fetch, same-origin cookies. Never throws for HTTP errors; check `ok`. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    return {
      ok: false,
      status: res.status,
      error: (data as { error?: string } | null)?.error ?? "error",
    };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export type ConferenceSummary = {
  slug: string;
  phase: string;
  year: number;
  title: LocalizedText;
  location: LocalizedText;
  modality: ConferenceConfig["modality"];
  dates: { start: string; end: string };
  placeholder: boolean;
};

export type ConferenceDetail = { slug: string; phase: string; config: ConferenceConfig };

export type Me =
  | {
      kind: "person";
      person: { email: string; displayName: string | null } | null;
      siteAdmin: boolean;
      roles: {
        conference: string | null;
        role: "admin" | "chair" | "track_chair" | "reviewer";
        scope: string[];
      }[];
    }
  | { kind: "agent"; tier: "M" | "C"; conference: string | null };
