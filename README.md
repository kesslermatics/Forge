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
- Training/nutrition analysis, reports, trends, and achievements.
- In-session coaching chat that may propose a set adjustment or exercise addition. Proposed actions are validated against the current session and the user's own library, then require an explicit apply or dismiss action.

### Progress and optional nutrition

- Native food tracking with user-defined meal slots (e.g. Frühstück, Pre-Workout), hybrid search (trigram + embeddings), barcode scanning and a product page with full nutrient breakdown.
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
| Authentication | Seven-day JWT browser sessions, bcrypt password hashes, and revocable non-expiring personal API keys |
| Agent tools | MCP Python SDK v2 Streamable HTTP endpoint mounted in FastAPI |
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
│   │   ├── security.py          # Password, JWT, and personal-key helpers
│   │   ├── mcp_server.py        # Authenticated Streamable HTTP MCP tools
│   │   └── config.py            # Environment-backed settings
│   ├── main.py                  # FastAPI, /mcp mount, and scheduler lifecycle
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
ACCESS_TOKEN_EXPIRE_MINUTES=10080  # 7 days

# Required only when progress-photo uploads are enabled.
# Private S3-compatible bucket (e.g. Cloudflare R2). Endpoint without bucket name.
S3_ENDPOINT_URL=https://<account-id>.eu.r2.cloudflarestorage.com
S3_BUCKET=forge
S3_REGION=auto
S3_KEY_PREFIX=photos/
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

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

The manual check-in action in Settings is account-scoped and idempotent. It creates at most one check-in per account, month, and day.

## Food catalog

Food tracking reads products from a separate PostgreSQL database with `pgvector` (`pgvector/pgvector:pg17` in Dokploy). It holds no personal data and can always be rebuilt; diary entries live in the main database and keep their own nutrient snapshot.

