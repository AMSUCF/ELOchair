import { afterSignIn } from "@elochair/schema/pure";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { type ApiResult, api, type Profile } from "./api";
import { useT } from "./i18n";
import { sessionChanged, useSessionsElsewhere } from "./session";
import { PageHeading } from "./ui";

/*
 * Signing in, on the page where the person is (spec 02, §1.11). A page that needs someone
 * signed in shows this form in place of what it would show them, and signing in brings them to
 * that page:
 * - by the emailed link, which carries the page's address (`next`) beside its token and leads
 *   there after the tap on "Sign in" (Verify.tsx);
 * - by the code from the same email, typed here: the person is signed in on the page itself,
 *   which then starts again for them (SignedInPages in App.tsx).
 */

/**
 * Starts the page again, for whoever has just signed in on it. Set by SignedInPages for the
 * pages that show a person what is theirs; there is none on a page that carries on as it is
 * (an invitation's).
 */
export const PageRestart = createContext<(() => void) | null>(null);

type State = "idle" | "sending" | "sent" | "invalid" | "rate_limited" | "error";
type CodeState = "idle" | "checking" | "invalid" | "rate_limited" | "error";

/**
 * The server said that nobody is signed in. A request that failed for another reason (the
 * network, a refusal) says nothing of the kind.
 */
export const nobodySignedIn = (answer: ApiResult<unknown>) => !answer.ok && answer.status === 401;

/**
 * This page's own address with its query, as a sign-in started on it names it. Never its
 * fragment: an invitation's token travels there, and must not reach an email.
 */
export function useHere(): string {
  const { pathname, search } = useLocation();
  return pathname + search;
}

/**
 * The sign-in form: the address, the button that sends the email, what happened, and the form
 * for the code from that email.
 * - `next`: where the emailed link leads once the person has signed in, an address inside the
 *   app (`afterSignIn` says which those are; any other is not sent, and nothing is promised).
 *   Without one the link leads to "Your account".
 * - `email`: the address the field starts with, where the page knows it.
 * - `onSignedIn`: what the page does once the typed code has signed the person in, if
 *   anything (the sign-in page goes to "Your account").
 *
 * Once the code has signed the person in, a page under SignedInPages starts again, and shows
 * them what they came for. On any other page the form gives way to a line that says who is
 * signed in, and the page carries on.
 *
 * That line names a person. When another tab says that someone else is signed in now, or
 * nobody, the form starts again as it first was, on a page that carries on as it is (an
 * invitation's keeps its token).
 */
export function SignInForm(props: SignInFormProps) {
  const session = useSessionsElsewhere();
  return <FormForThisSession key={session} {...props} />;
}

type SignInFormProps = {
  next?: string;
  email?: string;
  onSignedIn?: () => void;
};

function FormForThisSession({ next, email: handed = "", onSignedIn }: SignInFormProps) {
  const { lang, t } = useT();
  const restart = useContext(PageRestart);
  const [email, setEmail] = useState(handed);
  const [state, setState] = useState<State>("idle");
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<CodeState>("idle");
  // Codes already emailed keep working for 20 minutes, even if a later request fails.
  const [sentOnce, setSentOnce] = useState(false);
  /** The address the typed code signed in: the form has done its work, and says so. */
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const back = afterSignIn(next);

  // The form is gone: the line that says what happened takes the focus it had.
  useEffect(() => {
    if (signedInAs !== null) doneRef.current?.focus();
  }, [signedInAs]);

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setCode("");
    setCodeState("idle");
    const res = await api("/api/auth/request-link", {
      method: "POST",
      body: { email, lang, ...(back ? { next: back } : {}) },
    });
    if (res.ok) {
      setState("sent");
      setSentOnce(true);
    } else if (res.status === 429) setState("rate_limited");
    else if (res.status === 400) setState("invalid");
    else setState("error");
  }

  // For the installed app (and phones that open links in another browser): type the code.
  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setCodeState("checking");
    const res = await api<{ person: Profile | null }>("/api/auth/verify-code", {
      method: "POST",
      body: { email, code },
    });
    if (res.ok) {
      setSignedInAs(res.data.person?.email ?? email.trim());
      sessionChanged(res.data.person?.email ?? null);
      restart?.();
      onSignedIn?.();
    } else if (res.status === 429) setCodeState("rate_limited");
    else if (res.status === 400) setCodeState("invalid");
    else setCodeState("error");
  }

  if (signedInAs !== null) {
    return (
      // Not a second role="status": the pages that keep this form have a status line of their own.
      <p className="status-line" aria-live="polite" tabIndex={-1} ref={doneRef}>
        {t("signInDone", { email: signedInAs })}
      </p>
    );
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

  const codeForm = (
    <form onSubmit={submitCode} className="stack" noValidate>
      <p>{t("signInCodeIntro")}</p>
      <label htmlFor="sign-in-code">{t("signInCodeLabel")}</label>
      <input
        id="sign-in-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={9}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-describedby="sign-in-code-status"
      />
      <button
        type="submit"
        disabled={codeState === "checking" || code.replace(/\D/g, "").length !== 8}
      >
        {t("signInCodeSubmit")}
      </button>
      <p id="sign-in-code-status" aria-live="polite" className="status-line">
        {codeMessage}
      </p>
    </form>
  );

  return (
    <>
      <p>{t("signInIntro")}</p>
      <form onSubmit={requestLink} className="stack" noValidate>
        <label htmlFor="sign-in-email">{t("signInEmail")}</label>
        <input
          id="sign-in-email"
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
        {/* Said only where it is so: the link leads back here if this page's address is carried. */}
        {back && <p className="meta">{t("signInComesBack")}</p>}
      </form>
      <p id="sign-in-status" aria-live="polite" className="status-line">
        {message}
      </p>

      {sentOnce ? (
        codeForm
      ) : (
        <details>
          <summary>{t("signInHaveCode")}</summary>
          {codeForm}
        </details>
      )}
    </>
  );
}

/**
 * What a page that needs someone signed in shows when nobody is: its own heading, one sentence
 * that says why to sign in, and the form, which brings the person back to this very page.
 * `children` stand between the sentence and the form.
 */
export function SignInHere({
  title,
  why,
  children,
}: {
  title: string;
  why: string;
  children?: ReactNode;
}) {
  const here = useHere();
  return (
    <>
      <PageHeading>{title}</PageHeading>
      <p>{why}</p>
      {children}
      <SignInForm next={here} />
    </>
  );
}
