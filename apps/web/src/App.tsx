import { useEffect, useRef } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
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
    <main id="main" lang={lang}>
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

  return (
    <FocusPending.Provider value={focusPending}>
      <div className="shell">
        <a className="skip-link" href="#main">
          {t("skipToContent")}
        </a>
        <header className="site-header">
          <Link to={`/${lang}/`} className="brand">
            <img src="/icon.svg" alt="" width="28" height="28" />
            <span>{t("appName")}</span>
          </Link>
          <nav aria-label={t("navMain")} className="site-nav">
            <Link to={`/${lang}/my`}>{t("navMySubmissions")}</Link>
            <Link to={`/${lang}/me`}>{t("navAccount")}</Link>
            <ul className="lang-list">
              {LANGS.map((l) => (
                <li key={l}>
                  <Link
                    to={pathIn(l, location.pathname, location.search)}
                    lang={l}
                    hrefLang={l}
                    aria-current={l === lang ? "true" : undefined}
                  >
                    {LANG_NAMES[l]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main id="main">
          {/* A new page (not a language switch) gets a fresh boundary. */}
          <ErrorBoundary key={withoutLang(location.pathname)} fallback={<Crashed />}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <footer className="site-footer">
          <p>{t("footer")}</p>
        </footer>
      </div>
    </FocusPending.Provider>
  );
}
