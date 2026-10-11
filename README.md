# Tennis Matcher

A React/Vite frontend and Express/Socket.IO backend for running tennis sessions across clubs. Each club has separate staff, courts, players and history.

## Local development

Use Node.js 22.19.0 (`.nvmrc`); both packages require Node.js 22.12.0 or newer.

```sh
cd server
npm ci
```

Copy `server/.env.example` to `server/.env` using your editor. Set a random `JWT_SECRET`, `ROOT_EMAIL` and a unique `ROOT_PASSWORD` of at least 12 characters (maximum 72 UTF-8 bytes). Then, from `server/`:

```sh
npm start
```

In another terminal:

```sh
cd client
npm ci
npm run dev
```

Open http://localhost:5173. The backend binds to `127.0.0.1:4000`. For different URLs, set server `CORS_ORIGIN` and client `VITE_SERVER_URL`. Production builds default to the frontend's origin; the reverse proxy serves `/api/` and `/socket.io/`.

**Existing installation:** before the first start of this version, follow the backup/upgrade instructions below. Existing club records and passwords are preserved. The first existing admin of each club becomes its owner. All staff must sign in again because older tokens lack revocation information. Courts and players from a running *old* server were never persisted: finish that evening before upgrading.

## Staff and sessions

- `/root`: the platform operator creates clubs and their first owners, and can generate an owner recovery link.
- `/admin`: owners and admins sign in with individual accounts. Both manage check-in, players, courts, matchmaking and rounds.
- **Owners** additionally manage the club name/location, approval policy, player PIN, staff roles, invitations, password resets, activity history and archive deletion. The last active owner cannot be deactivated or demoted.
- **Staff & activity** creates a private, single-use setup/reset link valid for 24 hours. Share it directly with the intended staff member; email delivery is not configured. The recipient opens it and chooses their own password. Resetting a password, deactivating staff or changing their role revokes existing tokens and open admin connections. Sign out revokes that staff account's current tokens on all devices.
- `/:clubSlug`: players enter a PIN, check in and see assignments. Share the join link from the admin dashboard.

The live session starts with check-in open. Add courts and players, choose **Arrange matches**, then **Start round** and **End round**. During a round, assignments and player removals are locked. Select a player to move them on a phone; dragging also works on desktop. Mark a player **Taking a break** to exclude them from matchmaking. A disconnected phone is displayed as offline but the player remains available until staff change their status.

**End session** archives the evening and signs players out. **Start new session** keeps court configuration and the approval policy, with a fresh player list and history. **Past sessions** shows prior rounds; snapshots keep names after players leave. **Court display** provides a read-only presentation mode on the logged-in admin screen; exit it before leaving an admin device unattended.

Every admin command carries the session ID, revision and a unique command ID. Conflicting changes refresh the latest state and ask the admin to review/retry. A retry after a lost acknowledgment reuses the same ID, so it cannot record a round twice. State, command receipt and audit entry commit together before the UI confirms a change. Old cached clients must reload.

## Check-in and privacy

PIN credentials last 30 minutes and are bound to the current club/session and PIN version. Admitted players receive private reconnect credentials valid for 24 hours. Public player IDs do not authorize reconnection. Rotating the PIN invalidates pending applicants; admitted players keep their sessions. Closing check-in blocks new admissions but permits existing players to reconnect.

Configured GPS requires valid coordinates within 2 km. Missing/denied location or out-of-range players can request staff approval. Approval-only mode always requires approval. Without GPS or approval-only mode, knowing the PIN permits check-in. GPS is a convenience check, not proof against a deliberately spoofed location.

Players awaiting admission receive only club/session metadata. Admitted players see names, avatars, assignments and round history. Levels, optional gender and pending approval details are restricted to staff. Exact player coordinates are not stored. Avatars are local or uploaded images; names are not sent to an avatar provider.

Archived player data and match history, plus audit events, are purged after 90 days by daily maintenance and on startup. The latest ended session retains empty court configuration. Owners can delete older archives sooner. Staff accounts remain until managed by the club. Operators must also apply the retention policy to backups. Publish the club/operator contact and an appropriate privacy notice before inviting real members.

## Persistence and operations

SQLite stores clubs, accounts, settings, sessions, command receipts, account links and audit events. Schema upgrades run before the server listens. Live rounds and assignments recover after a restart; players initially show offline and reconnect using their private tokens. Unapproved applications are transient, so waiting players must request approval again after reconnecting.

Run **one backend process** per database. The in-process command queue serializes reads/writes, and SQLite transactions make related writes atomic. `ecosystem.config.js` explicitly uses one PM2 process. Do not add workers or replicas against this database. Horizontal scaling needs a shared transactional store and coordinated session commands; a Socket.IO adapter alone is insufficient.

Set production `DATABASE_PATH` to an absolute path on persistent storage outside your release checkout. For compatibility, an unset path uses `server/database.sqlite`; the file is ignored by Git and is not bundled with fresh clones. A fresh database requires explicit root credentials. Never copy `.env`, production databases, account setup links or logs into Git. The previously tracked database remains in old Git commits: replace any real credentials/PINs it contained before launch, and rotate the JWT secret when retiring those credentials.

