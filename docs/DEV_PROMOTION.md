# Dev branch, staging, and Cursor agents

Public-tracker summary. The full contract, including local Compose, lives in sibling repo `GridGame-Web-Across` (`docs/DEV_PROMOTION.md`). Agents work **one git repo at a time**.

## Promotion path

```
public issue + ready-for-dev
        ↓
this repo’s “Launch Cursor agent” Action
        ↓
PR into code-repo `dev`  →  CI tests
        ↓
merge to `dev`  →  staging (gridgame-dev) when STAGING_ENABLED=true
        ↓
human PR `dev` → `main`  →  production
```

| | Production | Staging |
|---|---|---|
| Git branch that deploys | `main` | `dev` |
| `SHARED_RESOURCE_ID` | `gridgame-prod` | `gridgame-dev` |
| GitHub Environment | none on the prod job (OIDC stays `ref:refs/heads/main`) | `STAGING_*` repo vars/secrets (`ref:refs/heads/dev`) |
| Frontend | `www.gridlocked.me` | `dev.gridlocked.me` |
| API | current API hostname | `api-dev.gridlocked.me` |

Do **not** set staging `AUTH_COOKIE_DOMAIN` to `.gridlocked.me`. Use a **different** `JWT_SECRET` and DynamoDB tables.

## Labels

| Label | Meaning |
|---|---|
| `ready-for-dev` | Maintainer triaged; Cursor may run |
| `area:frontend` / `area:backend` / `area:ios` | Target repo(s) |
| `cross-repo` | Backend first, then `ready-for-frontend` |
| `ready-for-frontend` | Start the frontend agent |
| `agent:blocked` | Launcher or agent failed |
| `in-dev` | Agent launch succeeded (auto) |
| `in-review` | Linked PR open in FE/BE (auto) |
| `shipped` | Linked PR merged to `main` (auto; issue closed) |

Label sync needs secret **`ISSUES_TOKEN`** on the **frontend and backend** repos (same token the API uses to file issues), with `issues:write` on this tracker. The PR title or body must include `andyofengland/GridGame-Web-issues#N`.

In-game feedback does not set `area:*`. Add those labels yourself.

`area:ios` is human-gated (no Cursor launch).

## Cross-repo + dual promote

1. `area:backend` + `area:frontend` + `cross-repo` + `ready-for-dev`
2. Backend PR against `dev`
3. Add `ready-for-frontend`
4. Merge both to `dev`, smoke staging
5. Same-day `dev` → `main` on **both** web repos

Checklist: backend `dev` merged → frontend `dev` merged → staging smoke (health, sign-in, one game) → `dev`→`main` both repos → prod smoke (`shipped` + close is automatic when a linked PR merges to `main`).

## Secrets

- **`CURSOR_API_KEY`** on this issues repo (Cursor Dashboard → Integrations)
- Staging GitHub `STAGING_*` hostname overrides are optional; deploys request ACM and reuse the prod Route 53 zone
- Staging stays off until each web repo has **`STAGING_ENABLED=true`**
