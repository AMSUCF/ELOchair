# Keep copies of the database backups off the server

A backup on the same disk as the database is lost with that disk. This copies every finished database dump from `deploy/backups/` to a bucket in S3-compatible object storage, and keeps the bucket to the same rolling set of dumps as the server: at most 82 with the default settings.

It is optional and separate from the backups themselves. It does not take dumps, and it changes nothing in `deploy/backups/`.

## How it works

Two small services share the work, on two machines, and each has its own bucket key:

| | Runs on | Its key can | Its key cannot |
| --- | --- | --- | --- |
| **Uploader** (`docker-compose.offsite.yml`, `offsite-upload/`) | the ELOchair server | list the bucket, put objects | delete, read |
| **Pruner** (`offsite-prune/`) | any other machine with Docker | list the bucket, delete objects | put, read |

No single machine can both add to the bucket and empty it, and neither can read a dump back.

**The uploader only adds.** Every 15 minutes it finds the newest dump name in the bucket and uploads the finished dumps on the server that are newer, oldest first and one at a time. If an upload fails it stops and starts again from that dump on the next round, so there is never a gap. It never deletes, never replaces an object that exists, and never uploads a dump older than the newest one in the bucket. Deleting dumps on the server, or rebuilding the server with an empty `deploy/backups/`, therefore removes nothing from the bucket.

**The pruner only deletes.** Every hour (or from cron) it lists the bucket, asks [`backup-retention.sh`](backup-retention.sh) which of those names the retention policy no longer keeps, and deletes exactly those. It decides from the bucket's own names, never from what is on the server. If it cannot list the bucket, or the policy refuses its settings, it deletes nothing.

**If the pruner is not running, nothing is lost.** The bucket grows by the dumps uploaded in the meantime and is cut back to the bound on the pruner's next run. Every failure here leaves more in the bucket, not less.

**Which names count.** A dump is an object named `elochair-<UTC yyyymmddThhmmssZ>.dump` whose date and time can exist. Both services treat two kinds of name as not counting, report them in the log on every round, and never delete them:

- A name shaped like a dump whose date or time cannot exist (`elochair-99999999T999999Z.dump`). It is ignored.
- A dump stamped more than five minutes later than the clock of the machine looking at it, which is what a server with a wrong clock leaves behind. The uploader does not take it for the newest dump, so later uploads carry on. The pruner does not hand it to the retention policy, where it would count as "the newest" and push real dumps out. It counts like any other dump once the clock has passed it.

So a bucket can hold a few objects beyond the bound until someone deletes them with a key that can; the log names them. If the bucket holds nothing but dumps stamped ahead, the uploader cannot tell whether they or its own clock are wrong, and uploads only its newest dump, not its history.

The retention policy is the one the server's own rolling backups in `deploy/backups/` use, so the disk and the bucket keep the same set. It is described once, under "What is kept" in [README.md](README.md): in short, the newest dump of each of the last 48 hours, 14 days, 8 weeks and 12 months that have a dump, and always the newest dump. The four settings are `BACKUP_KEEP_HOURLY`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY` and `BACKUP_KEEP_MONTHLY`. **The pruner's machine and the server must use the same four values.** The defaults are the same on both, so leave them alone unless you change them in both places.

## 1. Create the bucket and the two keys

Use a bucket that holds nothing else, and keep it private. The examples use a bucket named `my-elochair-backups` on AWS and the prefix `elochair/`.

**Turn on versioning, with a lifecycle rule that removes old versions after 30 days.** This is the safety net under the pruner. With versioning on, deleting an object hides it and keeps its contents as an old version, and neither key below can remove a version. A dump deleted by a mistake in the pruner's settings, or by someone who stole the pruner's key, can be brought back for 30 days, while the number of dumps you see in the bucket stays fixed.

```bash
aws s3api put-bucket-versioning --bucket my-elochair-backups --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket my-elochair-backups --lifecycle-configuration '{
  "Rules": [{
    "ID": "keep-deleted-dumps-30-days",
    "Status": "Enabled",
    "Filter": {},
    "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
    "Expiration": { "ExpiredObjectDeleteMarker": true },
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
  }]
}'
```

Do not add a rule that expires current objects by age: how many dumps the bucket keeps is the pruner's job.

**Create two keys, each with only its own policy.** These are the complete policies; nothing else is needed.

