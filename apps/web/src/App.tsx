import { useEffect, useRef } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { detectLang, isLang, LANG_NAMES, LANGS, LangContext, useT } from "./i18n";
import { ConferencePage } from "./pages/Conference";
import { HomePage } from "./pages/Home";
import { MePage } from "./pages/Me";
import { SignInPage } from "./pages/SignIn";
import { VerifyPage } from "./pages/Verify";

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

function Shell() {
  const { lang, t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // On navigation, move focus to the page content so screen readers announce the new page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on path change by design
  useEffect(() => {
    const heading = main.current?.querySelector("h1");
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  const switchTo = (next: string) => {
    const rest = location.pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");
    navigate(`/${next}${rest || "/"}${location.search}`);
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t("skipToContent")}
      </a>
      <header className="site-header">
        <Link to={`/${lang}/`} className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>{t("appName")}</span>
        </Link>
        <nav aria-label={t("navConferences")} className="site-nav">
          <Link to={`/${lang}/me`}>{t("navAccount")}</Link>
          <label className="lang-select">
            <span className="visually-hidden">{t("navLanguage")}</span>
            <select value={lang} onChange={(e) => switchTo(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
        </nav>
      </header>
      <main id="main" ref={main}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>{t("footer")}</p>
      </footer>
    </div>
  );
}
