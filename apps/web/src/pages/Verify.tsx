import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { useT } from "../i18n";

export function VerifyPage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<"missing" | "failed" | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; a token works only once.
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // Remove the token from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setFailure("missing");
      return;
    }
    api("/api/auth/verify", { method: "POST", body: { token } }).then((res) => {
      if (res.ok) navigate(`/${lang}/me`, { replace: true });
      else setFailure("failed");
    });
  }, [lang, navigate]);

  return (
    <>
      <h1>{t("verifyTitle")}</h1>
      {failure && (
        <>
          <p role="alert">{failure === "missing" ? t("verifyMissing") : t("verifyFailed")}</p>
          <p>
            <Link to={`/${lang}/sign-in`}>{t("verifyAgain")}</Link>
          </p>
        </>
      )}
    </>
  );
}
