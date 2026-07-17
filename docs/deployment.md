# Production deployment and operations

The supported production topology is Docker Compose on an Ubuntu VM. Production
is HTTPS-only and uses all three Compose files:

```text
client -> Caddy (public edge/TLS) -> Nginx (application proxy) -> Django
                                                     Django -> PostgreSQL
```

Do not expose the base Compose HTTP listener as a production endpoint. It is a
loopback-only development path.

## Deployment paths

| Path | Files | Listener | Purpose |
|---|---|---|---|
| Development | `docker-compose.yml` | `127.0.0.1:8080` by default | Local testing only |
| Production | base + `docker-compose.prod.yml` + `docker-compose.tls.yml` | Caddy on `80/443` | Required production topology |

Production helper commands always select `.env.production` and all three files.
The production override removes Nginx's host port, requires secrets with Compose
`:?` checks, forces secure cookies, and adds Caddy. Running the production
override without the TLS overlay leaves the app unreachable rather than falling
back to cleartext.

The application and database networks are internal. Django and the one-shot
release container additionally join an unexposed egress-only bridge so SMTP and
configured SFTP/S3 storage remain reachable without publishing either service.

## Host preparation

Recommended minimum: Ubuntu LTS, Docker Compose v2.24.4 or newer (required for
the safe `!reset`/`!override` merges), 2 vCPU, 4 GB RAM, and a disk sized for
the database, uploaded media, Docker layers, and at least one local backup. Put
Docker data and backups on monitored storage.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw fail2ban unattended-upgrades \
  age openssl
curl -fsSL https://get.docker.com | sudo sh

sudo useradd --system --create-home --home-dir /opt/fleet-tracking \
  --shell /usr/sbin/nologin fleet-tracking
sudo usermod -aG docker fleet-tracking
sudo install -d -o fleet-tracking -g fleet-tracking -m 0750 /opt/fleet-tracking
sudo install -d -o fleet-tracking -g fleet-tracking -m 0700 \
  /var/backups/fleet-tracking
```

Only SSH, HTTP, and HTTPS should enter the VM. PostgreSQL, Django, Nginx, and
the Docker API must never be reachable from untrusted networks.

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp   # HTTP/3; optional, but included by Compose
sudo ufw enable
```

Restrict SSH source ranges where possible. Do not expose Docker's TCP socket.

## Production environment

Clone as the service account, then create the production environment file:

```bash
cd /opt/fleet-tracking
make prod-init-env
# .env.production is created as mode 0600 with random Django/DB secrets
editor .env.production
make prod-check
make prod-config
```

`prod-check` rejects missing/sample secrets, weak file permissions, wildcard
hosts, a non-HTTPS public URL, an inconsistent database URL, missing TLS
settings, invalid resource-limit values, unconfigured backup encryption, and
incomplete remote-media backup/restore settings.
`.env.production` must be a regular file owned by the deployment user or root
with no group/other access. Keep values compatible with both shell assignment
and Compose dotenv syntax; quote values containing spaces or shell
metacharacters.

At minimum, set:

- `TLS_DOMAIN` and `TLS_EMAIL`; public DNS must resolve to the VM.
- `DJANGO_ALLOWED_HOSTS` containing exactly the served host names.
- `DJANGO_CSRF_TRUSTED_ORIGINS=https://<TLS_DOMAIN>`.
- `PUBLIC_BASE_URL=https://<TLS_DOMAIN>`.
- SMTP values if password-reset or notification email is used.
- An `age` or GPG backup recipient as described below.

For SFTP media, create a pinned OpenSSH `known_hosts` file with the expected NAS
host key and set `SFTP_KNOWN_HOSTS_PATH` to its absolute host path. Production
Compose mounts that file read-only into the backend and release containers. The
backend uses a rejecting host-key policy; unknown or changed keys fail the
connection rather than being accepted automatically. The production Compose
topology requires `SFTP_PASSWORD`; a host `SFTP_KEY_PATH` is deliberately
rejected because the read-only, non-root backend container cannot safely read an
arbitrary host private-key file. Direct/development backend deployments may
still configure key authentication. `prod-check` also requires the SFTP
host/user/authentication values and both remote-media backup hooks.

There is no bootstrap administrator password in either template or Compose.
Create the first administrator interactively after deployment:

```bash
make prod-deploy
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tls.yml \
  exec backend python manage.py createsuperuser
```

## Releases and migrations

Migrations are an explicit release operation. A backend restart only starts
Gunicorn; it does not mutate the schema.

Initial deployment:

```bash
make prod-build
make prod-release       # waits for DB, migrates, and runs collectstatic once
make prod-up
```

Update:

```bash
make backup-prod
git pull --ff-only
make prod-build
make prod-release
make prod-up
make monitor-prod
```

