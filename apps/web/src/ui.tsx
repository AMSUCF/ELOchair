import { localizeWithLang } from "@elochair/schema/pure";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useT } from "./i18n";

/**
 * Set by the shell whenever the route changes; the next page heading to render takes focus.
 * Pages that load data render their heading later, so focus follows the heading, not the URL.
 */
export const FocusPending = createContext<RefObject<boolean> | null>(null);

/** The page's h1: names the document (title) and receives focus after navigation. */
export function PageHeading({ children, title }: { children: ReactNode; title?: string }) {
  const { t } = useT();
  const ref = useRef<HTMLHeadingElement>(null);
  const pending = useContext(FocusPending);
  const name = title ?? (typeof children === "string" ? children : "");

  useEffect(() => {
    document.title = name ? `${name} – ${t("appName")}` : t("appName");
  }, [name, t]);

  useEffect(() => {
    if (pending?.current && ref.current) {
      pending.current = false;
      ref.current.focus();
    }
  });

  return (
    <h1 ref={ref} tabIndex={-1}>
      {children}
    </h1>
  );
}

/**
 * Configuration text in the interface language when available. Text shown in another language
 * (a fallback) is marked with its lang so screen readers pronounce it correctly.
 */
export function Localized({ text, fallback }: { text: Record<string, string>; fallback?: string }) {
  const { lang } = useT();
  const shown = localizeWithLang(text, lang, fallback);
  if (shown.lang.split("-")[0] === lang) return <>{shown.text}</>;
  return <span lang={shown.lang}>{shown.text}</span>;
}
