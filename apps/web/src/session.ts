import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { api } from "./api";

/*
 * What the page's frame needs to know about whoever is looking (GET /api/me/menu, which
 * answers everyone, signed in or not):
 * - who is signed in, for the link to their account at the right of the header, or that
 *   nobody is, for "Sign in" in its place;
 * - which of a person's own pages the main menu offers: "My submissions" once they are on a
 *   proposal or invited to one, "My reviews" if they review somewhere. A page with nothing on
 *   it is not offered.
 *
 * The frame outlives a sign-in and a sign-out, and what it shows is a person's name. So:
 * - Whatever signs someone in or out says so (sessionChanged). The frame forgets at once who
 *   it showed, and asks: the name of whoever was here is never shown to whoever comes next,
 *   not even while the answer is on its way. It does the same when the browser brings the
 *   page back as it was left, by the back button: someone may have signed out since.
 * - Whatever changes what the frame shows of the same person says so too (menuChanged: their
 *   name, a role accepted), and the frame asks again, showing what it showed until then.
 * - The frame also asks each time the page changes: starting a proposal, or deleting the only
 *   one, changes what the menu offers, and no page has to remember to say so.
 * - Only the answer to the latest question counts. One that comes late, to a question from
 *   before someone signed in or out, is dropped; and when the latest does not arrive, the
 *   frame shows nobody rather than whoever was there before.
 */

const SESSION = "elochair:session";
const MENU = "elochair:menu";

/** Someone signed in or out in this tab: the frame forgets who it showed, and asks again. */
export const sessionChanged = () => window.dispatchEvent(new Event(SESSION));

/** The person signed in changed what the frame shows of them: the frame asks again. */
export const menuChanged = () => window.dispatchEvent(new Event(MENU));

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
  const asked = useRef(0);
  const ask = useCallback(() => {
    asked.current += 1;
    const mine = asked.current;
    api<Menu>("/api/me/menu").then((r) => {
      if (mine === asked.current) setMenu(r.ok ? r.data : null);
    });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again on every new page
  useEffect(ask, [pathname, ask]);
  useEffect(() => {
    const forget = () => {
      setMenu(null);
      ask();
    };
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
  }, [ask]);
  return menu;
}
