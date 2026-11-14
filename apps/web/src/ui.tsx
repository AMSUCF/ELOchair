import { localizeWithLang } from "@elochair/schema/pure";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";
import { type Lang, type MessageKey, translate, useT } from "./i18n";

/**
 * Set by the shell whenever the route changes; the next page heading to render takes focus.
 * Pages that load data render their heading later, so focus follows the heading, not the URL.
 */
export const FocusPending = createContext<RefObject<boolean> | null>(null);

/**
 * The page's h1: names the document (title) and receives focus after navigation. With
 * `focusOnMount` it takes focus when it appears even without a navigation (an error page that
 * replaces a page whose heading already had focus).
 */
export function PageHeading({
  children,
  title,
  focusOnMount = false,
}: {
  children: ReactNode;
  title?: string;
  focusOnMount?: boolean;
}) {
  const { t } = useT();
  const ref = useRef<HTMLHeadingElement>(null);
  const pending = useContext(FocusPending);
  const name = title ?? (typeof children === "string" ? children : "");

  useEffect(() => {
    document.title = name && name !== t("appName") ? `${name} – ${t("appName")}` : t("appName");
  }, [name, t]);

  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

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

/**
 * The conference runs in English and Spanish side by side, and its site pairs them everywhere
 * ("Key dates / Fechas clave"). The partner is the language shown as the echo of the current one.
 */
export const partnerLang = (lang: Lang): Lang => (lang === "en" ? "es" : "en");

/**
 * The second language of a pair, shown after the first in a lighter weight and accent colour.
 * It is decoration: hidden from assistive technology, so a heading is not read out twice.
 */
export function Echo({ text, lang }: { text: string; lang: string }) {
  return (
    <span className="echo" lang={lang} aria-hidden="true">
      {text}
    </span>
  );
}

/** Configuration text in the partner language, as an echo; nothing if it has none of its own. */
export function LocalizedEcho({ text }: { text: Record<string, string> }) {
  const { lang } = useT();
  const partner = partnerLang(lang);
  const echo = text[partner];
  if (!echo || echo === localizeWithLang(text, lang).text) return null;
  return <Echo text={echo} lang={partner} />;
}

/** A numbered section heading with its echo: "Key dates / Fechas clave ........ 02". */
export function SectionHeading({ id, k, number }: { id: string; k: MessageKey; number?: string }) {
  const { lang, t } = useT();
  const partner = partnerLang(lang);
  return (
    <div className="section-head">
      <h2 id={id}>
        {t(k)}
        <Echo text={translate(partner, k)} lang={partner} />
      </h2>
      {number && (
        <span className="section-number" aria-hidden="true">
          {number}
        </span>
      )}
    </div>
  );
}

/** A mono micro-label above a block ("DATES", "VENUE"). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** The content sheet, for pages that render a hero above it (see Shell in App.tsx). */
export function Sheet({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={wide ? "sheet sheet-wide" : "sheet"}>{children}</div>;
}

/** One stat tile: a large value over a mono label, read together ("250–300 words"). */
export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <li>
      <span className="stat-value">{value}</span> <span className="stat-label">{label}</span>
    </li>
  );
}