Run `prod-release` once, under change control, before starting code that needs a
new schema. For breaking migrations, follow the migration's expand/contract
runbook rather than relying on container restart order. Roll back code only when
the schema remains backward compatible; otherwise use the pre-update restore.

## TLS, proxy trust, and edge controls

Caddy obtains and renews the certificate and redirects HTTP to HTTPS. Production
requires ports 80 and 443 from the internet for normal HTTP-01 issuance and user
traffic. Verify DNS and firewall policy before `prod-up`.

The forwarding-header trust boundary is explicit:

1. Internet clients connect directly to Caddy. Caddy discards incoming
   `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-For`, `X-Real-IP`, and
   `X-Forwarded-Proto` values and writes a new client IP/protocol set.
2. Nginx trusts `X-Forwarded-For` only from the dedicated `edge` subnet
   (`EDGE_SUBNET`) and overwrites the forwarding headers sent to Django.
3. Django's existing `SECURE_PROXY_SSL_HEADER =
   ("HTTP_X_FORWARDED_PROTO", "https")` is therefore safe for this topology.
   Production Compose enables `TRUST_X_FORWARDED_FOR=True` only because both
   proxy hops sanitize the value; leave it false for unsanitized direct traffic.
   `SECURE_SSL_REDIRECT=True` remains enabled, and the internal readiness probe
   supplies the same trusted HTTPS marker so it is not redirected.

If a CDN/load balancer is placed before Caddy, do not simply start trusting all
private ranges. Firewall Caddy so only the upstream can reach it, configure
Caddy with that provider's documented proxy ranges and strict client-IP header,
and keep direct access blocked. Re-test spoofed `X-Forwarded-For` requests.

Nginx enforces a secondary per-IP limit of 5 login requests/minute (small burst)
and 30 API requests/second. Django also applies its login throttle. For an
internet-facing service, configure volumetric and connection rate limiting at
the outermost controllable edge (CDN/WAF, firewall, or a rate-limit-capable
Caddy build); inner application limits do not stop bandwidth exhaustion.

Caddy emits:

- HSTS (`TLS_HSTS`, default one year; add `includeSubDomains` only when every
  subdomain is permanently HTTPS).
- A same-origin CSP allowing `data:`/`blob:` images and inline styles required
  by the current React UI, while denying objects and framing.
- `X-Content-Type-Options`, frame, referrer, permissions, and opener policies.
- `Cache-Control: no-store` for `/api/*` and `/admin*`.

Caddy and Nginx suppress version headers. Test header and CSP changes in a
browser before tightening policy further.

## Compose isolation

Services receive explicit environment variables; no service imports the whole
environment file. Networks are separated:

- `edge`: Caddy and Nginx.
- `app` (internal): Nginx, frontend, backend, and the one-shot release job.
- `db` (internal): backend, release job, and PostgreSQL only.
- `egress`: backend and the one-shot release job; outbound connectivity only,
  with no published service ports.

Containers use read-only root filesystems where feasible, dropped capabilities,
`no-new-privileges`, bounded PID/memory/CPU settings, tmpfs runtime paths, and
rotated `json-file` logs. Named volumes are the only persistent writable paths.
Resource limits are safety ceilings, not capacity planning; tune them after
observing production load. `MAX_UPLOAD_SIZE_MB` may be lowered but cannot exceed
25 in the supported topology because Caddy and Nginx enforce a fixed 30 MB
decimal request-body ceiling. Keep `GUNICORN_WORKERS` at four or fewer with the
shipped 1 GB memory and 128 MB upload-spool tmpfs limits.

Staged photo/signature quotas are serialized per uploader. When that uploader
next uploads a file, unattached files older than `STAGED_MEDIA_TTL_HOURS` are
expired from metadata and storage before the quota is evaluated.

## Encrypted backups

`make backup-prod` creates one encrypted bundle plus a ciphertext SHA-256 file.
The plaintext bundle never leaves the owner-only backup directory and is removed
on exit. Its authenticated encryption detects tampering; the protected inner
manifest checks every component independently.

Contents:

- PostgreSQL custom-format dump.
- Local media archive, or output from `BACKUP_REMOTE_MEDIA_HOOK`.
- Caddy certificate, account, and ACME state (`caddy_data` and `caddy_config`).
- Metadata (UTC time, Git revision, topology, storage backend).
- SHA-256 manifest.

The script sets `umask 077`, takes an exclusive lock, and stops the running
application edge/backend while dumping the database and media. This prevents
application writes between those two captures. PostgreSQL remains online for
`pg_dump`. External systems and direct database writers must also be quiesced.

### age

Create the identity on a protected administrative machine, not on the app VM:

```bash
age-keygen -o fleet-backup.agekey
chmod 600 fleet-backup.agekey
# Put the printed public age1... recipient in AGE_RECIPIENT.
```

The VM only needs the public recipient for backup. Supply the identity through a
protected, preferably temporary, `AGE_IDENTITY_FILE` for restore. Copy the
identity to a separate recovery vault and test it.

### GPG

Import only the backup recipient's public encryption subkey on the app VM, set
`BACKUP_ENCRYPTION=gpg`, and set `GPG_RECIPIENT` to the full fingerprint. Keep
the private key offline and import it only on the recovery host. GPG backups use
integrity-protected OpenPGP encryption.

### Retention, offsite copy, and status

`BACKUP_RETENTION_DAYS` removes older local encrypted bundles after a successful
backup. It does not control remote retention. `BACKUP_OFFSITE_HOOK`, when set,
must be an executable and is called as:

```text
hook <encrypted-bundle> <ciphertext-sha256-file>
```

The hook must return nonzero unless the durable remote write is complete.
`make backup-status` verifies the latest ciphertext and sidecar checksum,
enforces `BACKUP_MAX_AGE_HOURS`, and requires a successful latest offsite hook
when one is configured.

For SFTP/S3 media, `BACKUP_REMOTE_MEDIA_HOOK` must create the requested
`media.tar.gz` while the app is quiesced. Prefer storage-native immutable
versions/snapshots and make the hook export the matching generation.

Install backup, monitoring, and staged-media cleanup timers:

```bash
sudo cp deploy/systemd/fleet-tracking-{backup,monitor}.{service,timer} \
  /etc/systemd/system/
sudo cp deploy/systemd/fleet-tracking-media-cleanup.{service,timer} \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fleet-tracking-backup.timer \
  fleet-tracking-monitor.timer fleet-tracking-media-cleanup.timer
systemctl list-timers 'fleet-tracking-*'
```

Adjust paths/users in the units if the deployment differs. The hourly cleanup
runs `cleanup_staged_media`, which removes unattached photos/signatures older
than `STAGED_MEDIA_TTL_HOURS` from both metadata and configured storage. New
uploads also opportunistically expire stale files owned by the same uploader.

## Validated restore and rollback

Restore is intentionally two-phase and requires `CONFIRM=YES`:

```bash
make restore-prod \
  BUNDLE=/var/backups/fleet-tracking/fleet-backup-YYYYMMDDTHHMMSSZ.tar.gz.age \
  CONFIRM=YES
```

Before touching active data, the script:

1. Verifies the ciphertext sidecar checksum.
2. Decrypts into an owner-only staging directory.
3. Rejects absolute paths, traversal, links, devices, and unexpected files.
4. Verifies the protected component manifest and inner archive paths.
5. Waits for PostgreSQL readiness and validates `pg_restore --list`.
6. Restores into a temporary database and verifies Django migration history.
7. Restores media and Caddy archives into temporary Docker volumes.

Only then does cutover stop the app, preserve the active database under a
timestamped rollback name, copy active volumes into timestamped rollback
volumes, and switch in the staged data. The backend must return healthy
(database plus configured-media connectivity) or the script automatically
switches back. A successful restore writes an owner-only
`restore-rollback-<id>.json`.

Roll back during the acceptance window with:

```bash
make rollback-prod \
  STATE=/var/backups/fleet-tracking/restore-rollback-<id>.json \
  CONFIRM=YES
```

The rollback keeps the replaced database and pre-rollback copies of the active
volumes under timestamped names. Remove old databases and rollback volumes only
after application, document, media, authentication, and TLS acceptance tests
pass. Record their names from the restore output/state; do not automate
immediate deletion.

Remote SFTP/S3 restores require an executable `RESTORE_REMOTE_MEDIA_HOOK`. It is
called with `stage`, `verify`, `cutover`, and `rollback` phases and must use
provider-native versions or staging prefixes so cutover and rollback are
atomic from the application's point of view:

```text
hook <phase> <media-archive-or-empty> <restore-id>
```

The later standalone rollback command supplies an empty archive argument, so
the hook must retain/recover its provider-side state by restore ID.

Test the entire restore quarterly on an isolated host and record duration and
evidence. Never run a restore drill against production.

## Monitoring and logs

`make monitor-prod` checks:

- External HTTPS readiness and certificate validation.
- Certificate remaining lifetime (`CERT_MIN_VALID_DAYS`, default 14).
- Latest backup age, checksum, and offsite result.
- Disk usage for `/` and the backup path (`DISK_PATHS`,
  `DISK_USAGE_CRITICAL_PERCENT`).

Send timer failures to the existing alerting system; a local failed unit is not
an alert by itself. Also monitor VM availability, memory pressure, Docker daemon
health, database growth, media growth, HTTP 5xx/latency, failed logins, and PBS
jobs.

`/api/health/` is liveness. `/api/health/ready/` checks the database and performs
a harmless metadata lookup through the configured local, SFTP, or S3 media
backend. It returns separate `database`/`media` fields and HTTP 503 when either
operation fails. The Compose backend healthcheck calls this endpoint before
Nginx/Caddy can become healthy.

Compose rotates each container's local JSON logs at 10 MB, retaining five
files. Forward stdout/stderr and host journal logs to a separate log system
(Loki, Elastic, syslog, or equivalent) over authenticated TLS. Define central
retention and access controls; local rotation is not audit retention. Avoid
logging cookies, authorization headers, reset links, uploaded contents, or
secrets.

## Proxmox disaster recovery

Define business-approved objectives. A practical starting point for this MVP is:

- App-level encrypted backup every 24 hours: application RPO <= 24 hours.
- Proxmox Backup Server (PBS) VM backup every 24 hours: infrastructure RPO <=
  24 hours.
- Documented rebuild plus tested restore: target RTO <= 4 hours.

Increase backup frequency if 24 hours of workflow data is unacceptable. Measure
actual backup/restore time and revise RTO; snapshots alone do not prove it.

Use PBS in addition to application backups. Enable PBS client-side encryption,
store its key in the recovery vault, run prune/garbage-collection/verification
jobs, and replicate to a different failure domain. VM snapshots are generally
crash-consistent; the quiesced app bundle is the authoritative portable restore.

Recovery order:

1. Recover network/DNS/firewall and an Ubuntu/Docker host, or restore the VM
   from PBS.
2. Restore the repository at the recorded Git revision.
3. Restore `.env.production` from the secret vault with mode 0600.
4. Recover the age/GPG identity and latest verified offsite bundle.
5. Run `prod-config`, then the staged restore.
6. Validate HTTPS, certificate, login, database workflows, media/PDF access,
   audit logs, email, backup status, and monitoring.

Application backup storage should be encrypted at rest (LUKS/ZFS native
encryption or encrypted object storage) in addition to bundle encryption. For
S3-compatible offsite storage, enable TLS, server-side KMS encryption,
versioning, and Object Lock/WORM with a separate restricted backup identity.
Use a retention policy that satisfies legal/business needs, for example 30
daily, 12 monthly, and 7 yearly copies, subject to personal-data requirements.

Document deletion and legal-hold ownership. Expiring object-lock retention,
deleting every version, destroying KMS/age/GPG keys, and running PBS prune plus
garbage collection are distinct erasure steps. Encryption-key destruction is
crypto-erasure only when no plaintext copy or alternate key remains.

## Supply-chain controls

Runtime Postgres, Nginx, Caddy, and backup-helper tags are patch-version pinned.
CI actions are pinned to immutable commit SHAs. CI audits Python and npm
dependencies, scans built backend/frontend images for high/critical
vulnerabilities, and retains CycloneDX Python/container SBOMs.

`make python-lock` deterministically resolves `backend/requirements.txt` with
pip-tools 7.5.3 under Python 3.13 into
`deploy/requirements/backend-py313.lock`. Review lock diffs and vulnerability
results during upgrades. Dependabot checks actions, pip constraints, and npm
weekly.

Run `make validate` before deployment. It checks shell/Python syntax, forbidden
Compose env-file injection and startup migrations, production merge invariants,
and (when Docker is available) Compose, Caddy, and Nginx configuration.

## Local development

Development remains simple and is deliberately non-production:

```bash
install -m 600 .env.example .env
make up
# http://127.0.0.1:8080
```

`make up` builds, runs the explicit development release task, and starts the
loopback stack. To expose it temporarily on a trusted developer network, change
`NGINX_BIND_IP` knowingly; never turn that into the production path.

## Remaining application and image changes

These were intentionally not changed in this deployment-only hardening pass:

1. `backend/config/settings.py` should enforce production invariants even
   outside Compose: reject `DEBUG=True`, wildcard/empty `ALLOWED_HOSTS`,
   empty/non-HTTPS CSRF origins, insecure session/CSRF cookies, non-HTTPS
   `PUBLIC_BASE_URL`, and zero HSTS. Compose and `prod-check` enforce these
   today, but direct process launches can bypass them.
2. `/api/health/ready/` intentionally uses a low-cost metadata request. It proves
   backend reachability but not write/delete permission. Deployment acceptance
   must still upload and download a disposable photo against the real storage
   backend; adding an infrequent bounded write probe is future operational work.
3. `backend/Dockerfile` still contains migrate/collectstatic in its image
   default command. Compose overrides it, but direct `docker run` does not.
   Replace the image CMD with Gunicorn only and expose a separate release
   entrypoint.
4. Backend/frontend Dockerfile base images are still mutable tags, and the
   backend image still installs broad `requirements.txt` constraints. Pin base
   image digests and install the reviewed hash-locked file generated above.
   Regenerate pins on a scheduled security-update cadence.
