# Forge

Forge is a private, full-stack training coach for planning workouts, logging sessions, reviewing progress, and receiving AI-assisted guidance. Training data is native to Forge: exercises, machine profiles, plans, programs, workout sessions, and progression history belong to the signed-in account.

> Forge is a coaching tool, not medical advice. Training, nutrition, and health decisions remain the user's responsibility.

## What Forge does

### Training in Forge

- Own exercise library with muscle groups, equipment, notes, and optional machine-specific profiles.
- Reusable routines with prescribed warm-up and working sets.
- Training programs organized as either a weekly schedule or a rotation.
- A "today" view that selects the scheduled or next routine.
- Editable workout-session snapshots: a started session remains historically accurate even when the original routine changes later.
- Completed-session history with actual weights, repetitions, set completion, and per-exercise history.
- Deterministic progression targets based on comparable completed Forge sessions, including increase, keep progressing, stagnation, regression, and first-session states.

### AI-assisted coaching

- Gemini-assisted exercise and routine drafts that must be explicitly saved by the user.
- Daily briefings, workout tips, session reviews, training/nutrition analysis, reports, trends, and achievements.
- In-session coaching chat that may propose a set adjustment or exercise addition. Proposed actions are validated against the current session and the user's own library, then require an explicit apply or dismiss action.
- Daily monthly-challenge check-ins. AI writes the coaching message, while challenge targets and numerical progress are calculated server-side.

### Progress and optional nutrition

- Five persistent monthly challenge categories: consistency, strength, weight, nutrition, and quality.
- Forge-only workout, strength, and training-quality challenge metrics.
- Optional Yazio connection for nutrition, protein, calorie, and weight context.
- Private progress photos with server-side image normalization and metadata stripping. Photo files require authenticated owner access and are not exposed through public URLs.

## Architecture

```text
React 19 + TypeScript + Vite
            |
            | HTTPS / JSON + Bearer token
            v
FastAPI + SQLAlchemy + APScheduler
     |              |              |
     v              v              v
PostgreSQL      Gemini API     Optional Yazio data
     |
     v
Private persistent photo storage
```

Forge keeps workout plans and completed workout sessions in PostgreSQL. Yazio is optional and supplies nutrition/weight context only; the core training experience does not depend on a third-party workout tracker.

## Technology

| Area | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, React Router, Recharts, Lucide |
| Backend | Python, FastAPI, SQLAlchemy, APScheduler |
| Database | PostgreSQL |
| Authentication | JWT bearer tokens and bcrypt password hashes |
| AI | Google Gemini via `google-genai` |
| Images | Pillow with server-side WebP normalization |

## Repository layout

```text
.
├── backend/
│   ├── app/
│   │   ├── routes/              # Auth, user, Forge, briefing, challenges
│   │   ├── services/            # AI, Forge, Yazio, photo-storage services
│   │   ├── models.py            # SQLAlchemy models
│   │   ├── schemas.py           # Pydantic API schemas
│   │   ├── security.py          # Password and JWT helpers
│   │   └── config.py            # Environment-backed settings
│   ├── main.py                  # FastAPI application and scheduler lifecycle
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/                 # Authenticated API client
│   │   └── components/          # Forge UI and screens
│   ├── package.json
│   └── vite.config.ts
├── migrate_add_*.py             # Manual one-time upgrade scripts
└── README.md
```

## Run locally

### Prerequisites

- Python 3.10 or newer
- Node.js 18 or newer
- PostgreSQL
- A Google Gemini API key

### 1. Create a PostgreSQL database

Create an empty local database, for example:

```sql
CREATE DATABASE forge;
```

### 2. Configure and start the backend

From `backend/`, create a virtual environment and install the Python dependencies:

```bash
python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
# .\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env`, then replace every placeholder with real local values. Required variables are:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/forge
JWT_SECRET_KEY=replace-with-a-long-random-secret
ENCRYPTION_KEY=replace-with-a-fernet-key
GEMINI_API_KEY=replace-with-your-gemini-api-key
```

Optional configuration:

```dotenv
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Required only when progress-photo uploads are enabled.
# Use a private, persistent directory; never a publicly served directory.
PHOTO_STORAGE_DIR=/absolute/private/forge-progress-photos