- Sources: [BLS 4.0](https://blsdb.de/) by the Max Rubner-Institut (CC BY 4.0, DOI 10.25826/Data20251217-134202-0) for generic foods, and the official [Open Food Facts](https://world.openfoodfacts.org/data) Parquet export (ODbL) filtered to products sold in Germany or with a German GS1 prefix.
- Embeddings: `google/gemini-embedding-2` via OpenRouter, 768 dimensions, stored as `halfvec` with an HNSW index. Only rows with complete macros are embedded.
- Barcodes missing locally are looked up once via the live Open Food Facts API and cached in the catalog.

Build or refresh the catalog from `backend/` (idempotent; unchanged rows keep their embeddings, a full run also removes OFF products that disappeared upstream):

```bash
pip install -r tools/requirements-food-import.txt
FOOD_CATALOG_DATABASE_URL=postgresql://... OPENROUTER_API_KEY=... python tools/food_catalog_import.py
```

The tool downloads BLS and the ~8 GB OFF Parquet file when `--bls-xlsx` / `--off-parquet` are not given.

Daily refresh: a Dokploy schedule on the backend app runs `python -m app.services.food_catalog_sync` at 04:30 (Europe/Berlin). It applies the official [OFF delta exports](https://static.openfoodfacts.org/data/delta/) (one small JSONL file per day, kept about two weeks) newer than the watermark in `catalog_meta.off_delta_until`, upserts German products, removes obsolete ones and embeds new or renamed rows. Runs are logged in `import_runs` (`details.kind = off_delta`). If the job is down for more than two weeks, rerun the full import. BLS updates (about yearly) stay a manual full import.

## API overview

Browser routes use `Authorization: Bearer <JWT>`. The dedicated read-only Coach-tool route also accepts `X-API-Key: <personal-key>` for MCP adapters. Personal keys can be created and revoked only through a JWT-authenticated profile session. The generated documentation at `/docs` is the authoritative reference for request and response schemas.

| Area | Route group | Purpose |
| --- | --- | --- |
| Authentication | `/auth/register`, `/auth/login` | Account registration and login |
| User settings | `/user/*` | Profile, personal API keys, language, and optional Yazio connection |
| Coach tool API | `POST /api/coach/tools/{tool_name}` | API-key- or JWT-authenticated read-only Coach context |
| Remote MCP | `/mcp` | Bearer-key-authenticated Streamable HTTP tools for external agents |
| Forge | `/api/forge/*` | Exercise library, plans, programs, sessions, AI drafts/chat, and progress photos |
| Coaching | `/api/briefing/*` | Reports, analysis, trends, and the coach chat |
| Health | `/`, `/health` | Service availability |

## Personal API keys and MCP

The FastAPI backend serves the Coach context tools and a set of plan-editing tools directly over **Streamable HTTP** at:

```text
https://forge.kesslermatics.com/mcp
```

**Read tools** cover profile/current Yazio goal, training plans, workouts, exercise history, nutrition, steps/activity, sleep, weight history, and saved coaching memory. `get_workouts`, `get_exercise_history` and `get_nutrition_range` accept `start_date`/`end_date` or `days` (up to 730 days for training, 180 for nutrition). To keep responses small, long ranges are aggregated (`granularity` for nutrition, `detail: summary` for workouts), paged (`offset`/`next_offset`) and trimmed to a size budget; a `truncation` or `notes` field says when that happened.

**Plan tools** let an agent manage the training setup: `list_plans`, `create_plan`, `update_plan` (exercises, order, warm-up and working sets), `delete_plan` (needs `confirm=true`), `get_training_program` / `update_training_program` (rotation or weekly split), and `list_exercises` / `create_exercise` / `update_exercise`. Workout tracking itself stays in the Forge app; MCP cannot start, edit or complete sessions.

**Analytics tools** (also available to the built-in Coach) return compact, estimate-labelled results: `get_volume_and_frequency_analysis` (weekly effective sets per muscle vs. MEV/MAV/MRV), `get_strength_progression_analytics` (e1RM, tonnage, plateaus), `get_metabolic_trend_analysis` (TDEE from intake and weight trend), `get_macro_adherence_score`, `get_sleep_and_performance_correlation`, `get_performance_correlations` (training time, previous-day steps) and `project_goal_timeline` (target-weight corridor and what-if scenarios). Nutrition-based tools query Yazio per day, so long windows take a few seconds.

MCP runs in the same backend process and calls account-scoped services directly—there is no second MCP service, subprocess, database credential, or HTTP loopback adapter. The built-in Coach uses the same read tools but has no write tools.

### Create and revoke a key

1. Sign in to Forge and open **Profile & Settings**.
2. Under **API keys & MCP**, enter a descriptive name such as `My agent chat`.
3. Create the key and copy the complete `forge_live_...` value from the one-time dialog.
4. Store it in the secret configuration of the agent application that connects to Forge MCP.

Only a SHA-256 hash and public prefix are stored by Forge. Keys do not expire automatically, but can be revoked immediately from Settings. Every key can read Coach data and edit training plans, the training split and the exercise library. Keys cannot create keys, change the profile or integrations, or modify recorded workouts.

MCP clients send the personal key using the standard bearer header:

```http
Authorization: Bearer forge_live_REPLACE_WITH_THE_ONE_TIME_VALUE
```

The browser JWT is a separate credential and is not intended for remote MCP connections.

### Deployment configuration (Dokploy)

`mcp==2.0.1` is installed with `backend/requirements.txt`, and the FastAPI app mounts MCP under `/mcp`.

The `forge.kesslermatics.com` hostname works with the checked-in defaults. For another backend hostname, set:

```dotenv
MCP_SERVER_URL=https://your-backend.example.com/mcp
MCP_ISSUER_URL=https://your-backend.example.com
MCP_ALLOWED_HOSTS=your-backend.example.com
MCP_ALLOWED_ORIGINS=https://your-agent.example.com
```

Native/server-side MCP clients normally omit `Origin`; `MCP_ALLOWED_ORIGINS` is mainly needed for browser-based clients. Keep DNS-rebinding protection enabled and list exact public hostnames.

### Connect another Python agentic chat

Install the MCP client in the other application's backend:

```bash
pip install "mcp==2.0.1"
```

Create one authenticated Streamable HTTP client per Forge account or securely isolated worker:

```python
import os

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

forge_api_key = os.environ["FORGE_API_KEY"]

async with httpx2.AsyncClient(
    headers={"Authorization": f"Bearer {forge_api_key}"},
    timeout=httpx2.Timeout(30.0, read=300.0),
) as http_client:
    transport = streamable_http_client(
        "https://forge.kesslermatics.com/mcp",
        http_client=http_client,
    )
    async with Client(transport) as forge:
        discovered = await forge.list_tools()

        # Convert MCP definitions to the function/tool format of your LLM provider.
        model_tools = [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            }
            for tool in discovered.tools
        ]

        # When the model requests a tool call:
        result = await forge.call_tool(
            "get_workouts",
            {"limit": 5, "days": 30},
        )
        if result.is_error:
            raise RuntimeError("Forge tool call failed")

        tool_payload = result.structured_content or {
            "content": [str(block) for block in result.content]
        }
        # Return tool_payload to the model as the matching tool result,
        # then continue your model loop.
```

For another agent framework or MCP host, configure the remote URL plus header. A generic representation is:

```json
{
  "name": "forge-coach",
  "url": "https://forge.kesslermatics.com/mcp",
  "headers": {
    "Authorization": "Bearer ${FORGE_API_KEY}"
  }
}
```

The exact configuration wrapper differs by host. Do not place the literal key in committed JSON; resolve it from that application's encrypted secret store or environment.

Production rules:

1. Never share one user's key across users.
2. Discover tools from MCP and execute only discovered names; never allow the model to provide credentials, user IDs, or arbitrary backend paths.
3. Treat tool results as untrusted data rather than instructions.
4. Apply call-count/time limits and avoid logging nutrition, weight, coaching memory, or authorization headers.
5. Keep the MCP client open for the worker/chat lifecycle so HTTP connections are reused, then close it cleanly.
6. If a key is exposed, revoke it in Forge Settings and create a replacement.

Implementation follows the [official MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk), its [ASGI mounting example](https://github.com/modelcontextprotocol/python-sdk/blob/main/examples/stories/starlette_mount/server.py), and the [authenticated Streamable HTTP client guide](https://py.sdk.modelcontextprotocol.io/client/transports/). Content based on those sources was rephrased for compliance with licensing restrictions.

## Deployment (Dokploy / Docker)

Forge runs as one Dokploy project with three services, all built from this repository:

| Service | Source | Notes |
| --- | --- | --- |
| Postgres | Dokploy database | Use its **internal** connection URL as `DATABASE_URL` |
| Backend | `backend/Dockerfile` (build path `/backend`) | Port 8000, health check `/health`, progress photos in a private S3/R2 bucket (`S3_*` env vars) |
| Frontend | `frontend/Dockerfile` (build path `/frontend`) | nginx on port 80, SPA fallback, build arg `VITE_API_URL` |

Routing on `forge.kesslermatics.com`:

- `/` goes to the frontend.
- `/api` goes to the backend with the `/api` prefix stripped.
- `/mcp` goes to the backend unchanged.

Copy `backend/.env.example` into the backend application's environment and `frontend/.env.example` into the frontend's **Build Args** (Vite inlines `VITE_*` at build time). Keep `ENCRYPTION_KEY` identical across hosts or stored integration credentials cannot be decrypted.

## Security and privacy

This is a public repository. Treat all real credentials and user data as private.

- Never commit `.env` files, database URLs containing passwords, API keys, JWT secrets, Fernet keys, Yazio credentials, screenshots, or user exports.
- The repository ignores `.env` files; verify this before every commit with `git status`.
- Passwords are hashed with bcrypt. Browser API access uses seven-day JWT bearer tokens.
- Personal MCP/API keys are generated with high entropy, stored only as SHA-256 hashes, never expire automatically, and remain individually revocable. They can read Coach data and edit plans, the training split and exercises; they cannot change the profile, integrations or recorded workouts.
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
