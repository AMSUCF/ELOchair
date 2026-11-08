import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useT } from "../i18n";
import { PageHeading } from "../ui";

type State = "idle" | "sending" | "sent" | "invalid" | "rate_limited" | "error";
type CodeState = "idle" | "checking" | "invalid" | "rate_limited" | "error";

export function SignInPage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<CodeState>("idle");

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await api("/api/auth/request-link", { method: "POST", body: { email, lang } });
    if (res.ok) setState("sent");
    else if (res.status === 429) setState("rate_limited");
    else if (res.status === 400) setState("invalid");
    else setState("error");
  }

  // For the installed app (and phones that open links in another browser): type the code.
  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setCodeState("checking");
    const res = await api("/api/auth/verify-code", { method: "POST", body: { email, code } });
    if (res.ok) navigate(`/${lang}/me`, { replace: true });
    else if (res.status === 429) setCodeState("rate_limited");
    else if (res.status === 400) setCodeState("invalid");
    else setCodeState("error");
  }

  const message = {
    idle: "",
    sending: "",
    sent: t("signInSent"),
    rate_limited: t("signInRateLimited"),
    invalid: t("signInInvalid"),
    error: t("errorGeneric"),
  }[state];
  const codeMessage = {
    idle: "",
    checking: "",
    invalid: t("signInCodeInvalid"),
    rate_limited: t("signInRateLimited"),
    error: t("verifyNetwork"),
  }[codeState];

  return (
    <>
      <PageHeading>{t("signInTitle")}</PageHeading>
      <p>{t("signInIntro")}</p>
      <form onSubmit={requestLink} className="stack" noValidate>
        <label htmlFor="email">{t("signInEmail")}</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="sign-in-status"
        />
        <button type="submit" disabled={state === "sending" || email.trim() === ""}>
          {state === "sending" ? t("signInSending") : t("signInSubmit")}
        </button>
      </form>
      <p id="sign-in-status" aria-live="polite" className="status-line">
        {message}
      </p>

      {state === "sent" && (
        <form onSubmit={submitCode} className="stack" noValidate>
          <p>{t("signInCodeIntro")}</p>
          <label htmlFor="code">{t("signInCodeLabel")}</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={9}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby="code-status"
          />
          <button
            type="submit"
            disabled={codeState === "checking" || code.replace(/\D/g, "").length !== 8}
          >
            {t("signInCodeSubmit")}
          </button>
          <p id="code-status" aria-live="polite" className="status-line">
            {codeMessage}
          </p>
        </form>
      )}
    </>
  );
}
