import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { SignInForm } from "../signIn";
import { PageHeading } from "../ui";

/**
 * The sign-in page: the form on a page of its own, for someone who is going nowhere in
 * particular. Signed in, by the link or by the code, they are on "Your account". A page that
 * needs someone signed in has the same form on it, and brings them back to itself (signIn.tsx).
 */
export function SignInPage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  return (
    <>
      <PageHeading>{t("signInTitle")}</PageHeading>
      <SignInForm onSignedIn={() => navigate(`/${lang}/me`, { replace: true })} />
    </>
  );
}
