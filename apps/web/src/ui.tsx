import type { SubmissionStatus } from "@elochair/schema";
import { localizeWithLang } from "@elochair/schema/pure";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { type Lang, type MessageKey, translate, useT } from "./i18n";
import { statusKey } from "./labels";

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
  className,
}: {
  children: ReactNode;
  title?: string;
  focusOnMount?: boolean;
  className?: string;
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
    <h1 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}

/**
 * Takes people to the part of the page that the address names ("#formats", "#reviewers"), once
 * the page is there: links lead to such parts from other pages and from the top of the same
 * one. That part takes focus as well as the view, so that reading and the keyboard go on from
 * it. The browser cannot do this by itself: the page is drawn after the address has changed.
 */
export function useHashTarget(ready: boolean) {
  const { hash, key } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` changes with every navigation, so that taking the same link again goes there again
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView();
  }, [ready, hash, key]);
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
 * `below` puts it on a line of its own under what it echoes, without the slash: for a sentence
 * or the label of a button, which "one / other" on one line would make hard to read.
 */
export function Echo({
  text,
  lang,
  below = false,
}: {
  text: string;
  lang: string;
  below?: boolean;
}) {
  return (
    <span className={below ? "echo echo-below" : "echo"} lang={lang} aria-hidden="true">
      {text}
    </span>
  );
}

/** Configuration text in the partner language, as an echo; nothing if it has none of its own. */
export function LocalizedEcho({
  text,
  below = false,
}: {
  text: Record<string, string>;
  below?: boolean;
}) {
  const { lang } = useT();
  const partner = partnerLang(lang);
  const echo = text[partner];
  if (!echo || echo === localizeWithLang(text, lang).text) return null;
  return <Echo text={echo} lang={partner} below={below} />;
}

/**
 * An interface text with its echo under it, as one block: "Start a proposal" over "Iniciar
 * propuesta". `mark` is a sign after the text (an arrow); it is not read out. `more` is read
 * out and not shown: what tells this link from others with the same text on the page.
 */
export function Pair({ k, mark, more }: { k: MessageKey; mark?: string; more?: string }) {
  const { lang, t } = useT();
  const partner = partnerLang(lang);
  return (
    <span className="pair">
      <span className="pair-text">
        {t(k)}
        {more && <span className="visually-hidden"> {more}</span>}
      </span>
      {mark && <span aria-hidden="true"> {mark}</span>}
      <Echo text={translate(partner, k)} lang={partner} below />
    </span>
  );
}

/**
 * A numbered section heading with its echo: "Key dates / Fechas clave ........ 02". A link to
 * its id ("#deadlines") lands on it: it can take focus, though it is no tab stop.
 */
export function SectionHeading({ id, k, number }: { id: string; k: MessageKey; number?: string }) {
  const { lang, t } = useT();
  const partner = partnerLang(lang);
  return (
    <div className="section-head">
      <h2 id={id} tabIndex={-1}>
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

/** The id of the place in the footer where a page puts a link of its own (Shell in App.tsx). */
export const FOOTER_SLOT = "footer-slot";

/**
 * A link to another site that a page adds to the footer, beside the app's own: the website of
 * the conference the page is about. The footer belongs to the shell, so the link is drawn into
 * its slot once the page is there.
 */
export function FooterLink({ href, k }: { href: string; k: MessageKey }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(FOOTER_SLOT)), []);
  if (!slot) return null;
  return createPortal(
    <a className="paired" href={href} rel="noreferrer">
      <Pair k={k} mark="↗" />
    </a>,
    slot,
  );
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

/** A submission's status, as a coloured badge. */
export function StatusBadge({ status }: { status: SubmissionStatus }) {
  const { t } = useT();
  return <span className={`badge status-${status}`}>{t(statusKey(status))}</span>;
}
