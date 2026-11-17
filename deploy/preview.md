# Publish the design preview to jtm.io

Use GitHub Actions to keep the deployment key in GitHub. This does not require editing Codex environment secrets or giving the VM SSH access.

The **Deploy design preview** workflow publishes preview-file changes on `main` automatically. It can also be started manually. It uploads the HTML, shared conference stylesheet, bilingual copy, scripts, self-hosted fonts, contour artwork, licenses and structure sketches from `docs/design/visitor-preview`. It does not rebuild the app, restart services, modify conference settings, or read the server's application secrets.

## Configure GitHub

In [AMSUCF/ELOchair → Settings → Secrets and variables → Actions](https://github.com/AMSUCF/ELOchair/settings/secrets/actions), add these **repository secrets**:

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | A dedicated deployment private key, usable by the runner without a passphrase |
| `DEPLOY_KNOWN_HOSTS` | The verified SSH `known_hosts` entry for jtm.io; for a nonstandard port, use its `[jtm.io]:port` entry |
| `PREVIEW_BASIC_AUTH` | Optional. If `PREVIEW_URL` is behind HTTP Basic Auth, set this to `user:password` so the job's own verification request can still authenticate. Omit it if the preview path has no Basic Auth. |

Under the **Variables** tab, add:

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | `jtm.io` |
| `DEPLOY_USER` | The server account allowed to write the preview directory |
| `DEPLOY_PATH` | The absolute preview directory, ending in `/elochair-design-preview` |
| `PREVIEW_URL` | The public HTTPS URL that serves that directory, with a trailing slash |
| `DEPLOY_PORT` | Optional SSH port; defaults to `22` |

For example, if the existing web server serves `/var/www/jtm.io` at `https://jtm.io/`, a possible destination is `/var/www/jtm.io/elochair-design-preview` with URL `https://jtm.io/elochair-design-preview/`. **Confirm the real document root before using these example values.** A subdomain of jtm.io is also supported for the public URL.

Install the matching public key in the deployment user's `~/.ssh/authorized_keys` on the server. The account must be able to create or write the dedicated preview directory, and the existing web server must be able to read it. The upload uses SSH and SCP/SFTP; no server-side Node installation or app restart is needed. Use an existing trusted host-key entry or verify the fingerprint through the server console before saving `DEPLOY_KNOWN_HOSTS`.

Keep the existing SMTP, database and app secrets on the server. Do not put the private key in an issue, chat message, workflow YAML or committed file.

## Deploy

1. Open the repository's **Actions** tab.
2. Select **Deploy design preview** and choose **Run workflow**.
3. Choose a branch containing the preview and workflow, then run it.
4. Open the link in the successful job's summary.

The job checks the configuration, verifies the SSH host key, uploads the static preview and checks that every public file matches the uploaded file, including the CSS, scripts, fonts and artwork. It removes the temporary key when the script exits. No remote files are deleted. Later preview changes on `main` publish automatically; use the manual run to retry a deployment.

Automatic runs are limited to changes under `docs/design/visitor-preview/`, its upload script, and this preview workflow on `main`. Pull requests do not deploy. The manual workflow must be present on the repository's default branch to appear in the Actions tab.
