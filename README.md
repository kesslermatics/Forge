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

Browser routes use `Authorization: Bearer <JWT>`. The dedicated read-only Coach-tool route also accepts `X-API-Key: <personal-key>` for MCP adapters. Personal keys can be created and revoked only through a JWT-authenticated profile session. The generated documentation at `/docs` is the authoritative reference for request and response schemas.

| Area | Route group | Purpose |
| --- | --- | --- |
| Authentication | `/auth/register`, `/auth/login` | Account registration and login |
| User settings | `/user/*` | Profile, personal API keys, language, and optional Yazio connection |
| Coach tool API | `POST /api/coach/tools/{tool_name}` | API-key- or JWT-authenticated read-only Coach context |
| Remote MCP | `/mcp` | Bearer-key-authenticated Streamable HTTP tools for external agents |
| Forge | `/api/forge/*` | Exercise library, plans, programs, sessions, AI drafts/chat, and progress photos |
| Coaching | `/api/briefing/*` | Briefings, workout reviews/tips, reports, analysis, and trends |
| Monthly challenges | `/api/challenges/monthly/current`, `/api/challenges/monthly/check-in` | Current cycle, live Forge progress, and daily check-in |
| Health | `/`, `/health` | Service availability |

## Personal API keys and MCP

The Railway FastAPI backend serves the same ten read-only context tools used by the built-in Coach directly over **Streamable HTTP** at:

```text
https://hevy-ai-coach-production.up.railway.app/mcp
```

Available tools cover profile/current Yazio goal, training plans, workouts, exercise history, nutrition, steps/activity, weight history, and saved coaching memory. MCP runs in the same backend process and calls the account-scoped Coach dispatcher directly—there is no second MCP service, subprocess, database credential, or HTTP loopback adapter.

### Create and revoke a key

1. Sign in to Forge and open **Profile & Settings**.
2. Under **API keys & MCP**, enter a descriptive name such as `My agent chat`.
3. Create the key and copy the complete `forge_live_...` value from the one-time dialog.
4. Store it in the secret configuration of the agent application that connects to Forge MCP.

Only a SHA-256 hash and public prefix are stored by Forge. Keys do not expire automatically, but can be revoked immediately from Settings. They authorize only the read-only Coach tools and cannot create keys or mutate profile, workout, or integration data.

MCP clients send the personal key using the standard bearer header:

```http
Authorization: Bearer forge_live_REPLACE_WITH_THE_ONE_TIME_VALUE
```

The browser JWT is a separate credential and is not intended for remote MCP connections.

### Railway configuration

The existing backend start command remains unchanged. `mcp==2.0.1` is installed with `backend/requirements.txt`, and the FastAPI app mounts MCP under `/mcp`.

The current Railway hostname works with the checked-in defaults. For another backend hostname, set:

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
        "https://hevy-ai-coach-production.up.railway.app/mcp",
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
  "url": "https://hevy-ai-coach-production.up.railway.app/mcp",
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

## Security and privacy

This is a public repository. Treat all real credentials and user data as private.

- Never commit `.env` files, database URLs containing passwords, API keys, JWT secrets, Fernet keys, Yazio credentials, screenshots, or user exports.
- The repository ignores `.env` files; verify this before every commit with `git status`.
- Passwords are hashed with bcrypt. Browser API access uses seven-day JWT bearer tokens.
- Personal MCP/API keys are generated with high entropy, stored only as SHA-256 hashes, never expire automatically, and remain individually revocable. They authorize only read-only Coach tools.
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
