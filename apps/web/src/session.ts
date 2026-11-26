import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { api } from "./api";

/*
 * Who is signed in, as this tab and the other tabs of the browser come to know it.
 *
 * What the page's frame shows of whoever is looking (GET /api/me/menu, which answers everyone,
 * signed in or not):
 * - who is signed in, for the link to their account at the right of the header, or that
 *   nobody is, for "Sign in" in its place;
 * - which of a person's own pages the main menu offers: "My submissions" once they are on a
 *   proposal or invited to one, "My reviews" if they review somewhere. A page with nothing on
 *   it is not offered.
 *
 * The frame outlives a sign-in and a sign-out, and what it shows is a person's name. So:
 * - Whatever signs someone in or out says so, and who is signed in now (sessionChanged). The
 *   frame forgets at once who it showed, and asks: the name of whoever was here is never
 *   shown to whoever comes next, not even while the answer is on its way. It does the same
 *   when the browser brings the page back as it was left, by the back button.
 * - Whatever changes what the frame shows of the same person says so too (menuChanged: their
 *   name, a role accepted), and the frame asks again, showing what it showed until then.
 * - The frame also asks each time the page changes: starting a proposal, or deleting the only
 *   one, changes what the menu offers, and no page has to remember to say so.
 * - Only the answer to the latest question counts. One that comes late, to a question from
 *   before someone signed in or out, is dropped; and when the latest does not arrive, the
 *   frame shows nobody rather than whoever was there before.
 *
 * Both are said to every tab this browser has open on the site, and a tab that hears that
 * someone else is signed in now than it shows, or nobody, goes on showing nothing of whoever
 * was (spec 02, §1.13):
 * - its frame forgets them, as above;
 * - its page starts again, if it is one that shows a person what is theirs (SignedInPages in
 *   App.tsx), and whatever else showed something of them forgets it (useSessionElsewhere).
 * A tab that hears that the person it shows has signed in again is left as it is, with
 * whatever they are typing in it: only its frame asks again.
 */

const SESSION = "elochair:session";
const MENU = "elochair:menu";
/** In this tab only: another tab said that someone else is signed in now, or nobody. */
const ELSEWHERE = "elochair:session-elsewhere";

/**
 * The address of whoever this tab's frame shows as signed in; null for nobody, and while the
 * frame does not know. It is what an announcement from another tab is held against: only one
 * that names this very address leaves the tab as it is.
 */
let shown: string | null = null;

/*
 * The line to the other tabs: what is posted on it reaches every other tab of this browser
 * that is on the site, and never the tab that posted it. Opened when first needed; null in a
 * browser that has none (the other tabs then learn of it on their next page).
 *
 * What is said on it is two bare words, which a tab still running the version before this one
 * says and understands too (it knows nothing else, and forgets its header at the first):
 * - MENU: the person signed in changed what the frame shows of them;
 * - SESSION: someone signed in or out.
 * A tab that can say who is signed in now says that first, `{ now: address or null }`, and
 * then the word. Both go down the one line, so they arrive in that order; a tab of the
 * version before does not read the first and acts on the second. A word that comes without it
 * (from such a tab) names nobody, and is taken to be about somebody else.
 */
let line: BroadcastChannel | null | undefined;
/** Who the next SESSION word leaves signed in, where the tab that says it said so first. */
let saidToBe: unknown;
function otherTabs(): BroadcastChannel | null {
  if (line === undefined) {
    line = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION);
    line?.addEventListener("message", (event) => heard(event.data));
  }
  return line;
}

/**
 * What another tab said, told to this one. That the person this tab shows signed in again
 * changes nothing here but what the frame may show of them. Anything else said about who is
 * signed in (somebody else, nobody, or nothing that can be read) ends what this tab shows.
 */
function heard(said: unknown) {
  if (said === MENU) window.dispatchEvent(new Event(MENU));
  else if (said === SESSION) {
    // What was said before this word is about this word only, and is used once.
    const now = saidToBe;
    saidToBe = undefined;
    const samePerson = typeof now === "string" && now !== "" && now === shown;
    window.dispatchEvent(new Event(samePerson ? MENU : ELSEWHERE));
  } else if (typeof said === "object" && said !== null && "now" in said) {
    saidToBe = (said as { now: unknown }).now;
  }
}

/**
 * Someone signed in (`email`: their address, as the server gave it) or out (null). This tab's
 * frame forgets who it showed and asks again, and every other tab is told who is signed in now.
 */
export function sessionChanged(email: string | null) {
  window.dispatchEvent(new Event(SESSION));
  const tabs = otherTabs();
  tabs?.postMessage({ now: email });
  tabs?.postMessage(SESSION);
}

/** The person signed in changed what the frame shows of them: every tab's frame asks again. */
export function menuChanged() {
  window.dispatchEvent(new Event(MENU));
  otherTabs()?.postMessage(MENU);
}

/**
 * Runs `then` each time another tab says that someone else is signed in now than this tab
 * shows, or that nobody is: whatever this tab shows of whoever was signed in has to go, at
 * once and without waiting for the server (a page starts again; a line that names them is
 * taken away).
 */
export function useSessionElsewhere(then: () => void) {
  useEffect(() => {
    otherTabs();
    window.addEventListener(ELSEWHERE, then);
    return () => window.removeEventListener(ELSEWHERE, then);
  }, [then]);
}

/** How many times that has happened in this tab: a key for whatever has to start again. */
export function useSessionsElsewhere(): number {
  const [times, setTimes] = useState(0);
  useSessionElsewhere(useCallback(() => setTimes((n) => n + 1), []));
  return times;
}

export type Menu = {
  /** The person signed in: the name they gave (none until they have), and their address. */
  account: { name: string | null; email: string } | null;
  submissions: boolean;
  reviews: boolean;
};

/** What the frame shows of whoever is looking. Null until the server has said. */
export function useMenu(): Menu | null {
  const { pathname } = useLocation();
  const [menu, setMenu] = useState<Menu | null>(null);
  const show = useCallback((next: Menu | null) => {
    shown = next?.account?.email ?? null;
    setMenu(next);
  }, []);
  const asked = useRef(0);
  const ask = useCallback(() => {
    asked.current += 1;
    const mine = asked.current;
    api<Menu>("/api/me/menu").then((r) => {
      if (mine === asked.current) show(r.ok ? r.data : null);
    });
  }, [show]);
  const forget = useCallback(() => {
    show(null);
    ask();
  }, [show, ask]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again on every new page
  useEffect(ask, [pathname, ask]);
  useSessionElsewhere(forget);
  useEffect(() => {
    const broughtBack = (event: PageTransitionEvent) => {
      if (event.persisted) forget();
    };
    window.addEventListener(SESSION, forget);
    window.addEventListener(MENU, ask);
    window.addEventListener("pageshow", broughtBack);
    return () => {
      window.removeEventListener(SESSION, forget);
      window.removeEventListener(MENU, ask);
      window.removeEventListener("pageshow", broughtBack);
    };
  }, [ask, forget]);
  return menu;
}