The uploader, for the server:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::my-elochair-backups" },
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::my-elochair-backups/elochair/*" }
  ]
}
```

The pruner, for the other machine:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::my-elochair-backups" },
    { "Effect": "Allow", "Action": "s3:DeleteObject", "Resource": "arn:aws:s3:::my-elochair-backups/elochair/*" }
  ]
}
```

Neither has `s3:GetObject` (reading a dump), `s3:DeleteObjectVersion` (removing an old version for good) or any permission over the bucket's versioning and lifecycle settings. Restoring needs a third key that can read; keep that one with whoever does restores, not on either machine.

A storage service overwrites an object when it is put again under the same name, so `s3:PutObject` alone would let a stolen uploader key replace a dump. With versioning on, the replaced dump is kept as an old version. That is the second reason to turn it on.

### Other providers

The settings and notes below are from rclone's and the providers' documentation and may be out of date. **Only the policies above have been tested, and only against MinIO, a local S3 server** (see "What has been tested"). Whatever the provider, prove the keys with the checks at the end of section 2 and section 4 before relying on them.

| Provider | `..._PROVIDER` | `..._ENDPOINT` | `..._REGION` |
| --- | --- | --- | --- |
| AWS S3 | `AWS` | leave unset | the bucket's region |
| Linode Object Storage | `Linode` | your cluster's, for example `https://us-east-1.linodeobjects.com` | leave unset |
| Google Cloud Storage | `GCS` | `https://storage.googleapis.com` | leave unset |
| Cloudflare R2 | `Cloudflare` | `https://<account id>.r2.cloudflarestorage.com` | `auto` |
| Backblaze B2 | `Other` | your bucket's, for example `https://s3.us-west-004.backblazeb2.com` | the part after `s3.`, for example `us-west-004` |

- **Linode.** Versioning and the lifecycle rule are set through the S3 API, for example with the `aws` commands above and `--endpoint-url`. Linode's access keys are read-only or read/write for a bucket; there is no key that can put but not delete. With two read/write keys everything here works, but the split between the two machines is then a habit, not something the provider enforces: versioning is what protects the dumps.
- **Google Cloud Storage.** Use HMAC keys for two service accounts, with custom roles: `storage.objects.list` and `storage.objects.create` for the uploader, `storage.objects.list` and `storage.objects.delete` for the pruner. Turn on Object Versioning and add a lifecycle rule that deletes noncurrent versions after 30 days.
- **Cloudflare R2.** R2's tokens are read-only or read-and-write, and R2 has no versioning, so it cannot give the guarantees above. Prefer another provider for this.
- **Backblaze B2.** Application keys take a list of capabilities; give each key the two that match its policy. B2 keeps old versions by default; set the bucket's lifecycle to keep prior versions for 30 days.

## 2. Start the uploader on the server

The uploader's settings go in a file of their own, `deploy/offsite-upload/.env`, which only the uploader is given:

```bash
cp deploy/offsite-upload/.env.example deploy/offsite-upload/.env
chmod 600 deploy/offsite-upload/.env
```

Then edit it, with the uploader's key:

```bash
BACKUP_OFFSITE_DEST=offsite:my-elochair-backups/elochair
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=AWS
RCLONE_CONFIG_OFFSITE_REGION=us-east-1
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=...
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=...
# RCLONE_CONFIG_OFFSITE_ENDPOINT=...      # every provider except AWS
# BACKUP_OFFSITE_INTERVAL=900             # seconds between rounds, at least 1
```

**Never put any of these in `deploy/.env`.** Everything in `deploy/.env` is given to the app container, which faces the internet and has no use for a bucket key: anyone who broke into the app could then write to the bucket. Git ignores `deploy/offsite-upload/.env`, as it does `deploy/.env`.

`BACKUP_OFFSITE_DEST` is `remote:bucket/prefix`. The remote is named `offsite`, and each `RCLONE_CONFIG_OFFSITE_*` variable is one of [rclone's S3 settings](https://rclone.org/s3/).

`deploy/backups/` must exist, with at least one dump in it. Then start the one service by name:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.offsite.yml up -d backup-offsite
```

Name the service every time. On a server where another web server sits in front of ELOchair and only the app and database containers run, a bare `docker compose up -d` would also start Caddy. If you start services with more `-f` files than these, keep them and add `-f deploy/docker-compose.offsite.yml`.

The container gets `deploy/offsite-upload/.env` and nothing else. It has none of the values in `deploy/.env`, it is on a network of its own from which the database cannot be reached, and it mounts `deploy/backups/` read-only. No other container is given the bucket key. To see that for yourself, this must print nothing:

```bash
for service in app db backup caddy; do
  docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.offsite.yml config "$service" | grep -E 'RCLONE|OFFSITE'
done
```

**Check that it works:**

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.offsite.yml logs --tail 20 backup-offsite
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.offsite.yml ps backup-offsite
```

The log has one line for each upload (`Copied (new)`) and one for each round, such as `ok: uploaded 1 dump(s); the newest here (elochair-20261117T030000Z.dump) is in offsite:my-elochair-backups/elochair`. A round that fails says `FAILED:` and why. The service is `healthy` while the newest dump on the server is in the bucket, and turns `unhealthy` after three rounds without that: when the bucket refuses the key, when the network is down, and also when `deploy/backups/` has no dump or only dumps older than the bucket's newest, which means the backups themselves have stopped.

If a round says the newest dump here "is older than the newest in the bucket", the backups on the server have stopped, or another server is uploading to this bucket, or this server's clock has been set back by more than five minutes. The uploader never uploads behind the bucket's newest dump.

A `WARNING:` about dumps "stamped later than this server's clock", or about names whose "date or time cannot exist", does not stop uploads: see "Which names count" above. Check the server's clock, and delete those objects with a key that can.

Then prove the key cannot do more than it should. Both of these must fail with an access error:

```bash
dc="docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.offsite.yml"
$dc run --rm --entrypoint rclone backup-offsite delete offsite:my-elochair-backups/elochair --s3-no-check-bucket -v
$dc run --rm --entrypoint rclone backup-offsite cat offsite:my-elochair-backups/elochair/<a dump name> --s3-no-check-bucket
```

## 3. Encrypt the dumps before they leave (recommended)

The dumps hold personal data and confidential reviews. Your provider encrypting its own disks protects them from a stolen disk, not from the provider or from anyone who gets a key that can read the bucket. To encrypt on the server, before upload, add an rclone [crypt](https://rclone.org/crypt/) remote on top of the bucket and point the destination at it, in the same `deploy/offsite-upload/.env`:

```bash
BACKUP_OFFSITE_DEST=offsitecrypt:
RCLONE_CONFIG_OFFSITECRYPT_TYPE=crypt
RCLONE_CONFIG_OFFSITECRYPT_REMOTE=offsite:my-elochair-backups/elochair
RCLONE_CONFIG_OFFSITECRYPT_FILENAME_ENCRYPTION=off
RCLONE_CONFIG_OFFSITECRYPT_PASSWORD=...
```

The password must be in rclone's obscured form. Make a long random one and obscure it:

```bash
openssl rand -base64 32          # the password: store this somewhere safe first
docker run --rm rclone/rclone:1.75.2 obscure '<the password>'    # the value for deploy/offsite-upload/.env
```

**Keep the password somewhere that is not the server**, such as the password manager of whoever would do a restore. It is the only way to read these backups. If the server is lost and the password was only in its `deploy/offsite-upload/.env`, the backups are lost with it. Nobody can reset it.

Leave `FILENAME_ENCRYPTION=off`. The contents are encrypted either way; with it off, a dump is stored under its own name plus `.bin`, so the time in the name stays readable. The pruner needs that, because it works without the password. Everything in section 2 stays the same, and so does the uploader's policy.

## 4. Start the pruner on another machine

Use a machine that is not the ELOchair server and has Docker: your own computer is fine, since a pruner that is switched off for a while only means the bucket holds more.

Get `deploy/backup-offsite.sh`, `deploy/backup-retention.sh` and the directory `deploy/offsite-prune/` onto it, by cloning the repository or by copying those three and keeping them side by side as they are here. Then:

```bash
cd deploy/offsite-prune
cp .env.example .env     # then edit: the pruner's key, the bucket, OFFSITE_DRY_RUN=1
docker compose run --rm -T prune-once
```

`BACKUP_OFFSITE_DEST` here is always the bucket itself, `offsite:my-elochair-backups/elochair`, also when the server encrypts: never give the pruner the encryption password. Keep the four `BACKUP_KEEP_*` values the same as the server's.

The pruner compares dump names with its own clock (see "Which names count"), so keep that machine's clock right: if it is far behind, the pruner sets every dump aside as "stamped later" and prunes nothing, which costs storage and loses nothing.

With `OFFSITE_DRY_RUN=1` the run lists what it would delete (`dry run: would delete elochair-....dump`) and deletes nothing. Read that list. When it is what you expect, set `OFFSITE_DRY_RUN=0` and choose one way to run it:

```bash
docker compose up -d                       # a service that prunes now and then every hour
docker compose run --rm -T prune-once      # or one run that exits, for cron or a scheduled task
```

For cron, once an hour is plenty: `17 * * * * cd /path/to/deploy/offsite-prune && docker compose run --rm -T prune-once >> prune.log 2>&1`. Every deletion is logged by name (`deleting elochair-....dump`), and a run ends with `ok:` or `FAILED:`. The looping service is `healthy` while its rounds succeed.

Prove this key too. Both of these must fail with an access error:

```bash
docker compose run --rm -T --entrypoint rclone prune-once cat offsite:my-elochair-backups/elochair/<an object name> --s3-no-check-bucket
echo test | docker compose run --rm -T --entrypoint rclone prune-once rcat offsite:my-elochair-backups/elochair/test.txt --s3-no-check-bucket
```

## Restore from the bucket

Do this once now as a drill, on your own machine, with the key that can read. Put that key's settings in a file, here `restore.env`, in the same form as section 2 (and section 3, with the password, if the dumps are encrypted). Then fetch one dump by name:

```bash
mkdir restore
docker run --rm --env-file restore.env -e RCLONE_CONFIG=/dev/null -v "$PWD/restore:/restore" \
  rclone/rclone:1.75.2 lsf offsite:my-elochair-backups/elochair          # or: lsf offsitecrypt:
docker run --rm --env-file restore.env -e RCLONE_CONFIG=/dev/null -v "$PWD/restore:/restore" \
  rclone/rclone:1.75.2 copy offsite:my-elochair-backups/elochair/elochair-20261117T030000Z.dump /restore
```

For encrypted dumps the source is `offsitecrypt:elochair-20261117T030000Z.dump`, and rclone decrypts as it downloads. Check that the file is a dump PostgreSQL can read:

```bash
docker run --rm -i postgres:16 pg_restore --list < restore/elochair-20261117T030000Z.dump | head
```

To restore it for real, follow "Backups" in [README.md](README.md) with this file. Delete `restore/` and `restore.env` afterwards: they hold personal data and a key.

A dump that the pruner deleted in the last 30 days is still in the bucket as an old version. List versions with your provider's console or `aws s3api list-object-versions --bucket my-elochair-backups --prefix elochair/`, and fetch one with `aws s3api get-object --version-id`.

## Cost

One dump of a conference of ELO's size is a few megabytes. At most 82 of them, plus up to 30 days of deleted ones, is a few gigabytes at the very most, which costs cents a month at any of these providers. The uploader makes one listing request per round and the pruner one per run.

## What has been tested

`bash deploy/backup-offsite.test.sh` runs everything below with Docker, and the **Offsite backup** workflow runs it on every change to these files. It uses MinIO as the bucket, real `pg_dump` output, and one key per role with exactly the two policies above.

- The retention policy gives the same answers under busybox (the rclone image) and under dash with mawk (the postgres image), follows ISO weeks across thirteen years of dates, and never keeps more than its bound.
- The uploader uploads finished dumps and never a `.partial`, also dumps owned by another user with mode 0600 and to a prefix that has nothing in it yet. Its key cannot delete or read.
- A dump changed on the server does not replace the one in the bucket. Deleting dumps on the server, an empty `deploy/backups/`, and a rebuilt server with one new dump all leave the bucket's history in place.
- An upload that fails stops the round, nothing after it is uploaded, and the next round carries on from it.
- The pruner cuts the bucket to exactly what the policy keeps, logs each deletion, and deletes nothing in a dry run, when the listing fails, or when a setting is not a number. Its key cannot read or put. A pruned dump is still there as an old version.
- Nothing the pruner removed is uploaded again.
- With encryption, the bucket does not hold the dump in the clear, a dump fetched back and decrypted is byte for byte the one uploaded and `pg_restore` reads it, and the pruner prunes the encrypted bucket without the password.
- A key the bucket refuses makes the uploader unhealthy and says so in the log.
- The uploader container has none of the server's other secrets and cannot reach the database. With the key and the encryption password in `deploy/offsite-upload/.env`, the rendered configuration gives them to the uploader and to no other service (the app, the database, the backup service and Caddy), and the check used for that does catch the same settings put in `deploy/.env`. The command in section 2 for seeing this yourself is run as it is written there.
- An interval of `0`, `00`, `000` or anything that is not a whole number of seconds is refused by the uploader and the pruner; `0009` and `0900` are read as 9 and 900.
- A bucket holding only `elochair-99999999T999999Z.dump` does not stop an upload, and the pruner neither counts nor deletes that object. A dump stamped March 2027, seen in November 2026, does not stop uploads or get old dumps uploaded again, and the pruner keeps the newest real dump, not that one. A bucket with nothing but a dump stamped ahead gets only the server's newest dump.

Not tested: any real provider. The settings for AWS, Linode, Google Cloud Storage, R2 and B2 come from documentation, and the lifecycle rule was not run against AWS. Dumps over 5 GiB are not supported (each is one upload); a database that size needs a different approach.
