# Desktop Development

`npm run dev:desktop:all` is the canonical local desktop loop for Phase 0.

It starts the Vite/Svelte renderer on `http://127.0.0.1:5173` with a strict port, opens Electron immediately, and lets Electron own the FastAPI backend lifecycle. Electron first checks for an existing backend at `FORMIC_SERVER_URL` or `http://127.0.0.1:8080`; if none is ready and `FORMIC_SERVER_MODE` is `auto`, it starts the local FastAPI sidecar with `uv run --frozen --project . python -m uvicorn`.

Local dev routes generated backend static files to an untracked temp/user-data directory so starting the backend does not rewrite tracked assets under `backend/open_webui/static`.

The Phase 0 packaging direction is still bundled server first: Electron now looks for a future packaged server root at `process.resourcesPath/formic-server`, or an explicit `FORMIC_SERVER_BUNDLE_DIR`, and requires a `.venv`/`venv` Python in that root. The repo-local path still uses `uv run --frozen --project .` when no bundle root is selected. External/Docker server mode remains the fallback path while bundled packaging is hardened.

Useful environment overrides:

- `FORMIC_SERVER_MODE=auto|spawn|external`
- `FORMIC_SERVER_URL=http://127.0.0.1:8080`
- `FORMIC_SERVER_PORT=8080`
- `FORMIC_RENDERER_URL=http://127.0.0.1:5173`
- `FORMIC_SERVER_READY_TIMEOUT_MS=120000`
- `FORMIC_RENDERER_READY_TIMEOUT_MS=120000`
- `FORMIC_SERVER_BUNDLE_DIR=/path/to/server-root`
- `FORMIC_SERVER_LOG_LINES=24`
- `FORMIC_PYTHON=/path/to/python`

## Bundled Server Rehearsal

The disposable Phase 0 packaging rehearsal builds a future packaged-server root at:

```sh
npm run desktop:bundle:build
```

By default this writes `build/desktop-rehearsal/formic-server`, which is ignored by git through the existing root `build/` ignore rule. The directory is shaped like the server payload Electron will eventually expect under `resources/formic-server`:

- `backend/` copied from tracked backend files only, so unrelated untracked files such as `backend/open_webui/test/` are not swept into the rehearsal.
- `pyproject.toml` and `uv.lock` from the repo root.
- root package/version context such as `package.json`, `CHANGELOG.md`, `README.md`, `LICENSE`, and `hatch_build.py`.
- `.venv/` created in the bundle with `uv sync --frozen --no-dev --no-install-project`.
- `bundle-manifest.json` describing the source commit, copied backend file count, app version, and bundle-local Python path.

To launch Electron against the rehearsal bundle while the renderer is running:

```sh
npm run dev:renderer
FORMIC_SERVER_BUNDLE_DIR="$(pwd)/build/desktop-rehearsal/formic-server" npm run dev:desktop
```

The lightweight smoke proof builds the bundle, builds the Electron main/preload package, starts Electron with an `about:blank` renderer URL, and probes `/health`, `/ready`, and `/api/version` against the sidecar Electron spawned:

```sh
npm run desktop:bundle:smoke
```

Useful overrides:

- `FORMIC_REHEARSAL_BUNDLE_DIR=/path/to/formic-server`
- `FORMIC_REHEARSAL_RUNTIME_DIR=/path/to/runtime-data`
- `FORMIC_REHEARSAL_SERVER_PORT=18081`
- `FORMIC_REHEARSAL_TIMEOUT_MS=240000`
- `npm run desktop:bundle:build -- --clean`

Electron treats `/health` as the liveness check and `/ready` as the readiness gate before loading the renderer. The renderer gate verifies that the URL responds with the Formic Svelte app shell, not just any process on port `5173`.

Failure states are visible in the Electron window:

- backend failure: the shell could not reach a ready FastAPI backend
- renderer failure: the backend is ready, but Vite did not serve the Formic renderer

Backend failures include the selected sidecar launch plan and recent server output so packaging and local environment failures can be diagnosed from the shell.

When `FORMIC_SERVER_BUNDLE_DIR` or the packaged `resources/formic-server` path is selected, Electron now treats the bundle as a real packaged-server root. It requires `backend/open_webui/main.py`, `backend/open_webui/env.py`, `pyproject.toml`, `uv.lock`, `package.json`, `CHANGELOG.md`, and a bundled `.venv` or `venv` Python. Missing files fail before launch with a clear bundle-specific message. The repo-local dev path still uses `uv run --frozen --project .` when no bundle root is selected.

`npm run dev:renderer` remains the standalone web renderer loop. It uses the same strict `127.0.0.1:5173` target so Electron and browser-based web development exercise the same renderer endpoint.

## Current Reliability Notes

Works:

- `npm run dev:desktop:all` is the canonical local loop.
- Electron can connect to an already-running backend, spawn the repo backend with `uv`, or wait for an external backend.
- The sidecar launcher can be pointed at a future bundled server root with `FORMIC_SERVER_BUNDLE_DIR` and now requires a bundle-local Python environment for that path.
- Startup failures now show the launch command, server root, backend path, and recent sidecar output.
- `npm run desktop:bundle:build` creates a repeatable disposable `formic-server` root with backend files, lock/context, and `.venv`.
- `npm run desktop:bundle:smoke` verifies Electron can launch the bundle-local venv server and serve `/health`, `/ready`, and `/api/version`.

Still flaky:

- There is still no packaged `.app` recipe that copies the rehearsed `formic-server` directory into `resources/formic-server`.
- First-run local backend startup can still be slow when dependency/model caches are cold.
- The rehearsal uses the current machine's uv-created `.venv`; a real `.app` must decide how to build, sign, relocate, and update that Python environment per platform.
- The smoke command verifies the API sidecar path with an `about:blank` renderer URL. It does not prove the full packaged renderer, installer, updater, signing, or notarization path.
- Packaged builds still need signing, notarization, and a final decision on whether the Docker/external fallback becomes user-facing.

Recommended next Phase 0 step: add the first electron-builder resources recipe that copies the rehearsed `formic-server` shape into `resources/formic-server`, then run the same smoke checks from the packaged app layout before committing to signed `.dmg` distribution.
