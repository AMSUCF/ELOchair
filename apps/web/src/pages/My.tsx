import type { LocalizedText } from "@elochair/schema";
import { Link } from "react-router";
import type { MySubmission } from "../api";
import { formatDateTime } from "../format";
import { useT } from "../i18n";
import { statusKey } from "../labels";
import { Localized, PageHeading } from "../ui";
import { useApi } from "../useApi";

type Item = {
  conference: {
    slug: string;
    title: LocalizedText;
    timezone: string;
    submissionsClose: string;
    callOpen: boolean;
    presenterCap: { count: number; max: number } | null;
  };
  submission: MySubmission;
};

export function MyPage() {
  const { lang, t } = useT();
  const res = useApi<{ items: Item[] }>("/api/me/submissions");
  if (!res) return <p role="status">{t("loading")}</p>;
  if (!res.ok) {
    return (
      <>
        <PageHeading>{t("myTitle")}</PageHeading>
        <p>
          {t("meNeedSignIn")} <Link to={`/${lang}/sign-in`}>{t("navSignIn")}</Link>
        </p>
      </>
    );
  }
  const items = res.data.items;
  const invitations = items.filter((i) => i.submission.view === "invitee");
  const mine = items.filter((i) => i.submission.view !== "invitee");
  const caps = new Map(items.map((i) => [i.conference.slug, i.conference]));
  return (
    <>
      <PageHeading>{t("myTitle")}</PageHeading>
      {invitations.length > 0 && (
        <section aria-labelledby="inv-heading">
          <h2 id="inv-heading">{t("myInvitations")}</h2>
          <ul className="cards">
            {invitations.map((i) => (
              <Row key={i.submission.id} item={i} />
            ))}
          </ul>
        </section>
      )}
      {mine.length === 0 ? (
        <p>{t("myEmpty")}</p>
      ) : (
        <ul className="cards">
          {mine.map((i) => (
            <Row key={i.submission.id} item={i} />
          ))}
        </ul>
      )}
      {[...caps.values()]
        .filter((k) => k.presenterCap)
        .map((k) => (
          <p
            key={k.slug}
            className={
              k.presenterCap && k.presenterCap.count > k.presenterCap.max ? "notice" : "meta"
            }
          >
            <Localized text={k.title} />:{" "}
            {k.presenterCap &&
              (k.presenterCap.count > k.presenterCap.max
                ? t("capOver", k.presenterCap)
                : t("capNote", k.presenterCap))}
          </p>
        ))}
    </>
  );
}

function Row({ item }: { item: Item }) {
  const { lang, t } = useT();
  const s = item.submission;
  const k = item.conference;
  return (
    <li className="card">
      <h3>
        <Link to={`/${lang}/s/${s.id}`}>{s.title || t("editUntitled")}</Link>
      </h3>
      <p className="meta">
        <Localized text={k.title} />
      </p>
      <p>
        <span className={`badge status-${s.status}`}>{t(statusKey(s.status))}</span>
      </p>
      {k.callOpen && s.status === "draft" && (
        <p className="meta">
          {t("editDeadline", {
            date: `${formatDateTime(k.submissionsClose, lang, k.timezone)} (${k.timezone})`,
          })}
        </p>
      )}
    </li>
  );
}
