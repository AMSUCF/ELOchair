import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Me } from "../api";
import { type MessageKey, useT } from "../i18n";
import { PageHeading } from "../ui";
import { useApi } from "../useApi";

export function MePage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const res = useApi<Me>("/api/me");
  const [signOutFailed, setSignOutFailed] = useState(false);

  if (!res) return <p role="status">{t("loading")}</p>;
  if (!res.ok || res.data.kind !== "person") {
    return (
      <>
        <PageHeading>{t("meTitle")}</PageHeading>
        <p>{t("meNeedSignIn")}</p>
        <p>
          <Link className="button" to={`/${lang}/sign-in`}>
            {t("navSignIn")}
          </Link>
        </p>
      </>
    );
  }
  const me = res.data;
  async function signOut() {
    const out = await api("/api/auth/logout", { method: "POST", body: {} });
    if (out.ok) navigate(`/${lang}/`);
    else setSignOutFailed(true);
  }
  return (
    <>
      <PageHeading>{t("meTitle")}</PageHeading>
      <dl className="details">
        <div>
          <dt>{t("meEmail")}</dt>
          <dd>{me.person?.email}</dd>
        </div>
        <div>
          <dt>{t("meName")}</dt>
          <dd>{me.person?.displayName ?? t("meNotSet")}</dd>
        </div>
      </dl>
      <h2>{t("meRoles")}</h2>
      {me.roles.length === 0 ? (
        <p>{t("meNoRoles")}</p>
      ) : (
        <ul>
          {me.roles.map((r) => (
            <li key={`${r.conference}-${r.role}`}>
              {r.conference}: {t(`role_${r.role}` as MessageKey)}
              {r.scope.length > 0 && ` (${r.scope.join(", ")})`}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={signOut}>
        {t("meSignOut")}
      </button>
      <p role="alert" className="status-line">
        {signOutFailed ? t("meSignOutFailed") : ""}
      </p>
    </>
  );
}
