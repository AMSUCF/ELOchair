# Running ELOchair on ELO's server

ELOchair runs as three containers: the app, Postgres 16, and Caddy, which obtains HTTPS certificates automatically. Everything in this runbook is done from a checkout of this repository on the server.

## What the server needs

- **Host:** Linux with Docker Engine and the Docker Compose plugin.
- **Memory:** 2 GB is enough for now. Allow 4 GB once the on-server model worker for reviewer matching arrives.
- **Domain:** a DNS name pointing at the server, for example `chair.eliterature.org`, with ports 80 and 443 open.
- **Mail:** an SMTP account allowed to send as the `MAIL_FROM` address. SPF and DKIM for `eliterature.org` must cover it, otherwise sign-in emails land in spam.
- **Backups:** somewhere off the server to copy them to.

## Install

```bash
git clone https://github.com/AMSUCF/ELOchair.git /srv/elochair
cd /srv/elochair
cp deploy/.env.example deploy/.env      # then edit: domain, database password, SMTP
docker compose -f deploy/docker-compose.yml up -d --build
```

Database migrations run automatically when the app starts. Check health with `curl https://chair.eliterature.org/healthz`.

If the server sits behind a TLS-intercepting proxy, which is common on university networks, `npm ci` inside the build fails with `SELF_SIGNED_CERT_IN_CHAIN`. Pass the proxy's CA certificate to the build:

```bash
docker build --secret id=extra_ca,src=/path/to/proxy-ca.crt -f deploy/Dockerfile -t elochair:latest .
docker compose -f deploy/docker-compose.yml up -d --no-build
```

## First-time setup

Run the command-line tool inside the app container:

```bash
alias elochair='docker compose -f deploy/docker-compose.yml exec -T app node apps/server/dist/cli.js'
elochair seed                                   # adds elo2026 (archived) and elo2027 (draft placeholder) if missing
elochair site-admin you@example.org             # a site administrator
elochair grant chair@example.org elo2027 chair  # roles: admin, chair, track_chair, reviewer
elochair grant tc@example.org elo2027 track_chair --scope track_key
# Files on the host are not visible inside the container, so pipe them in on standard input:
elochair import-config /dev/stdin --phase cfp_open < elo2027.json   # once the 2027 CFP is final
elochair export-config elo2027 > elo2027.json                       # and back out again
```

People sign in with a link sent to their email; there are no passwords.

## Agent tokens for chairs

Chairs can run the conference through agents. Every agent request is recorded in the audit log.

```bash
elochair create-token chair@example.org elo2027 --tier M --name "Claude Code on Ana's laptop"
elochair create-token chair@example.org elo2027 --tier C --name "Local model on the ELO server"
elochair list-tokens elo2027
elochair revoke-token <token-id>
```

- **Tier M (metadata)** works at `https://<domain>/api/…` with `Authorization: Bearer elo_m_…`. It returns IDs, statuses, counts and dates, but never names, titles, abstracts or reviews. It is safe to give to a cloud agent.
- **Tier C (content)** works only on the internal listener. That listener is bound to the server's loopback interface and never published to the internet. Reach it over SSH:

  ```bash
  ssh -L 8081:127.0.0.1:8081 you@server
  curl -H "Authorization: Bearer elo_c_…" http://localhost:8081/api/conferences/elo2027/submissions
  ```

  **Use tier C only with models running on your own machine or on ELO's server.** The server refuses tier C tokens on the public address, and it logs the attempt.

## Backups

Schedule `deploy/backup.sh` nightly. It writes a compressed `pg_dump` to `deploy/backups/` and keeps 30 days:

```cron
15 3 * * *  /srv/elochair/deploy/backup.sh >> /var/log/elochair-backup.log 2>&1
```

**Copy `deploy/backups/` off the server as well**, for example with rsync to another machine. To restore:

```bash
docker compose -f deploy/docker-compose.yml stop app
docker compose -f deploy/docker-compose.yml exec -T db pg_restore -U elochair -d elochair --clean --if-exists < deploy/backups/elochair-YYYYMMDDTHHMMSSZ.dump
docker compose -f deploy/docker-compose.yml start app
```

## Upgrades

```bash
cd /srv/elochair && git pull
docker compose -f deploy/docker-compose.yml up -d --build   # migrations run on start
```

Take a backup first.

## What has been verified

These were checked on 2026-11-08 in a development sandbox, not yet on ELO's server:
- The image builds.
- `docker compose up` brings up all three services healthy, and the app is served through Caddy.
- The internal listener answers only on `127.0.0.1:8081`.
- Security headers are present.
- `seed` works inside the container.
- `backup.sh` writes a dump that restores into a fresh database.
- After the review fixes, the checks were repeated:
  - the app shell is served `no-cache` and hashed assets `immutable`, with a 404 for missing assets
  - a `openssl rand -hex 32` password works in the database URL
  - a second `seed` leaves existing conferences unchanged

Real TLS certificates and SMTP delivery have not been tested, because they need the real domain and mail account.

## Needed from ELO's server administrator

- [ ] Shell access (with Docker) for whoever deploys, and the server's OS, CPU and RAM.
- [ ] A subdomain (for example `chair.eliterature.org`) pointed at the server.
- [ ] SMTP credentials for a `no-reply@eliterature.org` sender, with SPF and DKIM set up for it.
- [ ] Somewhere off the server to keep backups.
- [ ] A named contact for outages during the CFP and review periods.
