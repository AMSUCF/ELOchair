# Running ELOchair on ELO's server

ELOchair runs as four containers: the app, Postgres 16, a backup service that dumps the database every hour, and Caddy, which obtains HTTPS certificates automatically. Everything in this runbook is done from a checkout of this repository on the server.

## What the server needs

- **Host:** Linux with Docker Engine and the Docker Compose plugin.
- **Memory:** 2 GB is enough for now. Allow 4 GB once the on-server model worker for reviewer matching arrives.
- **Domain:** a DNS name pointing at the server, for example `chair.eliterature.org`, with ports 80 and 443 open.
- **Mail:** an SMTP account allowed to send as the `MAIL_FROM` address. SPF and DKIM for `eliterature.org` must cover it, otherwise sign-in emails land in spam.
- **Backups:** disk space for 82 database dumps, and somewhere off the server to copy them to.

## Install

```bash
git clone https://github.com/AMSUCF/ELOchair.git /srv/elochair
cd /srv/elochair
cp deploy/.env.example deploy/.env      # then edit: domain, database password, SECRET_KEY, SMTP
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
# A dry run for committee volunteers, as a separate conference with its own window:
elochair import-config /dev/stdin --slug elo2027-dryrun --phase cfp_open \
  --window 2026-12-01T00:00:00-05:00/2026-12-15T23:59:00-05:00 < elo2027.json
elochair set-phase elo2027 cfp_open                                 # opens the call (forward only)
elochair export-config elo2027 > elo2027.json                       # and back out again
```

Phases move forward only (`draft ⇄ cfp_open` is the one exception), whether through `set-phase` or `import-config --phase` on an existing conference. Any other move needs `--force --reason "…"`, and every move is audited with from, to and reason. A refused `import-config` changes neither the configuration nor the phase. `seed --force`, which rebuilds the built-in placeholders, is refused in production.

People sign in with a link sent to their email; there are no passwords.

## Agent tokens for chairs

Chairs can run the conference through agents. Every agent request is recorded in the audit log.

```bash
elochair create-token chair@example.org elo2027 --tier M --name "Claude Code on Ana's laptop"
elochair create-token chair@example.org elo2027 --tier C --name "Local model on the ELO server"
elochair list-tokens elo2027
elochair revoke-token <token-id>
```

- **MCP (for agents such as Claude Code):** point the agent at `https://<domain>/api/mcp` (Streamable HTTP) with the header `Authorization: Bearer elo_m_…`. The tools are read-only:
  - `conference_overview`
  - `list_submissions`
  - `get_submission`
  - `presenter_cap_report`

  Each call is recorded in the audit log.
- **Tier M (metadata)** works at `https://<domain>/api/…` with `Authorization: Bearer elo_m_…`. It returns IDs, statuses, counts and dates, but never names, titles, abstracts or reviews. It is safe to give to a cloud agent.
- **Tier C (content)** works only on the internal listener. That listener is bound to the server's loopback interface and never published to the internet. Reach it over SSH:

  ```bash
  ssh -L 8081:127.0.0.1:8081 you@server
  curl -H "Authorization: Bearer elo_c_…" http://localhost:8081/api/conferences/elo2027/submissions
  ```

  **Use tier C only with models running on your own machine or on ELO's server.** The server refuses tier C tokens on the public address, and it logs the attempt.

## Backups

The `backup` service dumps the database into `deploy/backups/` every hour and deletes old dumps by a fixed rule. It is part of the stack, so there is nothing to schedule.

- With the whole stack, `docker compose -f deploy/docker-compose.yml up -d` starts it with everything else.
- Where another web server sits in front and the services are started by name (Caddy is left out), name it too. Nothing else depends on the backup service, so it does not start on its own:

  ```bash
  docker compose -f deploy/docker-compose.yml up -d --build app backup
  ```

Check on it after every deployment, and now and then:

```bash
docker compose -f deploy/docker-compose.yml ps backup               # "healthy" once the first dump is written
docker compose -f deploy/docker-compose.yml logs --tail 20 backup
docker compose -f deploy/docker-compose.yml run --rm backup list    # the dumps, newest first
```

The service reports `unhealthy` when the newest dump is more than two hours and five minutes old, or when a retention setting is not a whole number. A dump that fails is logged, leaves no file behind, and is tried again five minutes later; the service keeps running. Nothing sends an alert: someone has to look, or the server's monitoring has to watch the container's health.

### What is kept

Each dump is one file, `deploy/backups/elochair-<UTC date and time>.dump`, for example `elochair-20270214T230000Z.dump`. It is written under a `.partial` name, read back in full, and only then given its final name, so a file with the final name is complete. The dumps hold personal data and confidential reviews: they are readable only by the owner of `deploy/backups/`, which is whoever checked out the repository, and that user can copy them without root.

After each dump, `deploy/backup-retention.sh` decides what stays. It keeps the newest dump of each of:

- the latest 48 hours,
- the latest 14 days,
- the latest 8 weeks (Monday to Sunday), and
- the latest 12 months

that have a dump, all in UTC, and it always keeps the newest dump of all. Hours, days, weeks and months without a dump are not counted, so nothing ages out while backups are stalled.

**The directory never holds more than 82 dumps** (48 + 14 + 8 + 12), however often dumps are taken, and usually fewer, because one dump can be the newest of its hour, its day, its week and its month at once. Only while a new dump is being written is there one more.

