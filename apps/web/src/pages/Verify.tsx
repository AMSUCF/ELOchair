import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Me } from "../api";
import { useT } from "../i18n";
import { PageHeading } from "../ui";

type State =
  | { step: "checking" }
  | { step: "missing" }
  | { step: "expired" }
  | { step: "network" }
  | { step: "confirm"; email: string; currentEmail: string | null }
  | { step: "signing-in"; email: string };

/** Read the token once, then remove it from the address bar and history. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/**
 * The link only signs in after a tap on "Sign in". Opening the page alone uses nothing up, so
 * mail scanners cannot consume links, and another site cannot sign someone into a different
 * account without them seeing which account it is.
 */
export function VerifyPage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const [token] = useState(takeToken);
  const [state, setState] = useState<State>({ step: "checking" });

  useEffect(() => {
    if (!token) {
      setState({ step: "missing" });
      return;
    }
    let live = true;
    Promise.all([
      api<{ email: string }>("/api/auth/link-info", { method: "POST", body: { token } }),
      api<Me>("/api/me"),
    ]).then(([info, me]) => {
      if (!live) return;
      if (info.ok) {
        const current = me.ok && me.data.kind === "person" ? (me.data.person?.email ?? null) : null;
        setState({
          step: "confirm",
          email: info.data.email,
          currentEmail: current && current !== info.data.email ? current : null,
        });
      } else setState({ step: info.status === 400 ? "expired" : "network" });
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function signIn(email: string) {
    setState({ step: "signing-in", email });
    const res = await api("/api/auth/verify", { method: "POST", body: { token } });
    if (res.ok) navigate(`/${lang}/me`, { replace: true });
    else if (res.status === 400) setState({ step: "expired" });
    else setState({ step: "network" });
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
        <>
          <p role="alert">{t("verifyNetwork")}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {t("verifyAgain")}
          </button>
        </>
      )}
      {(state.step === "expired" || state.step === "missing") && (
        <>
          <p role="alert">{state.step === "missing" ? t("verifyMissing") : t("verifyFailed")}</p>
          <p>
            <Link to={`/${lang}/sign-in`}>{t("verifyAgain")}</Link>
          </p>
        </>
      )}
    </>
  );
}
