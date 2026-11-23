import { effectiveBlindMode, localizeWithLang } from "@elochair/schema/pure";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import type { ConferenceDetail } from "./api";
import { deadlineText } from "./format";
import {
  chosenIndex,
  formatAction,
  formatAnchor,
  formatAsks,
  formatFigures,
  type ListedFormat,
  listedFormats,
  startAddress,
  steppedIndex,
  two,
} from "./formats";
import { useT } from "./i18n";
import { ProposalLanguages } from "./invitationParts";
import { reviewKey } from "./labels";
import { Localized, LocalizedEcho, Pair, SectionHeading, Stat } from "./ui";

/*
 * A call's formats on the conference's page, one at a time: the formats view of the design
 * preview (docs/design/visitor-preview), for every conference, in the app's own identity. A
 * chooser (a list on a wide screen, a select on a phone) and one panel for the chosen format,
 * with everything the configuration says of it. formats.ts holds what is shown; this file
 * shows it.
 *
 * Which format is chosen is in the address ("#format-<key>"), so a link to a format arrives
 * with it chosen, and the address always names the one on show.
 */

/**
 * The formats section. `moveTo` names a part of the page in the address without taking anyone
 * there (useHashTarget): the chooser shows the format in place, and keeps the focus.
 */
export function FormatsView({
  detail,
  number,
  moveTo,
}: {
  detail: ConferenceDetail;
  number: string;
  moveTo: (id: string) => void;
}) {
  const { lang, t } = useT();
  const { hash } = useLocation();
  const c = detail.config;
  const fb = c.defaultLanguage;
  const formats = listedFormats(c);
  const at = chosenIndex(formats, hash);
  const chosen = formats[at];
  // The format a control chose in place. It is said once, for people who cannot see the panel
  // change; arriving by a link says nothing here, because the format's heading takes the focus.
  const [said, setSaid] = useState<string | null>(null);
  if (!chosen) return null;

  const nameOf = (format: ListedFormat) => localizeWithLang(format.name, lang, fb);
  const choose = (index: number) => {
    const next = formats[index];
    if (!next) return;
    setSaid(next.key);
    moveTo(formatAnchor(next.key));
  };

  return (
    <section aria-labelledby="formats" className="formats-view" data-arrive-at-start>
      <SectionHeading id="formats" k="confFormats" number={number} />
      {c.formatsIntro && (
        <p className="formats-intro">
          <Localized text={c.formatsIntro} fallback={fb} />
          <LocalizedEcho text={c.formatsIntro} below />
        </p>
      )}
      <div className="formats-lead">
        <ProposalLanguages languages={c.languages} />
        {c.website && (
          <a className="block-link paired" href={c.website} rel="noreferrer">
            <Pair k="formatOfficial" mark="↗" />
          </a>
        )}
      </div>

      <div className="formats-body">
        {/* The chooser on a phone: one labelled select. The styles show it or the list, never
            both. */}
        <div className="format-select">
          <label htmlFor="format-select">{t("formatLabel")}</label>
          <select
            id="format-select"
            value={chosen.key}
            onChange={(e) => choose(formats.findIndex((format) => format.key === e.target.value))}
          >
            {formats.map((format, i) => {
              const name = nameOf(format);
              return (
                <option
                  key={format.key}
                  value={format.key}
                  lang={name.lang.split("-")[0] === lang ? undefined : name.lang}
                >
                  {two(i + 1)} · {name.text}
                </option>
              );
            })}
          </select>
        </div>

        <div className="formats-layout">
          {/* The chooser on a wide screen: every format, the chosen one marked. */}
          <ul className="format-list" aria-label={t("formatLabel")}>
            {formats.map((format, i) => {
              const pool = c.reviewPools.find((p) => p.key === format.type?.reviewPool);
              return (
                <li key={format.key}>
                  <button
                    type="button"
                    className="format-choice"
                    aria-current={i === at ? "true" : undefined}
                    onClick={() => choose(i)}
                  >
                    <span className="format-number" aria-hidden="true">
                      {two(i + 1)}
                    </span>
                    <span className="format-name">
                      <Localized text={format.name} fallback={fb} />
                      <LocalizedEcho text={format.name} below />
                    </span>
                    {/* A space, so that the name and the committee are heard as two things. */}{" "}
                    {format.type ? (
                      pool && (
                        <span className="tag">
                          <Localized text={pool.name} fallback={fb} />
                        </span>
                      )
                    ) : (
                      <span className="tag">{t("confNotHere")}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <FormatPanel
            detail={detail}
            format={chosen}
            index={at}
            total={formats.length}
            onStep={(step) => choose(steppedIndex(formats.length, at, step))}
          />
        </div>
      </div>

      <p className="visually-hidden" role="status">
        {said === chosen.key &&
          t("formatShowing", { name: nameOf(chosen).text, n: at + 1, total: formats.length })}
      </p>
    </section>
  );
}

/**
 * The panel of the chosen format, most important first: its name, its figures, what it is,
 * what the form asks for, who reviews it and how, the way to start a proposal in it (or when
 * that will be possible, or that it no longer is), and the way to the formats beside it.
 */
function FormatPanel({
  detail,
  format,
  index,
  total,
  onStep,
}: {
  detail: ConferenceDetail;
  format: ListedFormat;
  index: number;
  total: number;
  onStep: (step: -1 | 1) => void;
}) {
  const { lang, t } = useT();
  const c = detail.config;
  const fb = c.defaultLanguage;
  const type = format.type;
  const pool = c.reviewPools.find((p) => p.key === type?.reviewPool);
  const action = formatAction(format, detail.callState);

  return (
    <div className="format-panel">
      {/* "FORMAT 01 / 08" as the design sets it, and in words for people who hear it. */}
      <p className="format-position">
        <span aria-hidden="true">
          {t("formatLabel")} {two(index + 1)} / {two(total)}
        </span>
        <span className="visually-hidden">{t("formatPosition", { n: index + 1, total })}</span>
      </p>
      <h3 id={formatAnchor(format.key)} tabIndex={-1} className="format-title">
        <Localized text={format.name} fallback={fb} />
        <LocalizedEcho text={format.name} below />
      </h3>

      {type ? (
        <ul className="stats">
          {formatFigures(type, lang).map((figure) => (
            <Stat key={figure.label} value={figure.value} label={t(figure.label)} />
          ))}
        </ul>
      ) : (
        <p className="format-elsewhere">{t("confNotHere")}</p>
      )}

      <p className="format-description">
        <Localized text={format.description} fallback={fb} />
      </p>

      {type && (
        <dl className="format-details">
          <div>
            <dt>{t("formatAsks")}</dt>
            <dd>
              <ul className="format-asks">
                {formatAsks(type).map((asked) => (
                  <li key={asked.id}>
                    <span>
                      <Localized text={asked.label} fallback={fb} />
                    </span>
                    {/* The space is for people who hear the line: the two are read as two words. */}
                    {asked.required && " "}
                    {asked.required && <span className="format-required">{t("confRequired")}</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>{t("formatReviewedBy")}</dt>
            <dd>
              {pool && (
                <p className="format-committee">
                  <Localized text={pool.name} fallback={fb} />
                </p>
              )}
              <p>{t(reviewKey(effectiveBlindMode(c, type.key)))}</p>
            </dd>
          </div>
        </dl>
      )}

      {action === "start" && (
        <p className="actions">
          <Link className="button" to={startAddress(lang, detail.slug, format.key)}>
            <Pair k="formatStart" />
            <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}
      {action === "opens" && (
        <p className="status-line">
          {t("confSubmitNotYet", {
            date: deadlineText(c.deadlines.submissionsOpen, lang, c.timezone, t),
          })}
        </p>
      )}
      {action === "closed" && (
        <p className="status-line">
          <Pair k="inviteWindowClosed" />
        </p>
      )}
      {action === "elsewhere" && c.website && (
        <p className="actions">
          <a className="button secondary" href={c.website} rel="noreferrer">
            <Pair k="formatOfficial" />
            <span aria-hidden="true">↗</span>
          </a>
        </p>
      )}

      <p className="actions">
        <button type="button" className="secondary" onClick={() => onStep(-1)}>
          <span aria-hidden="true">←</span>
          <Pair k="formatPrevious" />
        </button>
        <button type="button" className="secondary" onClick={() => onStep(1)}>
          <Pair k="formatNext" />
          <span aria-hidden="true">→</span>
        </button>
      </p>
    </div>
  );
}
