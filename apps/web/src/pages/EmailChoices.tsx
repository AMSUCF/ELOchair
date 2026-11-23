import {
  DEFAULT_NOTIFICATION_CHOICES,
  localize,
  NOTICE_FREQUENCIES,
  type NoticeFrequency,
} from "@elochair/schema/pure";
import { type FormEvent, useRef, useState } from "react";
import { api, type EmailChoices } from "../api";
import { type MessageKey, useT } from "../i18n";
import { Localized, useHashTarget } from "../ui";

/*
 * "Your account": the emails of the review phase (spec 03, §1.7), as often as the person wants
 * them, at each conference where they review or chair. A reviewer chooses how they are told of
 * new assignments and whether they are reminded before reviews are due; a chair chooses how
 * they are told of what happens in the review. Each part is shown only to someone it applies
 * to, and nothing at all to someone who neither reviews nor chairs anywhere. What cannot be
 * turned off (invitations, the sign-in email) is said once, under the heading.
 *
 * Every one of these emails links here ("#emails"): the heading takes focus when it does.
 */

const OFTEN: Record<NoticeFrequency, MessageKey> = {
  each: "emailsEach",
  daily: "emailsDaily",
  none: "emailsNone",
};

export function EmailChoicesSection({ conferences }: { conferences: EmailChoices[] }) {
  const { t } = useT();
  useHashTarget(true);
  if (conferences.length === 0) return null;
  return (
    <section className="email-choices stack wide" aria-labelledby="emails">
      <h2 id="emails" tabIndex={-1}>
        {t("emailsTitle")}
      </h2>
      {/* Said once, for every conference below: what no choice here turns off. */}
      <p className="meta">{t("emailsAlways")}</p>
      {conferences.map((k) => (
        <ConferenceChoices key={k.conference.slug} initial={k} />
      ))}
    </section>
  );
}

/** One of the two questions with three answers: each one, one summary a day, or none. */
function HowOften({
  legend,
  hint,
  name,
  value,
  onChange,
}: {
  legend: string;
  /** What the question is about, where its legend does not say it all. */
  hint?: string;
  name: string;
  value: NoticeFrequency;
  onChange: (value: NoticeFrequency) => void;
}) {
  const { t } = useT();
  return (
    <fieldset>
      <legend>{legend}</legend>
      {hint && (
        <p className="meta" id={`${name}-hint`}>
          {hint}
        </p>
      )}
      {NOTICE_FREQUENCIES.map((often) => (
        <label key={often} className="choice">
          <input
            type="radio"
            name={name}
            value={often}
            checked={value === often}
            aria-describedby={hint ? `${name}-hint` : undefined}
            onChange={() => onChange(often)}
          />
          <span>{t(OFTEN[often])}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** One conference's choices, saved together: the page says so, and the line takes focus. */
function ConferenceChoices({ initial }: { initial: EmailChoices }) {
  const { lang, t } = useT();
  const { slug, title, defaultLanguage } = initial.conference;
  // (A part that is not this person's is not shown, and nothing of it is sent.)
  const unchosen = DEFAULT_NOTIFICATION_CHOICES;
  const [assignments, setAssignments] = useState(
    initial.reviewer?.assignments ?? unchosen.assignments,
  );
  const [reminder, setReminder] = useState(initial.reviewer?.reminder ?? unchosen.reminder);
  const [notices, setNotices] = useState(initial.chair?.notices ?? unchosen.chairNotices);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const days = initial.reviewer?.reminderDays ?? 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    // One request at a time: a second tap while one is on its way does nothing.
    if (inFlight.current) return;
    inFlight.current = true;
    const res = await api<EmailChoices>(`/api/me/notifications/${slug}`, {
      method: "PUT",
      // Only what is this person's to choose there.
      body: {
        ...(initial.reviewer ? { assignments, reminder } : {}),
        ...(initial.chair ? { chairNotices: notices } : {}),
      },
    });
    inFlight.current = false;
    setMessage(
      res.ok
        ? t("emailsSaved", { conference: localize(title, lang, defaultLanguage) })
        : t("emailsSaveFailed"),
    );
    statusRef.current?.focus();
  }

  const changed =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setMessage("");
      set(value);
    };

  return (
    <form className="stack wide" onSubmit={save} noValidate>
      <h3>
        <Localized text={title} fallback={defaultLanguage} />
      </h3>
      {initial.reviewer && (
        <>
          <HowOften
            legend={t("emailsAssigned")}
            name={`assigned-${slug}`}
            value={assignments}
            onChange={changed(setAssignments)}
          />
          <label className="choice boxed">
            <input
              type="checkbox"
              checked={reminder}
              onChange={(e) => changed(setReminder)(e.target.checked)}
            />
            <span>{days === 1 ? t("emailsRemindOne") : t("emailsRemind", { days })}</span>
          </label>
        </>
      )}
      {initial.chair && (
        <HowOften
          legend={t("emailsChair")}
          hint={t("emailsChairHint")}
          name={`notices-${slug}`}
          value={notices}
          onChange={changed(setNotices)}
        />
      )}
      <p className="actions">
        <button
          type="submit"
          aria-label={t("emailsSaveFor", { conference: localize(title, lang, defaultLanguage) })}
        >
          {t("emailsSave")}
        </button>
      </p>
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {message}
      </p>
    </form>
  );
}
