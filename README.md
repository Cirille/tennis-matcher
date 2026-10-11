# Tennis Matcher

A React/Vite frontend and an Express/Socket.IO backend for managing tennis sessions across multiple clubs.

## Local development

Use Node.js 22.19.0 (recorded in `.nvmrc`); both packages require Node.js 22.12.0 or newer. Install dependencies in both packages:

```sh
cd server
npm ci
```

Copy `server/.env.example` to `server/.env` with your editor or file manager. Set `JWT_SECRET` and `ROOT_PASSWORD` in that file. `ROOT_PASSWORD` is needed when creating the first root account. Then start the backend:

```sh
npm start
```

In another terminal:

```sh
cd client
npm ci
npm run dev
```

The backend defaults to port 4000 and the frontend to port 5173. Set `CORS_ORIGIN` in the server environment and `VITE_SERVER_URL` in the client environment when using different URLs.

## Existing workflow

- `/root`: create a club, its join PIN, and its administrator account.
- `/admin`: manage courts, club name/location, player approvals, matchmaking, and rounds.
- `/:clubSlug`: verify the club PIN, join as a player, and view assignments and history.

Successful PIN verification issues a club-specific credential valid for 30 minutes. Club rooms validate this credential before sharing session state. Players receive a separate private credential for reconnecting, valid for 24 hours; public player IDs cannot authorize reconnection. Browser sessions are stored separately for each club and tab.

If a club has a configured location, coordinates must be valid and within 2 km. Missing or denied geolocation requires administrator approval. Clubs without a configured location allow PIN-authenticated joins without geolocation; approval-only mode always requires administrator approval.

Club name and map edits save when the field loses focus. Location links must use HTTPS on `google.com`, `www.google.com`, `maps.google.com`, `maps.app.goo.gl`, or `goo.gl`. Invalid links preserve the existing location. Empty links clear it in SQLite.

SQLite persists club/admin records and club locations. Live courts, players, approvals, and match history remain in server memory and reset when the backend restarts.

## Regression checks

```sh
cd server
npm test
```

The default backend tests run the production Express middleware, socket handlers, JWT validation, and isolated in-memory SQLite databases in one process. A test transport delivers socket events in memory; no HTTP listener or network connection is opened. Guards make the suite fail immediately if code tries to listen or connect. These tests do not load `.env`, read or alter `server/database.sqlite`, or require production credentials.

The same backend cases also run against real Express/Socket.IO connections:

```sh
# From server/
npm run test:integration
```

Integration tests bind only to `127.0.0.1` on automatically assigned ports. They require permission to use loopback networking when run by an agent in a restricted sandbox. Running `npm test` needs no network access after dependencies have been installed.

```sh
cd client
npm test
npm run lint
npm run build
```

The client tests cover reconnection, listener cleanup, private session storage, and geolocation failures. The backend tests cover PIN/session authentication, club isolation, GPS enforcement, approval, persistence, and reconnect behavior.

## Dependency isolation and portability

Each package has its own `node_modules` and committed `package-lock.json`. Use `npm ci` on each machine to install the locked versions locally; no global npm packages or Python virtual environment are required. Dependency installation can need network access, even though the default tests do not.

Do not copy `node_modules` between operating systems. Packages including SQLite and Vite's build tools contain native binaries; installing on macOS, Windows, or Linux selects the appropriate binaries for that platform. A dependency environment isolates packages, while a VM or container also standardizes the operating system.

`.github/workflows/test.yml` runs both backend suites, frontend tests, lint, and a production build on GitHub's Windows, macOS, and Linux runners using the same Node version. CI runs after the changes are pushed. Local validation on Windows alone does not establish that macOS or Linux passed.

## Deployment

`ecosystem.config.js` configures a single PM2 backend process. `nginx.conf.example` serves the built frontend, proxies the backend, and provides rate limits. Keep credentials, logs, and the SQLite database out of source changes.
