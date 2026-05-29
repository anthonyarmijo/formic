# Desktop Development

`npm run dev:desktop:all` is the canonical local desktop loop for Phase 0.

It starts the Vite/Svelte renderer on `http://127.0.0.1:5173` with a strict port, opens Electron immediately, and lets Electron own the FastAPI backend lifecycle. Electron first checks for an existing backend at `FORMIC_SERVER_URL` or `http://127.0.0.1:8080`; if none is ready and `FORMIC_SERVER_MODE` is `auto`, it starts the local FastAPI sidecar with `uv run --frozen --project . python -m uvicorn`.

Local dev routes generated backend static files to an untracked temp/user-data directory so starting the backend does not rewrite tracked assets under `backend/open_webui/static`.

The Phase 0 packaging direction is still bundled server first: Electron now looks for a future packaged server root at `process.resourcesPath/formic-server`, or an explicit `FORMIC_SERVER_BUNDLE_DIR`, and prefers a `.venv`/`venv` Python in that root before falling back to the repo `uv.lock` path. External/Docker server mode remains the fallback path while bundled packaging is hardened.

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

Electron treats `/health` as the liveness check and `/ready` as the readiness gate before loading the renderer. The renderer gate verifies that the URL responds with the Formic Svelte app shell, not just any process on port `5173`.

Failure states are visible in the Electron window:

- backend failure: the shell could not reach a ready FastAPI backend
- renderer failure: the backend is ready, but Vite did not serve the Formic renderer

Backend failures include the selected sidecar launch plan and recent server output so packaging and local environment failures can be diagnosed from the shell.

`npm run dev:renderer` remains the standalone web renderer loop. It uses the same strict `127.0.0.1:5173` target so Electron and browser-based web development exercise the same renderer endpoint.

## Current Reliability Notes

Works:

- `npm run dev:desktop:all` is the canonical local loop.
- Electron can connect to an already-running backend, spawn the repo backend with `uv`, or wait for an external backend.
- The sidecar launcher can be pointed at a future bundled server root with `FORMIC_SERVER_BUNDLE_DIR`.
- Startup failures now show the launch command, server root, backend path, and recent sidecar output.

Still flaky:

- There is no packaged `.app` recipe yet that copies `backend/`, `uv.lock`, and a prebuilt Python environment into `resources/formic-server`.
- First-run local backend startup can still be slow when dependency/model caches are cold.
- Packaged builds still need signing, notarization, and a final decision on whether the Docker/external fallback becomes user-facing.

Recommended next Phase 0 step: create a tiny packaging rehearsal that builds a disposable `formic-server` directory with `backend/`, `uv.lock`, and `.venv`, then launch Electron with `FORMIC_SERVER_BUNDLE_DIR` against that directory before adding electron-builder packaging.
