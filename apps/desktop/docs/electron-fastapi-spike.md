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

## Bundle Rehearsal

The repeatable packaging rehearsal creates a disposable future server payload:

```sh
npm run desktop:bundle:build
```

Default output: `build/desktop-rehearsal/formic-server`.

The bundle contains:

- `backend/` copied from tracked backend files only.
- `pyproject.toml`, `uv.lock`, and root package/version context.
- a bundle-local `.venv/` created with `uv sync --frozen --no-dev --no-install-project`.
- `bundle-manifest.json` with the source commit, copied backend file count, app version, and Python path.

Run Electron against it with:

```sh
npm run dev:renderer
FORMIC_SERVER_BUNDLE_DIR="$(pwd)/build/desktop-rehearsal/formic-server" npm run dev:desktop
```

Or run the API smoke proof:

```sh
npm run desktop:bundle:smoke
```

The smoke command rebuilds the rehearsal bundle, builds `@formic/desktop`, launches Electron with `FORMIC_SERVER_BUNDLE_DIR`, uses a port-scoped `build/desktop-rehearsal/runtime-data/smoke-<port>` directory for disposable runtime data/static files, confirms Electron chose the `FORMIC_SERVER_BUNDLE_DIR venv` launch plan, then checks `/health`, `/ready`, and `/api/version`.

## Packaged Resources Rehearsal

The next Phase 0 proof packages an unsigned local `.app` directory and places the same server bundle where Electron will look in a packaged app:

```sh
npm run desktop:resources:smoke
```

This builds `build/desktop-rehearsal/formic-server`, packages `build/desktop-rehearsal/packaged-app/mac-arm64/Formic.app`, copies the bundle to `Formic.app/Contents/Resources/formic-server`, launches that `.app` with `FORMIC_SERVER_BUNDLE_DIR` removed, confirms Electron reports the `bundled venv` launch plan from the resources path, then checks `/health`, `/ready`, and `/api/version`.

To create the packaged layout without launching the smoke:

```sh
npm run desktop:resources:package
```

The electron-builder config is `electron-builder.desktop.cjs`. It keeps app code in `app.asar` while copying `formic-server/` as `extraResources`, so Python, backend files, lock/context files, and `.venv/` remain directly executable under `Contents/Resources/formic-server`.

## Decision Notes

- The Electron shell can check for an already-running backend before spawning its own process.
- `FORMIC_SERVER_MODE=auto` checks for an existing backend, then spawns one if needed.
- `FORMIC_SERVER_MODE=spawn` always owns the local FastAPI sidecar.
- `FORMIC_SERVER_MODE=external` only connects to an already-running server and reports failure if it is unhealthy.
- The sidecar path now supports the bundled-venv rehearsal: set `FORMIC_SERVER_BUNDLE_DIR` to a server root containing `backend/`, lock/context files, and `.venv` or `venv`, and Electron will require that bundled Python unless `FORMIC_PYTHON` is explicitly supplied.
- In a packaged app, Electron will also look for that server root at `process.resourcesPath/formic-server`.
- Desktop launches set `FORMIC_DESKTOP=true` and default `FORMIC_LAZY_EMBEDDINGS=true`, deferring local embedding model initialization until first retrieval use.
- Electron shows a startup screen immediately, waits for FastAPI health, then waits for the renderer URL before loading the app.
- Backend failure screens include the selected launch plan and recent sidecar output.
- Bundle-specific failures now catch missing backend entry files, missing lock/context files, or missing `.venv` before launching a process.
- The next Phase 0 decision is the packaging recipe for bundled Python/venv. Docker/server connection mode should stay as the fallback unless the bundled rehearsal proves too brittle.

## Results

- `npm run typecheck --workspace @formic/desktop` passes.
- `npm run build --workspace @formic/desktop` passes.
- Electron spawned cleanly against a mock healthy server and non-HTTP renderer smoke URL.
- The backend command reached `/health` and `/api/version` successfully on port `18080` after fixing Formic changelog heading parsing.
- System `python3` is not viable as the default local launcher on this machine because it is Python 3.14 and has no `uvicorn`; `uv run --frozen --project .` is the working local path.
- First-run backend startup downloaded the default embedding model before binding the port. Desktop packaging should either prebundle/cache that model, disable auto-update for the shell smoke path, or show an explicit startup progress state.
- `npm run desktop:bundle:build` now produces the disposable `formic-server` root under `build/desktop-rehearsal/`.
- `npm run desktop:bundle:smoke` is the concrete proof for this spike: Electron launches the bundle-local `.venv` server and the backend responds on `/health`, `/ready`, and `/api/version`.
- `npm run desktop:resources:smoke` now proves the same API sidecar works from the packaged app resources path with no `FORMIC_SERVER_BUNDLE_DIR`.

## Current Packaging Read

Recommended path: keep pursuing a bundled Python/venv sidecar as the Phase 0 default because the current app shape already needs a local FastAPI process for desktop parity. The rehearsal now proves the smallest useful server payload: a `formic-server` directory with the current `backend/`, dependency lock/context, and a prebuilt `.venv`, launched through `FORMIC_SERVER_BUNDLE_DIR`.

Fallback path: keep `FORMIC_SERVER_MODE=external` for Docker or a user-managed server. Do not make this the primary desktop story unless the bundled-venv rehearsal fails on clean machines.

Remaining blocker for a real packaged `.app`: the local `.venv` relocated into `Contents/Resources/formic-server` on this machine, but this still does not solve codesign/notarization of Python binaries, cross-machine reproducibility, installer layout, updater behavior, or how model/cache data is shipped versus initialized at first run. The next packaging decision should be the signed-app Python artifact strategy before `.dmg` polish.