# Optional server-level Yazio example values. Individual users connect Yazio
# through the authenticated application settings instead.
YAZIO_EMAIL=
YAZIO_PASSWORD=
```

Generate safe local secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Start the API from `backend/`:

```bash
uvicorn main:app --reload
```

The local API runs at `http://localhost:8000`.

- OpenAPI / Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Health check: `http://localhost:8000/health`

### 3. Configure and start the frontend

Create `frontend/.env.local` manually (there is currently no frontend environment template):

```dotenv
VITE_API_URL=http://localhost:8000
```

Then run the frontend from `frontend/`:

```bash
npm install
npm run dev
```

Vite serves the application at `http://localhost:5173` by default.

## Database setup and upgrades

For a fresh database, the application creates tables from the current SQLAlchemy models on startup.

Existing installations need more care: this repository currently uses manual one-time `migrate_add_*.py` scripts rather than a unified migration framework. Before upgrading an existing database:

1. Make a verified database backup.
2. Review the migration scripts and select the ones that match the database's current schema.
3. Run Forge planning migrations before Forge session migrations.
4. Configure persistent private photo storage before applying the progress-photo migration.
5. Ensure the database supports `gen_random_uuid()` before running migrations that use it.

Do not assume that starting the server automatically migrates an older production schema.

## Background jobs

The FastAPI lifespan starts an APScheduler instance for:

- Monthly-challenge daily check-ins at **03:00 Europe/Berlin**.
- Daily briefings at **04:00 Europe/Berlin**.
- Periodic Forge workout-tip generation for newly completed sessions.

The manual check-in action in Settings is account-scoped and idempotent. It creates at most one check-in per account, month, and day.

## API overview

All routes except authentication and health routes require an `Authorization: Bearer <JWT>` header. The generated documentation at `/docs` is the authoritative reference for request and response schemas.

| Area | Route group | Purpose |
| --- | --- | --- |
| Authentication | `/auth/register`, `/auth/login` | Account registration and login |
| User settings | `/user/*` | Profile, goal, language, and optional Yazio connection |
| Forge | `/api/forge/*` | Exercise library, plans, programs, sessions, AI drafts/chat, and progress photos |
| Coaching | `/api/briefing/*` | Briefings, workout reviews/tips, reports, analysis, and trends |
| Monthly challenges | `/api/challenges/monthly/current`, `/api/challenges/monthly/check-in` | Current cycle, live Forge progress, and daily check-in |
| Health | `/`, `/health` | Service availability |

## Security and privacy

This is a public repository. Treat all real credentials and user data as private.

- Never commit `.env` files, database URLs containing passwords, API keys, JWT secrets, Fernet keys, Yazio credentials, screenshots, or user exports.
- The repository ignores `.env` files; verify this before every commit with `git status`.
- Passwords are hashed with bcrypt. API access uses JWT bearer tokens.
- Third-party credentials are encrypted at rest with Fernet and are only decrypted server-side when needed for an integration request.
- Forge routes are account-scoped: data access and mutations are filtered by the authenticated user.
- Progress photos are validated, stripped of metadata, converted to WebP, stored outside public web roots, and served only after owner authorization.
- The frontend currently stores the JWT in browser `localStorage`; protect the application against XSS and use HTTPS in production.
- Do not put production credentials into issues, pull requests, logs, screenshots, or AI prompts.

If a secret is exposed, revoke or rotate it immediately. Do not report live credentials in a public GitHub issue.

## Validation

Run these checks before opening a pull request:

```bash
# Backend, from backend/
python -m compileall -q app

# Frontend, from frontend/
npm run lint
npm run build
```

## Contributing

1. Create a focused branch.
2. Keep Forge as the authoritative workout source; do not introduce a dependency on an external workout tracker for core training flows.
3. Preserve account ownership checks on new reads and writes.
4. Do not add secrets, private data, or generated user content to Git.
5. Run the relevant validation commands before submitting a pull request.

## License

No license file is currently included in this repository. Add an explicit license before treating the code as reusable or redistributable.
