import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { api } from "./api";

/*
 * What the page's frame needs to know about whoever is looking (GET /api/me/menu, which
 * answers everyone, signed in or not):
 * - who is signed in, for the link to their account at the top right, or that nobody is, for
 *   "Sign in" in its place;
 * - which of a person's own pages the main menu offers: "My submissions" once they are on a
 *   proposal or invited to one, "My reviews" if they review somewhere. A page with nothing on
 *   it is not offered.
 *
 * The frame outlives a sign-in and a sign-out, so whatever does either says so
 * (sessionChanged), and the frame asks again. It also asks whenever the page changes: starting
 * a proposal, or deleting the only one, changes what the menu offers, and no page has to
 * remember to say so.
 */

const CHANGED = "elochair:session";

/** Someone signed in or out in this tab: what the frame shows of them is asked for again. */
export const sessionChanged = () => window.dispatchEvent(new Event(CHANGED));

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again on every new page
  useEffect(() => {
    let live = true;
    const ask = () =>
      api<Menu>("/api/me/menu").then((r) => {
        // An answer that did not arrive changes nothing: the frame stays as it was.
        if (live && r.ok) setMenu(r.data);
      });
    ask();
    window.addEventListener(CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, ask);
    };
  }, [pathname]);
  return menu;
}