The numbers are settings in `deploy/.env`: `BACKUP_KEEP_HOURLY`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`, `BACKUP_KEEP_MONTHLY`, and `BACKUP_INTERVAL_MINUTES` for how often a dump is taken. The limit is always the sum of the four, and 0 turns a tier off.

Two things follow from "one dump for each hour":

- A second dump in the same clock hour replaces the first. Two manual backups ten minutes apart leave only the later one, and with `BACKUP_INTERVAL_MINUTES` under 60 only the latest dump of each hour stays.
- To keep one dump for good, copy it to a name of your own. Files with any other name are never deleted, and `restore` accepts them:

  ```bash
  cp deploy/backups/elochair-20270214T230000Z.dump deploy/backups/before-the-deadline.dump
  ```

### A backup now

```bash
docker compose -f deploy/docker-compose.yml run --rm backup now
```

### Off the server

**A backup on the same disk is not a backup.** `deploy/backups/` covers a bad upgrade or a mistaken deletion, not the loss of the server. Copy the dumps somewhere else as well: see [backup-offsite.md](backup-offsite.md).

The dumps hold the database and nothing else. `deploy/.env` is not in them; keep a copy of it somewhere safe and separate.

### Restoring

```bash
docker compose -f deploy/docker-compose.yml stop app
docker compose -f deploy/docker-compose.yml run --rm backup list
docker compose -f deploy/docker-compose.yml run --rm backup restore elochair-YYYYMMDDTHHMMSSZ.dump   # or: restore latest
docker compose -f deploy/docker-compose.yml start app
```

`restore` loads the dump into a new database and, only if all of it loads, gives that database the name `elochair`. A dump that does not load leaves the live database as it was. The result holds exactly what the dump holds: a table added by a later migration is gone as well, so the version of the app that wrote the dump starts on it cleanly.

The database as it was before the restore is kept, and `restore` prints its name, `elochair_before_restore_<time>`. Once you are sure of the restore, remove it:

```bash
docker compose -f deploy/docker-compose.yml exec db dropdb -U elochair elochair_before_restore_<time>
```

To check that a dump restores, without touching the live database:

```bash
docker compose -f deploy/docker-compose.yml run --rm backup restore --into elochair_check latest
docker compose -f deploy/docker-compose.yml exec db psql -U elochair -d elochair_check -c "SELECT count(*) FROM submissions"
docker compose -f deploy/docker-compose.yml exec db dropdb -U elochair elochair_check
```

## Upgrades

```bash
cd /srv/elochair
docker compose -f deploy/docker-compose.yml run --rm backup now   # a backup first
git pull
docker compose -f deploy/docker-compose.yml up -d --build         # migrations run on start
docker compose -f deploy/docker-compose.yml restart backup        # so that it runs the scripts just pulled
```

On the upgrade that first brings in the backup service there is nothing to run the first line with: pull first, then take the backup, then carry on.

If an upgrade goes wrong, check out the version that was running before, restore the dump taken in the first line (see "Restoring"), and start that version. Do not take another backup before you restore: a second dump in the same hour would replace the good one.

## What has been verified

These were checked on 2026-11-08 in a development sandbox, not yet on ELO's server:
- The image builds.
- `docker compose up` brings up all three services healthy, and the app is served through Caddy.
- The internal listener answers only on `127.0.0.1:8081`.
- Security headers are present.
- `seed` works inside the container.
- After the review fixes, the checks were repeated:
  - the app shell is served `no-cache` and hashed assets `immutable`, with a 404 for missing assets
  - a `openssl rand -hex 32` password works in the database URL
  - a second `seed` leaves existing conferences unchanged
  - the app refuses to start without `SECRET_KEY`, and with it is healthy and sends sign-in mail

Real TLS certificates and SMTP delivery have not been tested, because they need the real domain and mail account.

The backup service was checked on 2026-11-17, in a development sandbox and in CI, by `deploy/test/backup-e2e.sh` against Postgres 16 with the real schema. CI runs it again whenever the backup scripts, the Compose file or the migrations change.
- Starting `db` and `backup` writes a first dump unasked. It is mode 600 and belongs to the owner of the backup directory.
- A manual dump restores over later changes: the rows come back, a table created after the dump is gone, the audit log is append-only again, a client that was still connected is disconnected, and the previous database is kept.
- Restoring into a spare database leaves the live one untouched, and works from a dump copied to a name of its own.
- The retention policy gives the same answer in the `postgres:16` image (dash and mawk), in the `rclone/rclone` image (busybox) and on the machine that runs the test.
- With the backup directory read-only, the service turns `unhealthy` once the newest dump is too old, keeps running, logs the failure, and takes a dump by itself when the directory is writable again.

`npm run check` covers the retention policy and the failure paths of `backup.sh` (`apps/server/src/backup-scripts.test.ts`).

Not checked: a database of real size (the test database is almost empty, so how long a dump or a restore takes is unknown), a full disk, and an upgrade on a server that was running without the backup service.

## Needed from ELO's server administrator

- [ ] Shell access (with Docker) for whoever deploys, and the server's OS, CPU and RAM.
- [ ] A subdomain (for example `chair.eliterature.org`) pointed at the server.
- [ ] SMTP credentials for a `no-reply@eliterature.org` sender, with SPF and DKIM set up for it.
- [ ] Somewhere off the server to keep backups.
- [ ] A named contact for outages during the CFP and review periods.
