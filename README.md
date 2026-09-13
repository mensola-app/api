# Mensola — API

The backend REST API for Mensola. Built with Node.js, Express 5, and PostgreSQL, it powers all data operations for the mobile app — authentication, music tracking, movie lists, social features, and media storage.

---

## Prerequisites

Make sure the following are installed on your machine:

- **Node.js** 20+
- **Docker** & **Docker Compose** (recommended for local development)
- A copy of the `.env` file (see [Environment Variables](#environment-variables) below)

---

## Getting Started

### With Docker (recommended)

Docker Compose handles the API server and PostgreSQL database together. This is the easiest way to get a fully working environment running locally.

```bash
cd api

# Install dependencies
npm install

# Copy the example env file and fill in the values
cp .env.example .env

# Start the API and database in development mode
npm run docker:dev
```

The API will be available at **`http://localhost:3457`**.

Hot-reloading is enabled in development mode — changes to source files under `src/` are reflected immediately without restarting the container.

### Without Docker

If you prefer to run the API directly (requires a running PostgreSQL instance):

```bash
cd api

# Install dependencies
npm install

# Set up your .env file (see below)

# Run database migrations and start the dev server
npm run dev
```

The API will listen on the port defined by `PORT` in your `.env` (default: `3000`).

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run migrations and start dev server with hot-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run migrations and start production server from `dist/` |
| `npm test` | Run the test suite with Jest |
| `npm run docker:dev` | Start API + PostgreSQL via Docker Compose (dev) |
| `npm run docker:dev:down` | Stop and remove Docker containers (dev) |
| `npm run docker:prod` | Build and run production containers |
| `npm run docker:test` | Run the full test suite inside Docker |
| `npm run docker:test:down` | Clean up test containers and volumes |
| `npm run migrate:dev` | Run database migrations (development) |
| `npm run migrate:prod` | Run database migrations (production, compiled) |

---

## Environment Variables

Create a `.env` file in the `api/` directory. All variables below are required unless marked optional.

```env
# Server
PORT=3000

# PostgreSQL
POSTGRES_HOST=db
POSTGRES_USER=your_db_user
POSTGRES_PASSWORD=your_db_password
POSTGRES_DB=mensola_db

# PostgreSQL (test environment)
POSTGRES_TEST_USER=your_test_user
POSTGRES_TEST_PASSWORD=your_test_password
POSTGRES_TEST_DB=mensola_test_db

# JWT
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_jwt_refresh_secret

# Email (SMTP)
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=465
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password

# TMDB (https://www.themoviedb.org/settings/api)
TMDB_API_KEY=your_tmdb_api_key
TMDB_ACCESS_TOKEN=your_tmdb_access_token

# Spotify (https://developer.spotify.com/dashboard)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Cloudflare R2 (https://dash.cloudflare.com)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://cdn.your-domain.com

# Telegram (optional — used for internal alerts)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
```

### Getting Third-Party API Keys

| Service | Where to get it |
|---|---|
| TMDB | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| Spotify | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |
| Cloudflare R2 | [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → Manage API tokens |
| Google OAuth | [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials |
| Telegram Bot | Create a bot via [@BotFather](https://t.me/BotFather) on Telegram |

---

## API Endpoints

All routes are prefixed with `/api/v1`.

| Resource | Base path | Description |
|---|---|---|
| Auth | `/api/v1/auth` | Registration, login, token refresh, email verification |
| Users | `/api/v1/users` | Profiles, follow/unfollow, search |
| Movies | `/api/v1/movies` | Movie lists, ratings, watchlist |
| Tracks | `/api/v1/tracks` | Music track logging and history |
| Playlists | `/api/v1/playlists` | Custom playlist management |
| Albums | `/api/v1/albums` | Album tracking |
| Bookmarks | `/api/v1/bookmarks` | Saved content |
| Comments | `/api/v1/comments` | Comments on any content |
| Notifications | `/api/v1/notifications` | User notification feed |
| Devices | `/api/v1/devices` | Push notification device tokens |
| TMDB | `/api/v1/tmdb` | Proxied TMDB movie/TV search |
| Spotify | `/api/v1/spotify` | Proxied Spotify music search |
| Storage | `/api/v1/storage` | Media file upload |
| Short Links | `/api/v1/short-links` | Generate short links for deep linking |
| Beta | `/api/v1/beta` | Beta sign-up endpoint |
| Home | `/api/v1/home` | Aggregated home feed |

---

## Running Tests

Tests use Jest and Supertest and run against a dedicated test database.

```bash
# Run tests locally (requires POSTGRES_TEST_* vars in .env)
npm test

# Run tests in Docker (isolated, no local DB required)
npm run docker:test

# Clean up Docker test containers
npm run docker:test:down
```

Test files live in the `tests/` directory.

---

## Project Structure

```
api/
├── src/
│   ├── config/         → Database connection, environment config
│   ├── controllers/    → Route handler functions
│   ├── jobs/           → Scheduled background jobs (node-cron)
│   ├── middlewares/    → Auth, error handling, rate limiting
│   ├── migrations/     → SQL migration files
│   ├── queries/        → Raw SQL query modules
│   ├── routes/         → Express route definitions
│   │   └── v1/         → Versioned API routes
│   ├── services/       → External API integrations (Spotify, TMDB, R2)
│   ├── scripts/        → Migration runner script
│   ├── types/          → Shared TypeScript types
│   ├── utils/          → Helper utilities
│   ├── validations/    → Zod schemas for request validation
│   ├── app.ts          → Express app setup
│   └── index.ts        → Server entry point
├── tests/              → Jest integration tests
├── Dockerfile
├── docker-compose.yaml         → Production compose
├── docker-compose.dev.yaml     → Development overrides
├── docker-compose.test.yaml    → Test environment compose
└── package.json
```

---

## Docker Details

The production Docker image uses a multi-stage build. The Compose setup includes:

- **`mensola-api`** — the Express API server
- **`mensola-db`** — PostgreSQL 15 (Alpine), with a health check before the API starts

Data is persisted in a named Docker volume (`pgdata`) across container restarts.

```bash
# Production (detached)
npm run docker:prod

# Development (with logs)
npm run docker:dev

# Stop development containers
npm run docker:dev:down
```
