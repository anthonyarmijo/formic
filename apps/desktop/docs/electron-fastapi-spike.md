# Electron + FastAPI Spike

Date: May 28, 2026

## Purpose

Prove whether the Phase 0 desktop shell can own the lifecycle of the existing FastAPI backend without a full monorepo migration.

## Current Shape

- The root SvelteKit renderer still runs through `npm run dev` on Vite.
- The FastAPI backend starts from `backend/` with `uvicorn open_webui.main:app`.
- Health checks are available at `/health`, `/ready`, and `/health/db`.
- This spike adds a standalone Electron package at `apps/desktop`.
- The default local backend launcher uses `uv run --frozen --project <repo> python -m uvicorn` when `uv.lock` exists, so the spike does not rewrite the current lockfile.
- The repo now uses npm workspaces for `apps/desktop`; the root `package-lock.json` owns Electron dependencies.

## How To Run

1. Start the renderer separately with `npm run dev:renderer`.
2. Run the desktop shell with `npm run dev:desktop`.
3. Or run both together with `npm run dev:desktop:all`.
4. Optionally set `FORMIC_RENDERER_URL`, `FORMIC_SERVER_URL`, `FORMIC_SERVER_PORT`, `FORMIC_SERVER_MODE`, or `FORMIC_PYTHON`.

## Decision Notes

- The Electron shell can check for an already-running backend before spawning its own process.
- `FORMIC_SERVER_MODE=auto` checks for an existing backend, then spawns one if needed.
- `FORMIC_SERVER_MODE=spawn` always owns the local FastAPI sidecar.
- `FORMIC_SERVER_MODE=external` only connects to an already-running server and reports failure if it is unhealthy.
- The sidecar path is intentionally local-dev only: it uses the repo's `uv` environment or an explicit `FORMIC_PYTHON`, not PyInstaller yet.
- Desktop launches set `FORMIC_DESKTOP=true` and default `FORMIC_LAZY_EMBEDDINGS=true`, deferring local embedding model initialization until first retrieval use.
- Electron shows a startup screen immediately, waits for FastAPI health, then waits for the renderer URL before loading the app.
- The next Phase 0 decision is packaging strategy: either bundle a Python runtime/venv or ship a Docker/server connection fallback while packaging is hardened.

## Results

- `npm run typecheck --workspace @formic/desktop` passes.
- `npm run build --workspace @formic/desktop` passes.
- Electron spawned cleanly against a mock healthy server and `data:` renderer smoke URL.
- The backend command reached `/health` and `/api/version` successfully on port `18080` after fixing Formic changelog heading parsing.
- System `python3` is not viable as the default local launcher on this machine because it is Python 3.14 and has no `uvicorn`; `uv run --frozen --project .` is the working local path.
- First-run backend startup downloaded the default embedding model before binding the port. Desktop packaging should either prebundle/cache that model, disable auto-update for the shell smoke path, or show an explicit startup progress state.
