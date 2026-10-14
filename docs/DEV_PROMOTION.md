# Dev branch, staging, and Cursor agents

Public-tracker summary. The full contract, including local Compose, lives in sibling repo `GridGame-Web-Across` (`docs/DEV_PROMOTION.md`). Agents work **one git repo at a time**.

## Promotion path

```
public issue + ready-for-dev
        ↓
matching issue in each tagged code repo
        ↓
PR into code-repo `dev`  →  CI tests  →  squash-merge into `dev`
        ↓
staging (gridgame-dev) when STAGING_ENABLED=true
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
| `ready-for-dev` | Maintainer triaged; pickup creates repo issues and may launch agents |
| `area:frontend` / `area:backend` / `area:ios` | Target repo(s). One ticket can carry more than one. |
| `cross-repo` | Backend first, then `ready-for-frontend` |
| `ready-for-frontend` | Start the frontend agent |
| `agent:blocked` | Launcher or agent failed |
| `in-dev` | Agent launch succeeded (auto) |
| `in-review` | A linked PR is open (auto). Cleared once every web area is on `dev`. |
| `on-dev:frontend` / `on-dev:backend` | That repo's PR was squash-merged to `dev` (auto). The public ticket stays open. |
| `shipped:frontend` / `shipped:backend` / `shipped:ios` | That repo's change was merged to `main` (auto) |
| `shipped` | Every tagged area is on `main` (auto; issue closed) |

Pickup (`ready-for-dev`) opens one issue in each tagged code repo. The body is a rewritten scope for that repo, plus `Tracker: andyofengland/GridGame-Web-issues#N`. `area:ios` gets the issue and stays human-gated: no Cursor agent.

Label sync needs secret **`ISSUES_TOKEN`** on the **frontend, backend, and iOS** repos, with `issues:write` on this tracker. The PR title, body, or iOS commit message must include `andyofengland/GridGame-Web-issues#N`.

In-game feedback does not set `area:*`. Add those labels yourself.

## Cross-repo + dual promote

1. `area:backend` + `area:frontend` + `cross-repo` + `ready-for-dev`
2. Pickup opens a backend issue and a frontend issue. The backend agent opens a PR against `dev`. CI squash-merges it after the checks pass.
3. Add `ready-for-frontend`
4. The frontend agent opens its PR. CI squash-merges that into `dev` too. Smoke staging.
5. Same-day human `dev` → `main` on **both** web repos. The public ticket closes only after both are on `main`.

Checklist: backend `dev` merged → frontend `dev` merged → staging smoke (health, sign-in, one game) → human `dev`→`main` both repos → prod smoke. `shipped` and close happen when every `area:*` has a matching `shipped:*` label.

`dev` branch protection must let GitHub Actions squash-merge without a required review. Pull requests into `main` stay manual. The squash-merge workflow runs only after its file is on the default branch `main`.

## Secrets

- **`CURSOR_API_KEY`** on this issues repo (Cursor Dashboard → Integrations)
- **`CODE_REPOS_TOKEN`** on this issues repo: a fine-grained PAT with Issues read and write on the frontend, backend, and iOS repos. Pickup cannot create the repository issues without it.
- Staging GitHub `STAGING_*` hostname overrides are optional; deploys request ACM and reuse the prod Route 53 zone
- Staging stays off until each web repo has **`STAGING_ENABLED=true`**
