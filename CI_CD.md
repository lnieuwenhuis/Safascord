# CI/CD and Quality Automation

## Repo Audit Summary

- Branch flow in the current repo is `dev -> staging -> master`, while the requested production branch name is `main`.
- The automation added here supports `staging`, `main`, and `master` so the repo keeps working if you rename the default branch or continue using `master`.
- Frontend: React 19 + Vite + TypeScript in `frontend/`
- Backend: Fastify + TypeScript in `backend/`
- Realtime: `ws` + Redis + TypeScript in `realtime/`
- Deployment: Railway remains the deploy orchestrator through its existing GitHub branch integration.

## What Was Added

- `CI` workflow for every push and pull request on every branch
- Qodo app-based AI review configured at the repo level
- `Deploy Verify` workflow that runs after successful CI on `staging`, `main`, and `master`
- Coverage-producing test suites in `frontend`, `backend`, and `realtime`
- Root `package.json` scripts so contributors can run the same checks locally

## Local Commands

Install dependencies:

```bash
npm run install:all
```

Run the same checks as CI:

```bash
npm run ci
```

Run individual service checks:

```bash
npm --prefix frontend run test:coverage
npm --prefix backend run test:coverage
npm --prefix realtime run test:coverage
```

## GitHub Secrets

No GitHub secret is required for AI review in this repo-level setup.

- Qodo is assumed to be installed and configured at the GitHub app/org level, which matches your current setup.
- Repo-specific review behavior is controlled through [/.pr_agent.toml](/Users/larsnieuwenhuis/Documents/GitHub/Safascord/.pr_agent.toml).

Not required for deploys:

- Railway deploys are intentionally still triggered by Railway’s existing GitHub integration
- No Railway secret was added to Actions because that would duplicate or replace your current working deploy path

## GitHub Repository Variables

Set these to enable post-deploy smoke checks:

- `STAGING_FRONTEND_URL`
- `STAGING_API_URL`
- `STAGING_REALTIME_URL`
- `PRODUCTION_FRONTEND_URL`
- `PRODUCTION_API_URL`
- `PRODUCTION_REALTIME_URL`

If they are not set, `Deploy Verify` exits cleanly and Railway deployment behavior is unchanged.

## Branch Protection Recommendations

Apply to `staging`, `main`, and `master` as relevant:

- require pull requests before merging
- require branches to be up to date before merging
- require these status checks:
  - `Workflow Lint`
  - `Frontend`
  - `Backend`
  - `Realtime`
- disallow force pushes
- disallow branch deletion
- require at least 1 human approval

Optional:

- require the Qodo GitHub app check if your org exposes one and you want it enforced in branch protection

## Workflow Behavior

### CI

`CI` runs on all pushes and all pull requests. It:

- lints GitHub workflow files with `actionlint`
- installs dependencies with npm caching
- runs frontend lint, frontend tests with coverage, and frontend build verification
- runs backend tests with coverage and backend build verification
- runs realtime tests with coverage and realtime build verification
- uploads coverage artifacts for each service

### AI Review

Qodo now owns automated PR review for this repository through the installed GitHub app.

- There is no GitHub Actions workflow for AI review anymore.
- Repo-specific instructions live in [/.pr_agent.toml](/Users/larsnieuwenhuis/Documents/GitHub/Safascord/.pr_agent.toml).
- This avoids duplicating PR comments from both Qodo and a separate Actions-based reviewer.

### Deploy Verify

`Deploy Verify` runs only after the `CI` workflow finishes successfully for a push to `staging`, `main`, or `master`.

- It does not trigger or replace deployment.
- It waits for Railway to finish rolling out and then polls the configured frontend, API, and realtime health endpoints.
- This preserves the current Railway branch deployment behavior while adding post-deploy confidence.

## Why Qodo Configuration Lives In Repo

Qodo’s GitHub-native review flow is app-based rather than a standard GitHub Actions workflow. That means the practical repo-side work is:

- keep Qodo installed at the org/repo level
- store review guidance in [/.pr_agent.toml](/Users/larsnieuwenhuis/Documents/GitHub/Safascord/.pr_agent.toml)
- avoid a second AI reviewer workflow that would duplicate comments
