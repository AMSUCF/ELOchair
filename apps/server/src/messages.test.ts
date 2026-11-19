import {
  ConferenceConfig,
  type ContributionRole,
  type MailMessageKey,
  MESSAGES,
} from "@elochair/schema";
import { MESSAGES_BEFORE, type MessageBefore } from "@elochair/schema/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, outbox } from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import type { MailMessage, MemoryTransport } from "./mail";
import { RateLimiter } from "./ratelimit";
import { grantRole } from "./repo";
import {
  type Answer,
  answeredMessage,
  draftDeletedMessage,
  invitationMessage,
  invitationWithdrawnMessage,
  receivedMessage,
  type Wording,
  withdrawnMessage,
} from "./templates";
import { call, makeTestApp, ORIGIN, personId, signIn, type TestApp } from "./testkit";

/*
 * The wording of the emails the app sends (spec 02, §1.9): a conference that changes nothing
 * sends what was always sent; one that writes its own text has it sent to readers of that
 * language and no other; what an owner wrote is cleaned inside either; and a chair's change is
 * reviewed, refused when a text cannot work, audited by path and undone by taking it away.
 */

const TO = "reader@example.org";

/** One of the six functions, called with a captured case's input. */
function send(wording: Wording, c: MessageBefore): MailMessage {
  const v = (name: string) => c.input[name] ?? "";
  const calls: Record<MailMessageKey, () => MailMessage> = {
    invitation: () =>
      invitationMessage(wording, c.lang, TO, {
        ownerName: c.input.ownerName ?? null,
        conference: v("conference"),
        format: v("format"),
        role: v("role") as ContributionRole,
        link: v("link"),
      }),
    submission_received: () =>
      receivedMessage(wording, c.lang, TO, {
        conference: v("conference"),
        format: v("format"),
        title: v("title"),
        link: v("link"),
        deadline: v("deadline"),
      }),
    submission_withdrawn: () =>
      withdrawnMessage(wording, c.lang, TO, {
        conference: v("conference"),
        format: v("format"),
        title: v("title"),
        link: v("link"),
      }),
    invitation_withdrawn: () =>
      invitationWithdrawnMessage(wording, c.lang, TO, { conference: v("conference") }),
    invitation_answered: () =>
      answeredMessage(wording, c.lang, TO, {
        conference: v("conference"),
        who: v("who"),
        answer: v("answer") as Answer,
        link: v("link"),
      }),
    draft_deleted: () => draftDeletedMessage(wording, c.lang, TO, { conference: v("conference") }),
  };
  return calls[c.key]();
}

describe("a conference that customizes nothing", () => {
  it("sends every email exactly as before chairs could change them, byte for byte", () => {
    // The whole of a configuration without `messages`, and the least that says so.
    const untouched = ConferenceConfig.parse(fixtureCall);
    expect(untouched).not.toHaveProperty("messages");
    expect(MESSAGES_BEFORE.length).toBeGreaterThan(50);
    for (const c of MESSAGES_BEFORE) {
      for (const wording of [{}, untouched]) {
        expect(send(wording, c), `${c.key} ${c.lang} ${JSON.stringify(c.input)}`).toEqual({
          to: TO,
          subject: c.subject,
          text: c.text,
        });
      }
    }
  });

  it("sends them the same when the conference has only reworded other emails or languages", () => {
    const elsewhere: Wording = {
      messages: {
        invitation: { subject: { pt: "Convite para {conference}" } },
        draft_deleted: { body: { es: "Olvídalo." } },
      },
    };
    for (const c of MESSAGES_BEFORE) {
      const reworded =
        (c.key === "invitation" && c.lang === "pt") ||
        (c.key === "draft_deleted" && c.lang === "es");
      if (reworded) continue;
      expect(send(elsewhere, c)).toEqual({ to: TO, subject: c.subject, text: c.text });
    }
  });
});

