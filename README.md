# GridGame-Web-issues

Public issue tracker for **Gridlocked**, the grid strategy game.

This repository is **for bugs, defects, and feedback only**. It does **not** contain application source code.

## Why this repo exists

Gridlocked is developed in **private repositories** (frontend, backend, and infrastructure). We use this public repo so players and contributors can:

- Report bugs and defects they see in the live game
- Suggest improvements without needing access to private code
- Follow the status of known issues (open / closed)

Fixes are implemented in the private codebase and deployed separately. When an issue is resolved, we close it here and may reference the internal change if appropriate.

## How to report a problem

1. Open **[Issues](https://github.com/andyofengland/GridGame-Web-issues/issues)** on this repository.
2. Click **New issue** and choose **Bug report** (or **Feature request** for ideas).
3. Fill in as much detail as you can — see [CONTRIBUTING.md](CONTRIBUTING.md) for tips.

You can also reach the issue tracker from the game site: use **Report a bug** in the footer on any page.

## What to include in a bug report

- What you were trying to do
- What you expected vs what actually happened
- Browser and device (e.g. Chrome on Android, Safari on iPhone)
- Whether you were signed in, playing locally, vs computer, or vs another player
- Screenshots or screen recordings if helpful

Please **do not** post passwords, passkeys, or other secrets. Email addresses in reports are used only to understand the issue.

## Security issues

If you believe you have found a security vulnerability, do **not** open a public issue with exploit details. Describe the impact briefly in a new issue and ask for a private channel, or use GitHub **Private vulnerability reporting** if enabled for this repo. See [SECURITY.md](SECURITY.md).

## Relationship to other repositories

| Repository | Role |
|------------|------|
| **GridGame-Web-issues** (this repo) | Public issue tracking |
| GridGame-Web-frontend (private) | React web client |
| GridGame-Web-backend (private) | API and game logic |
| Workspace / deploy repos (private) | CI/CD and infrastructure |

Issues filed here are triaged and linked to work in the private repos. Closing an issue here usually means a fix has been released or the report was resolved another way.

## License

This repository holds issue descriptions and project metadata only — not game source code. Issue text is contributed by reporters under the terms of their GitHub accounts and this project’s contribution guidelines in [CONTRIBUTING.md](CONTRIBUTING.md).
