import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

type State = "idle" | "sending" | "sent" | "invalid" | "rate_limited" | "error";

export function SignInPage() {
  const { lang, t } = useT();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await api("/api/auth/request-link", { method: "POST", body: { email, lang } });
    if (res.ok) setState("sent");
    else if (res.status === 429) setState("rate_limited");
    else if (res.status === 400) setState("invalid");
    else setState("error");
  }

  const message =
    state === "sent"
      ? t("signInSent")
      : state === "rate_limited"
        ? t("signInRateLimited")
        : state === "invalid"
          ? t("signInInvalid")
          : state === "error"
            ? t("errorGeneric")
            : "";

  return (
    <>
      <h1>{t("signInTitle")}</h1>
      <p>{t("signInIntro")}</p>
      <form onSubmit={submit} className="stack" noValidate>
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
      <p
        id="sign-in-status"
        role={state === "sent" ? "status" : "alert"}
        aria-live="polite"
        className="status-line"
      >
        {message}
      </p>
    </>
  );
}
