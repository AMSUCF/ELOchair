import type { Agreement, LocalizedText } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Role } from "../api";
import { type MessageKey, useT } from "../i18n";
import { Localized, PageHeading } from "../ui";

type Info = {
  submissionId: string;
  conference: {
    slug: string;
    title: LocalizedText;
    timezone: string;
    submissionsClose: string;
    callOpen: boolean;
  };
  format: string;
  title: string;
  ownerName: string | null;
  role: Role;
  invitedName: string | null;
  presenterCap: { max: number; roleCounts: boolean; countIfConfirmed: number | null } | null;
  agreements: Agreement[];
};

/** Read the token once, then remove it from the address bar and history. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/** The page an invitation email links to. Declining needs no account; confirming needs consent. */
export function InvitationPage() {
  const { lang, t } = useT();
  const [token] = useState(takeToken);
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<"confirmed" | "declined" | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setFailed(true);
      return;
    }
    api<Info>("/api/invitations/info", { method: "POST", body: { token } }).then((r) => {
      if (r.ok) {
        setInfo(r.data);
        setName(r.data.invitedName ?? "");
      } else setFailed(true);
    });
  }, [token]);

  async function answer(a: "confirm" | "decline") {
    if (!info || !token) return;
    const res = await api<{ answer: "confirmed" | "declined" }>("/api/invitations/answer", {
      method: "POST",
      body: {
        token,
        answer: a,
        acceptedAgreements: info.agreements
          .filter((x) => agreed.has(x.key))
          .map((x) => ({ key: x.key, version: x.version })),
        ...(a === "confirm" && name.trim() ? { displayName: name.trim() } : {}),
      },
    });
    if (res.ok) setDone(res.data.answer);
    else
      setMessage(
        res.error === "call_closed"
          ? t("invClosed")
          : res.issues.length
            ? t("issue_agreements_required")
            : t("invInvalid"),
      );
  }

  if (failed) {
    return (
      <>
        <PageHeading>{t("invTitle")}</PageHeading>
        <p role="alert">{t("invInvalid")}</p>
      </>
    );
  }
  if (!info) return <p role="status">{t("loading")}</p>;
  if (done) {
    return (
      <>
        <PageHeading>{t("invTitle")}</PageHeading>
        <p role="status">{done === "confirmed" ? t("invConfirmed") : t("invDeclined")}</p>
        {done === "confirmed" && (
          <p>
            <Link className="button" to={`/${lang}/sign-in`}>
              {t("navSignIn")}
            </Link>
          </p>
        )}
      </>
    );
  }
  const cap = info.presenterCap;
  const allAgreed = info.agreements.every((a) => agreed.has(a.key));
  return (
    <>
      <PageHeading>{t("invTitle")}</PageHeading>
      <p>
        {t("invIntro", {
          owner: info.ownerName ?? "—",
          role: t(`contrib_${info.role}` as MessageKey),
          conference: localize(info.conference.title, lang),
        })}
      </p>
      <dl className="details">
        <div>
          <dt>{t("invFormat")}</dt>
          <dd>{info.format}</dd>
        </div>
        <div>
          <dt>{t("invProposal")}</dt>
          <dd>{info.title || t("editUntitled")}</dd>
        </div>
      </dl>
      {cap && (
        <p className="meta">
          {cap.roleCounts && cap.countIfConfirmed !== null
            ? t("invCapCounts", { max: cap.max, count: cap.countIfConfirmed })
            : t("invCapNot")}
        </p>
      )}
      {!info.conference.callOpen && <p className="notice">{t("invClosed")}</p>}
      <div className="stack wide">
        {info.conference.callOpen && (
          <>
            <label htmlFor="inv-name">{t("invYourName")}</label>
            <input
              id="inv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            {info.agreements.length > 0 && (
              <fieldset>
                <legend>{t("editAgreements")}</legend>
                {info.agreements.map((a) => (
                  <div key={a.key} className="agreement">
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={agreed.has(a.key)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setAgreed((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(a.key);
                            else next.delete(a.key);
                            return next;
                          });
                        }}
                      />
                      <span>{t("editAgree", { title: localize(a.title, lang) })}</span>
                    </label>
                    {a.text && (
                      <p className="meta">
                        <Localized text={a.text} />
                      </p>
                    )}
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        {t("editRead")}
                      </a>
                    )}
                  </div>
                ))}
              </fieldset>
            )}
            <button type="button" disabled={!allAgreed} onClick={() => answer("confirm")}>
              {t("editConfirm")}
            </button>
          </>
        )}
        <button type="button" className="secondary" onClick={() => answer("decline")}>
          {t("editDecline")}
        </button>
        <p className="status-line" role="status">
          {message}
        </p>
      </div>
    </>
  );
}