`GET /api/health` returns `{ "status": "ok" }` after database initialization and a successful query. Configure external monitoring for failures, process restarts, free disk space, certificate expiry and backup age. Winston rotates each application log at 5 MiB, keeping five files; configure retention/rotation for PM2 or system logs separately.

## Backup, restore and upgrades

The backup tool uses SQLite `VACUUM INTO` to produce a consistent snapshot, including committed WAL data. It refuses to overwrite any destination. From `server/`:

```sh
node scripts/backup.js /absolute/path/to/production.sqlite /absolute/path/to/backups/before-upgrade.sqlite
```

Windows example, using a **new filename** each time:

```powershell
node scripts/backup.js 'D:\tennis-data\production.sqlite' 'D:\tennis-backups\before-upgrade.sqlite'
```

For this checkout's default database, from `server/`:

```sh
node scripts/backup.js database.sqlite ../backups/before-upgrade.sqlite
```

Before upgrading: finish any session still running on the old memory-only version, stop the old backend, take a backup, record the deployed Git revision, then install/build the new release. Start the backend with the persistent database path, check health, sign in and verify the migrated owner before opening check-in.

For a restore drill, copy a backup to a **new database filename**, configure a separate staging process with that path and a distinct JWT secret, then verify health, staff sign-in, courts, rounds and reconnect behavior. Do not overwrite an open SQLite file or copy only its main file while WAL writes are running. For rollback, stop the failed release, preserve its database for investigation, deploy the previous code and point it to a fresh copy of the pre-upgrade backup. A pre-upgrade restore loses changes made since that backup; take this decision deliberately. Verify the restored database with `PRAGMA integrity_check` and repeat the staging workflow.

Schedule backups on the host, retain encrypted copies off-host, and practice restoration before the pilot. Backup scheduling and monitoring depend on your hosting provider and are not configured by this repository.

## Staging, then a club pilot

Staging is a separate online installation for testing. Give it its own HTTPS hostname, process/port, persistent database, `.env`, JWT secret and synthetic accounts. Do not point it at the production database. Use a distinct Nginx server configuration, CORS origin and certificate.

`nginx.conf.example` is an HTTPS reverse-proxy template. Replace the domain (including the CSP WebSocket URL), certificate paths, build directory and backend port. Obtain the certificate, run `nginx -t`, then reload Nginx. Bind the backend to loopback, set `TRUST_PROXY=loopback` and `NODE_ENV=production`, and expose only the proxy's HTTPS/HTTP ports. Real phone GPS requires HTTPS. The template permits shared-club-Wi-Fi arrivals; the app separately limits failed PINs and socket events.

Before inviting a pilot club:

1. Run all automated checks below on the intended release; require green Windows/macOS/Linux CI.
2. On staging, use two staff accounts on different devices: approve the same request, finish the same round and move the same player simultaneously. Confirm one change and a clear conflict message.
3. Test player entry from a real phone, GPS denied/out of range, a sleeping phone, Wi-Fi loss and reconnect. Confirm names and assignments remain correct.
4. Restart staging during a round and restore a backup into another staging database. Verify history, approval settings and permissions.
5. Test a realistic club arrival burst, 20–50 players initially, over the club's shared Wi-Fi. Check phone layout, no clipped controls, latency, error logs and rate limits.
6. Verify invitations, password reset, deactivation, last-owner protection, session closure and archive deletion. Confirm who handles support and privacy/deletion requests.
7. Confirm TLS, health alerts, backups, disk monitoring and a rehearsed rollback. Decide and communicate the pilot's support contact and operating hours.

A pilot is one real club using production for a few supervised evenings. Start there, collect staff/player feedback and check operational metrics before adding more clubs. This repository does not provision hosting or send invitations automatically. Automated tests are evidence for staging, not a claim that a public deployment has been validated.

## Regression checks

```sh
cd server
npm test
```

The default tests use production middleware, handlers, JWT validation and isolated SQLite databases with an in-memory socket transport. Network guards fail any attempt to open a listener or connection. Disk-based recovery/backup cases use temporary synthetic databases. Tests never load `.env` or read/write your club database.

The shared backend suites also run against real Express/Socket.IO connections:

```sh
# From server/
npm run test:integration
```

These bind only `127.0.0.1` on ephemeral ports. A restricted agent sandbox may require permission for loopback networking. They still use isolated test databases and never connect to the running app.

```sh
cd client
npm test
npm run lint
npm run build
```

Coverage includes tenant isolation, PIN/GPS/session authentication, crash prevention, restart recovery, transaction rollback, simultaneous admins, idempotency, invitations/revocation, archives, backups, matchmaking fairness, phone availability and client command retries. The frontend tests do not replace the real-device staging checks above.

Each package uses its own `node_modules` and lockfile. Use `npm ci` independently on every OS; do not copy native dependencies between Windows/macOS/Linux. `.github/workflows/test.yml` runs backend suites, frontend tests, lint and build on all three systems. Local Windows results alone do not prove other platforms pass.

CI also runs `npm audit --audit-level=high` on Ubuntu for both packages. Treat new advisories as release blockers until assessed and fixed.

For an isolated UI demo, first build the client, then run `node scripts/preview-demo.js` from `server/`. Open http://127.0.0.1:4179/admin with `owner@example.test` / `demo-password-123`. This loopback-only demo seeds fake players in an in-memory database, does not load `.env`, and discards everything when stopped with Ctrl+C. It is for local testing only.