describe("a conference's own text", () => {
  const link = "https://chair.example.org/es/invitation#token=inv_made_up";
  const invitation = (wording: Wording, lang: "en" | "es" | "pt", ownerName: string | null) =>
    invitationMessage(wording, lang, TO, {
      ownerName,
      conference: "Encuentro Inventado",
      format: "Charla breve",
      role: "coauthor",
      link,
    });
  const own: Wording = {
    messages: {
      invitation: {
        subject: { es: "Te invitan a {conference} ({format})" },
        body: { es: "Hola. {owner} te propone el rol de {role} ({format}).\n\n{link}\n\nGracias." },
      },
    },
  };

  it("is sent to a reader in its language, subject and body", () => {
    expect(invitation(own, "es", "Ana Pérez")).toEqual({
      to: TO,
      subject: "Te invitan a Encuentro Inventado (Charla breve)",
      text: `Hola. Ana Pérez te propone el rol de coautoría (Charla breve).\n\n${link}\n\nGracias.`,
    });
  });

  it("is never sent to a reader in another language: they get the standard text in theirs", () => {
    for (const lang of ["en", "pt"] as const) {
      expect(invitation(own, lang, "Ana Pérez")).toEqual(invitation({}, lang, "Ana Pérez"));
    }
    expect(invitation(own, "pt", "Ana Pérez").subject).toBe(
      "Encuentro Inventado: confirme a sua participação",
    );
  });

  it("is used for the subject or the body alone, where only one is written", () => {
    const subjectOnly: Wording = {
      messages: { invitation: { subject: { es: "Una invitación" } } },
    };
    const sent = invitation(subjectOnly, "es", "Ana Pérez");
    expect(sent.subject).toBe("Una invitación");
    expect(sent.text).toBe(invitation({}, "es", "Ana Pérez").text);
  });

  it("still gets an owner's name without its links, and a title on one line", () => {
    // A name that is someone's link, with a hidden character, goes into the conference's text
    // exactly as it goes into the standard one.
    const phish = "Ana evil-phish.com Pérez\u202E see https://evil.example/x or a@evil.example";
    const sent = invitation(own, "es", phish);
    expect(sent.text).toMatch(/^Hola\. Ana Pérez see or te propone el rol de coautoría/);
    expect(`${sent.subject}\n${sent.text}`).not.toMatch(/evil|\u202E|@/);
    expect(invitation(own, "es", null).text).toMatch(/^Hola\. Alguien te propone el rol/);

    const receipt: Wording = {
      messages: {
        submission_received: {
          subject: { en: "Received: {title}" },
          body: { en: "We have “{title}”.\n{link}" },
        },
        invitation_answered: { subject: { en: "{person} {answer}" } },
      },
    };
    const received = receivedMessage(receipt, "en", TO, {
      conference: "Made-up Meeting",
      format: "Short talk",
      title: "A title\nBcc: someone@example.org\u200B\twith a tab",
      link: "https://chair.example.org/en/s/made-up",
      deadline: "tomorrow",
    });
    expect(received.subject).toBe("Received: A title Bcc: someone@example.org with a tab");
    expect(received.text).toBe(
      "We have “A title Bcc: someone@example.org with a tab”.\nhttps://chair.example.org/en/s/made-up",
    );
    // An empty title is still the dash, and a typed name is still one line.
    expect(
      receivedMessage(receipt, "en", TO, {
        conference: "M",
        format: "F",
        title: " \n ",
        link: "L",
        deadline: "D",
      }).subject,
    ).toBe("Received: —");
    expect(
      answeredMessage(receipt, "en", TO, {
        conference: "M",
        who: "Nina\nNuñez",
        answer: "left",
        link: "L",
      }).subject,
    ).toBe("Nina Nuñez left");
  });

  it("does not fill a placeholder that an owner wrote into a name or a title", () => {
    const sent = invitation(own, "es", "{link} {conference} {title}");
    expect(sent.text).toMatch(/^Hola\. \{link\} \{conference\} \{title\} te propone el rol/);
    // The link is in the text once: where the conference put it.
    expect(sent.text.split(link)).toHaveLength(2);
    const received = receivedMessage({}, "en", TO, {
      conference: "Made-up Meeting",
      format: "Short talk",
      title: "{link} {deadline} {owner}",
      link: "https://chair.example.org/en/s/made-up",
      deadline: "tomorrow",
    });
    expect(received.text).toContain('Your proposal "{link} {deadline} {owner}" (Short talk)');
  });

  it("is given only its own message's values, and no link or owner's name in a subject", () => {
    // Such texts are refused by the schema (messages.test.ts). Were one stored all the same,
    // an invitation still has no title to give; its link stays out of the subject, where the
    // stored copy of the mail would keep it; and so does the name its owner chose.
    const stored: Wording = {
      messages: {
        invitation: {
          subject: { es: "{owner}: abre {link} ({title})" },
          body: { es: "{title} / {person} / {deadline} / {link}" },
        },
        draft_deleted: { body: { es: "{owner} borró «{title}»: {link}" } },
      },
    };
    const sent = invitation(stored, "es", "Ana Pérez");
    expect(sent.subject).toBe("{owner}: abre {link} ({title})");
    expect(sent.text).toBe(`{title} / {person} / {deadline} / ${link}`);
    expect(draftDeletedMessage(stored, "es", TO, { conference: "Encuentro Inventado" }).text).toBe(
      "{owner} borró «{title}»: {link}",
    );
  });
});

