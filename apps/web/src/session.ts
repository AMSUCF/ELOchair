import { useEffect, useState } from "react";
import { api } from "./api";

/*
 * What the page's frame needs to know about who is signed in: one thing, whether they review
 * anywhere, which decides whether the main menu offers "My reviews". The server answers for
 * everyone, signed in or not (GET /api/me/menu), with a yes or a no and nothing else.
 *
 * The frame outlives a sign-in and a sign-out, so the pages that do either say so
 * (sessionChanged), and the frame asks again.
 */

const CHANGED = "elochair:session";

/** Someone signed in or out in this tab: what the frame shows of them is asked for again. */
export const sessionChanged = () => window.dispatchEvent(new Event(CHANGED));

/** Whether the person signed in holds a reviewer's role at any conference. */
export function useReviews(): boolean {
  const [reviews, setReviews] = useState(false);
  useEffect(() => {
    let live = true;
    const ask = () =>
      api<{ reviews: boolean }>("/api/me/menu").then((r) => {
        if (live) setReviews(r.ok && r.data.reviews === true);
      });
    ask();
    window.addEventListener(CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, ask);
    };
  }, []);
  return reviews;
}
