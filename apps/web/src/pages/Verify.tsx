import { afterSignIn } from "@elochair/schema/pure";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Me } from "../api";
import { useT } from "../i18n";
import { sessionChanged, useSessionElsewhere } from "../session";
import { nobodySignedIn } from "../signIn";
import { PageHeading } from "../ui";

type State =
  | { step: "checking" }
  | { step: "missing" }
  | { step: "expired" }
  /** The server could not be reached; `email` is set when the failure was signing in. */
  | { step: "network"; email: string | null }
  | { step: "confirm"; email: string; currentEmail: string | null }
  | { step: "signing-in"; email: string };

/**
 * Read the link's fragment once, then remove it from the address bar and history: the token,
 * and where the person was going when they asked for the link, if the link says so. That
 * address is whatever stood in a link somebody followed, so `afterSignIn` is asked before it is
 * believed: anything but an address inside the app is dropped here, and the person lands on
 * "Your account".
 */
function takeLink(): { token: string | null; next: string | null } {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return { token: fragment.get("token"), next: afterSignIn(fragment.get("next")) };
}

/**
 * The link only signs in after a tap on "Sign in". Opening the page alone uses nothing up, so
 * mail scanners cannot consume links, and another site cannot sign someone into a different
 * account without them seeing which account it is. The token stays in memory only, so "Try
 * again" after a network error retries without needing the link again. Signed in, the person
 * is taken to the page they asked for the link on (signIn.tsx), or to "Your account".
 *
 * The page a link names is where it leads only if the link takes nobody else's place. That is
 * asked of the server at the tap, about the session this browser has then: the answer has to
 * be that nobody is signed in, or the person the link is for. Anything else (another account,
 * or no answer) leads to "Your account", which names the account the person is in from then
 * on. Nobody asks for such a link on a page of the app: its pages have the form only while
 * nobody is signed in. So a link that somebody else made, for their own account, does no more
 * to a person who is signed in than it could before links named a page. (Someone who is not
 * signed in is told which account the link is for, and lands where it says once they tap.)
 */
export function VerifyPage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const [{ token, next }] = useState(takeLink);
  const [state, setState] = useState<State>({ step: "checking" });
  // Each asking of whose account the browser is in, counted: only the answers to the latest
  // are used. `asks` says whether the page is still asking or showing the answer; once the
  // person has tapped, or the link has failed, it says nothing of the account any more.
  const asking = useRef(0);
  const asks = useRef(true);

  const check = useCallback(async () => {
    asking.current += 1;
    const mine = asking.current;
    asks.current = Boolean(token);
    if (!token) {
      setState({ step: "missing" });
      return;
    }
    setState({ step: "checking" });
    const [info, me] = await Promise.all([
      api<{ email: string }>("/api/auth/link-info", { method: "POST", body: { token } }),
      api<Me>("/api/me"),
    ]);
    // Asked again since (another tab said that the account changed), or tapped: these
    // answers are about the account before, and are dropped.
    if (mine !== asking.current) return;
    if (!info.ok) {
      asks.current = false;
      setState(info.status === 400 ? { step: "expired" } : { step: "network", email: null });
      return;
    }
    // (An answer that is no answer, such as a proxy's page, is read as nobody: `data?.`.)
    const current = me.ok && me.data?.kind === "person" ? (me.data.person?.email ?? null) : null;
    setState({
      step: "confirm",
      email: info.data.email,
      currentEmail: current && current !== info.data.email ? current : null,
    });
  }, [token]);

  useEffect(() => {
    check();
  }, [check]);

  // The page says whose account the browser is in, where the link is for another. Each time
  // another tab says that this has changed, it asks again, and says nothing of it meanwhile:
  // also while an earlier asking is still on its way, whose answers are then dropped.
  useSessionElsewhere(
    useCallback(() => {
      if (asks.current) check();
    }, [check]),
  );

  async function signIn(email: string) {
    asking.current += 1;
    asks.current = false;
    setState({ step: "signing-in", email });
    // Whose place the link takes is asked now, not when the page opened: someone may have
    // signed in on this browser since. Only a link that names a page needs the answer.
    const me = next ? await api<Me>("/api/me") : null;
    const takesNobodysPlace =
      me !== null &&
      (nobodySignedIn(me) ||
        (me.ok && me.data?.kind === "person" && me.data.person?.email === email));
    const res = await api("/api/auth/verify", { method: "POST", body: { token } });
    if (res.ok) {
      sessionChanged(email);
      navigate((takesNobodysPlace && next) || `/${lang}/me`, { replace: true });
    } else if (res.status === 400) setState({ step: "expired" });
    else setState({ step: "network", email });
  }

  return (
    <>
      <PageHeading>{t("verifyTitle")}</PageHeading>
      {state.step === "checking" && <p role="status">{t("loading")}</p>}
      {(state.step === "confirm" || state.step === "signing-in") && (
        <div className="stack">
          <p>{t("verifyConfirm", { email: state.email })}</p>
          {state.step === "confirm" && state.currentEmail && (
            <p className="notice">{t("verifySwitchWarning", { email: state.currentEmail })}</p>
          )}
          <button
            type="button"
            disabled={state.step === "signing-in"}
            onClick={() => signIn(state.email)}
          >
            {state.step === "signing-in" ? t("verifySigningIn") : t("verifyButton")}
          </button>
        </div>
      )}
      {state.step === "network" && (
        <div className="stack">
          <p role="alert">{t("verifyNetwork")}</p>
          <button type="button" onClick={() => (state.email ? signIn(state.email) : check())}>
            {t("verifyRetry")}
          </button>
        </div>
      )}
      {(state.step === "expired" || state.step === "missing") && (
        <>
          <p role="alert">{state.step === "missing" ? t("verifyMissing") : t("verifyFailed")}</p>
          <p>
            {/* The page they were going to has the sign-in form on it, and asks for a link
                that leads back to it again. */}
            <Link className="block-link" to={next ?? `/${lang}/sign-in`}>
              {t("verifyAgain")}
            </Link>
          </p>
        </>
      )}
    </>
  );
}
