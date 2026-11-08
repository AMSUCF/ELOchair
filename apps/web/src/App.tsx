import { useEffect, useRef } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { detectLang, isLang, LANG_NAMES, LANGS, LangContext, useT } from "./i18n";
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
import { FocusPending } from "./ui";

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

/** The same page in another language: swap the leading /xx segment, keep the rest. */
function pathIn(lang: string, pathname: string, search: string): string {
  const rest = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");
  return `/${lang}${rest || "/"}${search}`;
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
          <Outlet />
        </main>
        <footer className="site-footer">
          <p>{t("footer")}</p>
        </footer>
      </div>
    </FocusPending.Provider>
  );
}
