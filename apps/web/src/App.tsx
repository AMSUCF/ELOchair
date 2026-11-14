import { useEffect, useRef } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { ErrorBoundary } from "./ErrorBoundary";
import { detectLang, isLang, LANG_NAMES, LANGS, LangContext, translate, useT } from "./i18n";
import { ConferencePage } from "./pages/Conference";
import { HomePage } from "./pages/Home";
import { InvitationPage } from "./pages/Invitation";
import { ManagePage } from "./pages/Manage";
import { MePage } from "./pages/Me";
import { MyPage } from "./pages/My";
import { SignInPage } from "./pages/SignIn";
import { StartPage } from "./pages/Start";
import { SubmissionPage } from "./pages/Submission";
import { VerifyPage } from "./pages/Verify";
import { FocusPending, PageHeading } from "./ui";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${detectLang()}/`} replace />} />
      <Route path="/:lang" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="c/:slug" element={<ConferencePage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="auth/verify" element={<VerifyPage />} />
        <Route path="me" element={<MePage />} />
        <Route path="my" element={<MyPage />} />
        <Route path="c/:slug/submit" element={<StartPage />} />
        <Route path="c/:slug/manage" element={<ManagePage />} />
        <Route path="s/:id" element={<SubmissionPage />} />
        <Route path="invitation" element={<InvitationPage />} />
      </Route>
      <Route path="*" element={<Navigate to={`/${detectLang()}/`} replace />} />
    </Routes>
  );
}

function Layout() {
  const { lang } = useParams();
  if (!isLang(lang)) return <Navigate to={`/${detectLang()}/`} replace />;
  return (
    <LangContext.Provider value={lang}>
      <Shell />
    </LangContext.Provider>
  );
}

const withoutLang = (pathname: string) => pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");

/** The same page in another language: swap the leading /xx segment, keep the rest. */
function pathIn(lang: string, pathname: string, search: string): string {
  return `/${lang}${withoutLang(pathname) || "/"}${search}`;
}

/** Pages that open with a hero on the band and render their own sheet: home and a conference. */
const hasHero = (pathname: string) => /^\/(?:c\/[^/]+\/?)?$/.test(withoutLang(pathname) || "/");

/** Slow glow fields and contour lines behind the header and hero. Decoration only. */
function BandArt() {
  return (
    <div className="band-art" aria-hidden="true">
      <span className="glow glow-green" />
      <span className="glow glow-teal" />
      <span className="glow glow-amber" />
      <span className="contours" />
    </div>
  );
}

/**
 * The wordmark: "ELO" plus "chair" in the accent colour, after the conference's ELO27 mark. One
 * inline element, so that it is read as the single word "ELOchair" (as flex items, the two
 * parts would be announced as two words).
 */
function Wordmark() {
  return (
    <span>
      ELO<span className="brand-tail">chair</span>
    </span>
  );
}

/**
 * In place of a page that failed to render: say so, in the interface language. Its heading takes
 * focus, since whatever had focus (often the failed page's heading) is gone.
 */
function Crashed() {
  const { lang, t } = useT();
  return (
    <>
      <PageHeading focusOnMount>{t("crashTitle")}</PageHeading>
      <p role="alert">{t("crashBody")}</p>
      <p className="actions">
        <button type="button" onClick={() => window.location.reload()}>
          {t("crashReload")}
        </button>
        <a className="button secondary" href={`/${lang}/`}>
          {t("navConferences")}
        </a>
      </p>
    </>
  );
}

/** The router's last resort, for a failure outside any page (the shell itself). */
export function RootError() {
  const first = window.location.pathname.split("/")[1];
  const lang = isLang(first) ? first : detectLang();
  return (
    <main id="main" lang={lang} className="sheet">
      <h1>{translate(lang, "crashTitle")}</h1>
      <p role="alert">{translate(lang, "crashBody")}</p>
      <p>
        <a className="button" href={`/${lang}/`}>
          {translate(lang, "navConferences")}
        </a>
      </p>
    </main>
  );
}

function Shell() {
  const { lang, t } = useT();
  const location = useLocation();
  const focusPending = useRef(false);
  const lastKey = useRef(location.key);

  // A route change (not the first load) asks the next page heading to take focus, so screen
  // reader and keyboard users land on the new content. Set during render, before child effects.
  if (lastKey.current !== location.key) {
    lastKey.current = location.key;
    focusPending.current = true;
  }

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const hero = hasHero(location.pathname);
  const crashed = hero ? (
    <div className="sheet">
      <Crashed />
    </div>
  ) : (
    <Crashed />
  );

  return (
    <FocusPending.Provider value={focusPending}>
      <div className={hero ? "shell shell-hero" : "shell"}>
        <BandArt />
        <a className="skip-link" href="#main">
          {t("skipToContent")}
        </a>
        <header className="site-header">
          <div className="nav-pill">
            <Link to={`/${lang}/`} className="brand">
              <Wordmark />
            </Link>
            <nav aria-label={t("navMain")} className="site-nav">
              {/* NavLink marks the current page (aria-current="page"). */}
              <NavLink to={`/${lang}/my`}>{t("navMySubmissions")}</NavLink>
              <NavLink to={`/${lang}/me`}>{t("navAccount")}</NavLink>
            </nav>
            <nav aria-label={t("navLanguage")}>
              <ul className="lang-switch">
                {LANGS.map((l) => (
                  <li key={l}>
                    {/* The code is what shows; the name follows it for screen readers. */}
                    <Link
                      to={pathIn(l, location.pathname, location.search)}
                      lang={l}
                      hrefLang={l}
                      title={LANG_NAMES[l]}
                      aria-current={l === lang ? "true" : undefined}
                    >
                      {l.toUpperCase()}
                      <span className="visually-hidden"> {LANG_NAMES[l]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>
        {/* Hero pages render their hero and their own sheet; every other page is the sheet. */}
        <main id="main" className={hero ? undefined : "sheet"}>
          {/* A new page (not a language switch) gets a fresh boundary. */}
          <ErrorBoundary key={withoutLang(location.pathname)} fallback={crashed}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <footer className="site-footer">
          <span className="contours" aria-hidden="true" />
          <div className="footer-inner">
            <p className="brand">
              <Wordmark />
            </p>
            <p>{t("footer")}</p>
            <p className="footer-links">
              <a href="https://eliterature.org" rel="noreferrer">
                {t("footerOrg")}
              </a>
            </p>
          </div>
        </footer>
      </div>
    </FocusPending.Provider>
  );
}
