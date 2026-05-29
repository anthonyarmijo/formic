# Desktop Development

`npm run dev:desktop:all` is the canonical local desktop loop for Phase 0.

It starts the Vite/Svelte renderer on `http://127.0.0.1:5173` with a strict port, opens Electron immediately, and lets Electron own the FastAPI backend lifecycle. Electron first checks for an existing backend at `FORMIC_SERVER_URL` or `http://127.0.0.1:8080`; if none is ready and `FORMIC_SERVER_MODE` is `auto`, it starts the local FastAPI sidecar with `uv run --frozen --project . python -m uvicorn`.

Local dev routes generated backend static files to an untracked temp/user-data directory so starting the backend does not rewrite tracked assets under `backend/open_webui/static`.

Useful environment overrides:

- `FORMIC_SERVER_MODE=auto|spawn|external`
- `FORMIC_SERVER_URL=http://127.0.0.1:8080`
- `FORMIC_SERVER_PORT=8080`
- `FORMIC_RENDERER_URL=http://127.0.0.1:5173`
- `FORMIC_SERVER_READY_TIMEOUT_MS=120000`
- `FORMIC_RENDERER_READY_TIMEOUT_MS=120000`
- `FORMIC_PYTHON=/path/to/python`

Electron treats `/health` as the liveness check and `/ready` as the readiness gate before loading the renderer. The renderer gate verifies that the URL responds with the Formic Svelte app shell, not just any process on port `5173`.

Failure states are visible in the Electron window:

- backend failure: the shell could not reach a ready FastAPI backend
- renderer failure: the backend is ready, but Vite did not serve the Formic renderer

`npm run dev:renderer` remains the standalone web renderer loop. It uses the same strict `127.0.0.1:5173` target so Electron and browser-based web development exercise the same renderer endpoint.