describe("chairs change the wording, and people are sent it", () => {
  let t: TestApp;
  let conferenceId: string;
  const SLUG = "wording-call";
  const NOW = new Date("2027-02-01T12:00:00Z");
  const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
  const words = (n: number) => Array.from({ length: n }, () => "verse").join(" ");
  const cookies: Record<string, string> = {};
  type Config = ConferenceConfig;
  type Sub = { id: string; version: number };
  /** The call as it was seeded, and the token that names it: nobody has changed any wording. */
  let untouched: { config: Config; token: string };

  const at = (rest: string) => `/api/conferences/${SLUG}/${rest}`;
  const settings = async () => {
    const got = await call(t.public, "GET", at("settings"), { cookie: cookies.chair });
    expect(got.status).toBe(200);
    return got.json as { config: Config; token: string };
  };
  /** The stored configuration with `change` applied, sent by the chair to `rest`. */
  async function chair(method: "POST" | "PUT", rest: string, change: (config: Config) => void) {
    const { config, token } = await settings();
    const next = structuredClone(config);
    change(next);
    return call(t.public, method, at(rest), { cookie: cookies.chair, ifMatch: token, body: next });
  }
  const save = (change: (config: Config) => void) => chair("PUT", "config", change);
  /** Changes to make to a configuration: its host, or the whole of its own wording. */
  const hosted = (host: string) => (c: Config) => {
    c.host = host;
  };
  const worded = (messages: Config["messages"]) => (c: Config) => {
    if (messages) c.messages = messages;
    else delete c.messages;
  };
  const preview = (change: (config: Config) => void) => chair("POST", "config/preview", change);
  const audited = async () =>
    (
      await t.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.conferenceId, conferenceId),
            eq(auditLog.action, "conference.config_updated"),
          ),
        )
        .orderBy(auditLog.id)
    ).map((row) => (row.details as { changes: { path: string }[] }).changes);

  async function person(who: string, name: string, languages: string[]) {
    const email = `wording-${who}@example.org`;
    const cookie = await signIn(t, email);
    const res = await call(t.public, "PUT", "/api/me/profile", {
      cookie,
      body: {
        displayName: name,
        affiliation: null,
        country: null,
        languages,
        pronouns: null,
        orcid: null,
        bios: {},
      },
    });
    expect(res.status).toBe(200);
    cookies[who] = cookie;
    return email;
  }
  async function draft(who: string, title: string): Promise<Sub> {
    const created = await call(t.public, "POST", at("submissions"), {
      cookie: cookies[who],
      body: { typeKey: "talk", language: "en", participationMode: "in_person" },
    });
    expect(created.status).toBe(201);
    const filled = await call(t.public, "PATCH", `/api/submissions/${created.json.id}`, {
      cookie: cookies[who],
      body: { version: created.json.version, title, abstract: words(260) },
    });
    expect(filled.status).toBe(200);
    return filled.json;
  }
  async function invite(who: string, s: Sub, email: string, lang: "en" | "es" | "pt") {
    const res = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: cookies[who],
      body: { version: s.version, email, role: "coauthor", lang, name: "Typed Name" },
    });
    expect(res.status).toBe(201);
    return res.json as Sub;
  }
  /** An owner's action on a proposal; answers with the proposal's new version. */
  async function act(who: string, s: Sub, action: string, body: Record<string, unknown> = {}) {
    const res = await call(t.public, "POST", `/api/submissions/${s.id}/${action}`, {
      cookie: cookies[who],
      body: { version: s.version, ...body },
    });
    expect(res.status, action).toBeLessThan(300);
    const now = await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: cookies[who] });
    return now.json as Sub;
  }
  /** Every message delivered to an address so far, oldest first. */
  async function mailTo(email: string) {
    await call(t.public, "GET", `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
    return (t.deps.mail as MemoryTransport).sent.filter((m) => m.to === email);
  }
  const latest = async (email: string) => {
    const mail = (await mailTo(email)).at(-1);
    if (!mail) throw new Error(`no mail to ${email}`);
    return mail;
  };
  const tokenIn = (mail: MailMessage) => /#token=(inv_[A-Za-z0-9_-]+)/.exec(mail.text)?.[1];

  beforeAll(async () => {
    t = await makeTestApp();
    ({ conferenceId } = await seedTestCall(t.db, { slug: SLUG, now: NOW }));
    t.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
    await person("chair", "Zed Wordingchair", ["en"]);
    await grantRole(t.db, {
      conferenceId,
      personId: await personId(t, "wording-chair@example.org"),
      role: "chair",
    });
    // The owner's name is someone's link: what mail must never carry to an invitee.
    await person("owner", "Ana evil-phish.com Pérez", ["es"]);
    await person("english", "Edna English", ["en"]);
    untouched = await settings();
  }, 120_000);
  afterAll(() => t.close());

  const OWN = {
    invitation: {
      subject: { es: "Te invitan a {conference} ({format})" },
      body: { es: "Hola. {owner} te propone el rol de {role} ({format}).\n\n{link}\n\nGracias." },
    },
    submission_received: {
      // A subject in one language and a body in another: each is looked up on its own.
      subject: { en: "We have your proposal: {title}" },
      body: { es: "Hemos recibido «{title}».\n\n{link}" },
    },
  };

  it("starts from a configuration that holds no messages", () => {
    expect(untouched.config).not.toHaveProperty("messages");
  });

  it("reviews a chair's texts, saves them, and audits each by its path", async () => {
    const paths = [
      "messages.invitation.subject.es",
      "messages.invitation.body.es",
      "messages.submission_received.subject.en",
      "messages.submission_received.body.es",
    ];
    const reviewed = await preview(worded(OWN));
    expect(reviewed.json).toMatchObject({ canSave: true, issues: [], blocked: null });
    expect(reviewed.json.changes).toEqual([
      { path: paths[0], after: OWN.invitation.subject.es },
      { path: paths[1], after: OWN.invitation.body.es },
      { path: paths[2], after: OWN.submission_received.subject.en },
      { path: paths[3], after: OWN.submission_received.body.es },
    ]);
    // A review saves nothing.
    expect((await settings()).token).toBe(untouched.token);

    const before = (await audited()).length;
    const saved = await save(worded(OWN));
    expect(saved.status).toBe(200);
    expect(saved.json.config.messages).toEqual(OWN);
    expect((await settings()).config.messages).toEqual(OWN);
    const rows = await audited();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toEqual(reviewed.json.changes);
    // Anyone who can see the conference reads its configuration, the wording included.
    const open = await call(t.public, "GET", `/api/conferences/${SLUG}`);
    expect(open.json.config.messages).toEqual(OWN);
  });

  it("sends the conference's text to a reader in its language and the standard text to another", async () => {
    let s = await draft("owner", "Línea uno\nlínea dos");
    s = await invite("owner", s, "wording-es@example.org", "es");
    s = await invite("owner", s, "wording-en@example.org", "en");

    // In Spanish: the conference's subject and body, with the owner's name cleaned inside the
    // body (a subject is not given it).
    const es = await latest("wording-es@example.org");
    expect(es.subject).toBe("Te invitan a Convocatoria de prueba (Ponencia individual)");
    const link = `${ORIGIN}/es/invitation#token=${tokenIn(es)}`;
    expect(es.text).toBe(
      `Hola. Ana Pérez te propone el rol de coautoría (Ponencia individual).\n\n${link}\n\nGracias.`,
    );
    expect(`${es.subject}\n${es.text}`).not.toMatch(/evil|phish/);
    // The stored copy of a reworded invitation loses its link's token like any other, wherever
    // the conference's text puts the link, and its subject never had it.
    const [kept] = await t.db
      .select()
      .from(outbox)
      .where(eq(outbox.toEmail, "wording-es@example.org"));
    expect(kept?.sentAt).not.toBeNull();
    expect(kept?.bodyText).toBe(
      `Hola. Ana Pérez te propone el rol de coautoría (Ponencia individual).\n\n${ORIGIN}/es/invitation#token=[redacted]\n\nGracias.`,
    );
    expect(`${kept?.subject}\n${kept?.bodyText}`).not.toContain(tokenIn(es));

    // In English nothing was written: the standard text, never the Spanish one.
    const en = await latest("wording-en@example.org");
    expect(en.subject).toBe("Test call: please confirm your participation");
    expect(en.text).toMatch(
      /^Ana Pérez has listed you as co-author on a proposal \(Individual talk\) for Test call\.\n\nOpen this link/,
    );
    expect(en.text).not.toMatch(/Hola|Gracias|evil|phish/);

    // The receipt in Spanish: the standard subject (none was written) with the conference's
    // body, and the title on one line inside it.
    s = await act("owner", s, "submit", { acceptedAgreements: AGREEMENTS });
    const receipt = await latest("wording-owner@example.org");
    expect(receipt.subject).toBe("Convocatoria de prueba: propuesta recibida");
    expect(receipt.text).toBe(`Hemos recibido «Línea uno línea dos».\n\n${ORIGIN}/es/s/${s.id}`);

    // In English it is the other way round: the conference's subject, the standard body.
    let other = await draft("english", "Poems with p5.js");
    other = await act("english", other, "submit", { acceptedAgreements: AGREEMENTS });
    const english = await latest("wording-english@example.org");
    expect(english.subject).toBe("We have your proposal: Poems with p5.js");
    expect(english.text).toMatch(
      /^Your proposal "Poems with p5\.js" \(Individual talk\) for Test call has been submitted\./,
    );
    expect(english.text.endsWith(`${ORIGIN}/en/s/${other.id}`)).toBe(true);
  });

  it("refuses a text with an unknown or a missing placeholder, and stores nothing", async () => {
    const stored = await settings();
    const rows = (await audited()).length;
    const cases: [string, (c: Config) => void, object][] = [
      [
        "an unknown placeholder",
        (c) => {
          c.messages = { ...OWN, draft_deleted: { body: { es: "Se borró «{titulo}»." } } };
        },
        {
          path: "messages.draft_deleted.body.es",
          code: "message_unknown_placeholder",
          params: { names: "{titulo}" },
        },
      ],
      [
        "another message's placeholder",
        (c) => {
          c.messages = { ...OWN, draft_deleted: { body: { es: "Se borró «{title}»." } } };
        },
        {
          path: "messages.draft_deleted.body.es",
          code: "message_unknown_placeholder",
          params: { names: "{title}" },
        },
      ],
      [
        "a required placeholder left out",
        (c) => {
          c.messages = { ...OWN, invitation: { body: { es: "{owner} te ha invitado." } } };
        },
        {
          path: "messages.invitation.body.es",
          code: "message_missing_placeholder",
          params: { names: "{link}" },
        },
      ],
      [
        "the link in a subject",
        (c) => {
          c.messages = { ...OWN, invitation: { subject: { es: "Abre {link}" } } };
        },
        {
          path: "messages.invitation.subject.es",
          code: "message_not_in_subject",
          params: { names: "{link}" },
        },
      ],
      [
        "the owner's name in the subject of an invitation",
        (c) => {
          c.messages = { ...OWN, invitation: { subject: { es: "{owner} te invita" } } };
        },
        {
          path: "messages.invitation.subject.es",
          code: "message_not_in_subject",
          params: { names: "{owner}" },
        },
      ],
      [
        "something touching the link",
        (c) => {
          c.messages = { ...OWN, invitation: { body: { es: "Responde aquí: {link}." } } };
        },
        {
          path: "messages.invitation.body.es",
          code: "message_link_touched",
          params: { names: "{link}" },
        },
      ],
      [
        "a subject on two lines",
        (c) => {
          c.messages = { ...OWN, draft_deleted: { subject: { en: "Never\nmind" } } };
        },
        { path: "messages.draft_deleted.subject.en", code: "message_not_one_line" },
      ],
      [
        "a text that is too long",
        (c) => {
          c.messages = { ...OWN, draft_deleted: { subject: { en: "x".repeat(201) } } };
        },
        {
          path: "messages.draft_deleted.subject.en",
          code: "message_too_long",
          params: { max: 200 },
        },
      ],
      [
        "an emptied text",
        (c) => {
          c.messages = { ...OWN, draft_deleted: { body: { en: " " } } };
        },
        { path: "messages.draft_deleted.body.en", code: "message_empty" },
      ],
    ];
    for (const [what, change, issue] of cases) {
      // The review names the text and why, and offers no save.
      const reviewed = await preview(change);
      expect(reviewed.status, what).toBe(200);
      expect(reviewed.json.canSave, what).toBe(false);
      expect(reviewed.json.issues, what).toHaveLength(1);
      expect(reviewed.json.issues[0], what).toMatchObject(issue);
      // Saved without a review, it is refused all the same.
      const refused = await save(change);
      expect(refused.status, what).toBe(400);
      expect(refused.json.error, what).toBe("invalid");
    }
    // A message the app does not send, and a language the app does not write mail in.
    for (const change of [
      (c: Config) => {
        (c.messages as Record<string, unknown>).reminder = { body: { en: "Remember." } };
      },
      (c: Config) => {
        (c as { messages: unknown }).messages = { draft_deleted: { body: { fr: "Oubliez." } } };
      },
    ]) {
      expect((await preview(change)).json.canSave).toBe(false);
      expect((await save(change)).status).toBe(400);
    }
    const after = await settings();
    expect(after.token).toBe(stored.token);
    expect(after.config).toEqual(stored.config);
    expect(await audited()).toHaveLength(rows);
  });

  it("goes back to the standard text when a chair takes a text away", async () => {
    const removed = await save((c) => {
      c.messages = { submission_received: OWN.submission_received };
    });
    expect(removed.status).toBe(200);
    expect((await audited()).at(-1)).toEqual([
      { path: "messages.invitation.subject.es", before: OWN.invitation.subject.es },
      { path: "messages.invitation.body.es", before: OWN.invitation.body.es },
    ]);
    const s = await draft("owner", "Otra propuesta");
    await invite("owner", s, "wording-es-2@example.org", "es");
    const es = await latest("wording-es-2@example.org");
    expect(es.subject).toBe("Convocatoria de prueba: confirma tu participación");
    expect(es.text).toMatch(/^Ana Pérez te ha incluido con el rol de coautoría en una propuesta/);
  });

  it("is the configuration it was once a save holds no text of its own any more", async () => {
    // Something else is changed while the wording is there, and put back.
    const host = untouched.config.host;
    expect((await save(hosted("Another host"))).status).toBe(200);
    expect((await save(hosted(host))).status).toBe(200);
    const gone = await save(worded(undefined));
    expect(gone.status).toBe(200);
    expect(gone.json.config).not.toHaveProperty("messages");
    const after = await settings();
    expect(after.config).toEqual(untouched.config);
    expect(JSON.stringify(after.config)).not.toContain('"messages"');
    expect(after.token).toBe(untouched.token);
  });

  it("saves other values of a conference without messages and leaves it without", async () => {
    const changed = await save(hosted("A third host"));
    expect(changed.status).toBe(200);
    expect(changed.json.config).not.toHaveProperty("messages");
    expect((await audited()).at(-1)).toEqual([
      { path: "host", before: untouched.config.host, after: "A third host" },
    ]);
    expect((await save(hosted(untouched.config.host))).status).toBe(200);
    expect((await settings()).token).toBe(untouched.token);
  });

  it("writes every email the app sends in the conference's words, whichever route sends it", async () => {
    // One marked body per message, in English, each with all of its placeholders.
    const marked = Object.fromEntries(
      (Object.keys(MESSAGES) as MailMessageKey[]).map((key) => [
        key,
        {
          body: {
            en: `[${key}] ${MESSAGES[key].placeholders.map((name) => `${name}: {${name}}`).join(" | ")}`,
          },
        },
      ]),
    );
    expect((await save(worded(marked))).status).toBe(200);
    // The sign-in email is not one of them: it is the same for every conference.
    const kinds = async (email: string) =>
      (await mailTo(email))
        .filter((m) => m.subject !== "Your ELOchair sign-in link")
        .map((m) => /^\[([a-z_]+)\]/.exec(m.text)?.[1] ?? "standard");

    await person("writer", "Wren Writer", ["en"]);
    const writer = "wording-writer@example.org";
    let s = await draft("writer", "Marked proposal");
    s = await invite("writer", s, "wording-pending@example.org", "en");
    s = await invite("writer", s, "wording-declines@example.org", "en");
    s = await invite("writer", s, "wording-joins@example.org", "en");
    const invitation = await latest("wording-pending@example.org");
    expect(invitation.text).toBe(
      `[invitation] owner: Wren Writer | role: co-author | format: Individual talk | conference: Test call | link: ${ORIGIN}/en/invitation#token=${tokenIn(invitation)}`,
    );

    // Sent again an hour later: the same message, by another route.
    const pending = await personId(t, "wording-pending@example.org");
    try {
      t.setNow(new Date(NOW.getTime() + 61 * 60 * 1000));
      await act("writer", s, `contributors/${pending}/resend`);
    } finally {
      t.setNow(NOW);
    }
    expect(await kinds("wording-pending@example.org")).toEqual(["invitation", "invitation"]);

    // Answers reach the owner: a decline by the emailed link, a confirmation in the app.
    const declined = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token: tokenIn(await latest("wording-declines@example.org")), answer: "decline" },
    });
    expect(declined.json).toEqual({ answer: "declined" });
    await person("joins", "Jo Joins", ["en"]);
    const confirmed = await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
      cookie: cookies.joins,
      body: { answer: "confirm", acceptedAgreements: AGREEMENTS },
    });
    expect(confirmed.json).toEqual({ answer: "confirmed" });
    const proposal = `${ORIGIN}/en/s/${s.id}`;
    expect((await mailTo(writer)).slice(-2).map((m) => m.text)).toEqual([
      `[invitation_answered] person: Typed Name | answer: declined | conference: Test call | link: ${proposal}`,
      `[invitation_answered] person: Typed Name | answer: confirmed | conference: Test call | link: ${proposal}`,
    ]);
    // The subject was not reworded: it is the standard one.
    expect((await latest(writer)).subject).toBe("Test call: Typed Name confirmed your proposal");

    // Submitted: a receipt to the owner and to the co-author who confirmed.
    s = (await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: cookies.writer })).json;
    s = await act("writer", s, "submit", { acceptedAgreements: AGREEMENTS });
    for (const email of [writer, "wording-joins@example.org"]) {
      expect((await latest(email)).text, email).toMatch(
        /^\[submission_received\] title: Marked proposal \| format: Individual talk \| conference: Test call \| deadline: .+ \(America\/Bogota\) \| link: /,
      );
    }

    // The co-author leaves, and the owner withdraws: the people on the proposal and the
    // contact address get the notice with the title; the person still invited gets the other.
    const left = await call(t.public, "POST", `/api/submissions/${s.id}/leave`, {
      cookie: cookies.joins,
      body: {},
    });
    expect(left.status).toBe(204);
    expect((await latest(writer)).text).toBe(
      `[invitation_answered] person: Typed Name | answer: left | conference: Test call | link: ${proposal}`,
    );
    s = (await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: cookies.writer })).json;
    await act("writer", s, "withdraw");
    const notice = `[submission_withdrawn] title: Marked proposal | format: Individual talk | conference: Test call | link: ${proposal}`;
    expect((await latest(writer)).text).toBe(notice);
    expect((await latest(fixtureCall.contactEmail)).text).toBe(notice);
    expect((await latest("wording-pending@example.org")).text).toBe(
      "[invitation_withdrawn] conference: Test call",
    );

    // A draft deleted while someone is still invited to it.
    let doomed = await draft("writer", "A draft nobody will see");
    doomed = await invite("writer", doomed, "wording-dropped@example.org", "en");
    const deleted = await call(t.public, "DELETE", `/api/submissions/${doomed.id}`, {
      cookie: cookies.writer,
      body: { version: doomed.version },
    });
    expect(deleted.status).toBe(204);
    expect(await kinds("wording-dropped@example.org")).toEqual(["invitation", "draft_deleted"]);
    expect((await latest("wording-dropped@example.org")).text).toBe(
      "[draft_deleted] conference: Test call",
    );

    // Every message was sent at least once, and none of them in the standard words.
    const everyone = [
      writer,
      fixtureCall.contactEmail,
      "wording-pending@example.org",
      "wording-declines@example.org",
      "wording-joins@example.org",
      "wording-dropped@example.org",
    ];
    const sent = (await Promise.all(everyone.map(kinds))).flat();
    expect([...new Set(sent)].sort()).toEqual(Object.keys(MESSAGES).sort());

    // Back to a conference that has written nothing.
    expect((await save(worded(undefined))).status).toBe(200);
    expect((await settings()).token).toBe(untouched.token);
  });
});
