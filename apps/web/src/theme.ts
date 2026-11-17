import type { ConferenceConfig } from "@elochair/schema";
import type { CSSProperties } from "react";

/** The inline style a conference page sets on its root element for its own accent color. */
export function brandingStyle(branding?: ConferenceConfig["branding"]): CSSProperties | undefined {
  if (!branding) return undefined;
  return {
    "--branding-accent-light": branding.light.accent,
    "--branding-accent-text-light": branding.light.accentText,
    "--branding-accent-dark": branding.dark.accent,
    "--branding-accent-text-dark": branding.dark.accentText,
  } as CSSProperties;
}
