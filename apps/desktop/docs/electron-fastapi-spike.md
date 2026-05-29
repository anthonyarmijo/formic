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

The packaged resources rehearsal packages an unsigned local `.app` directory and places the server bundle where Electron will look in a packaged app:

```sh
npm run desktop:resources:smoke
```

This builds `build/desktop-rehearsal/formic-server`, packages `build/desktop-rehearsal/packaged-app/mac-arm64/Formic.app`, copies the bundle to `Formic.app/Contents/Resources/formic-server`, launches that `.app` with `FORMIC_SERVER_BUNDLE_DIR` removed, confirms Electron reports the `bundled venv` launch plan from the resources path, then checks `/health`, `/ready`, and `/api/version`.

To create the packaged layout without launching the smoke:

```sh
npm run desktop:resources:package
npm run desktop:resources:managed-package
```

The electron-builder config is `electron-builder.desktop.cjs`. It keeps app code in `app.asar` while copying `formic-server/` as `extraResources`, so Python, backend files, lock/context files, and either `.venv/` or `python-runtime/` remain directly executable under `Contents/Resources/formic-server`.

The managed packaged-resources proof uses the same unsigned `.app` resources path with `python-runtime/` instead of the copied uv `.venv`:

```sh
npm run desktop:resources:managed-smoke
```

This builds the managed `formic-server`, packages it under `build/desktop-rehearsal/packaged-app/mac-arm64/Formic.app/Contents/Resources/formic-server`, launches the packaged app with `FORMIC_SERVER_BUNDLE_DIR` removed, confirms Electron reports `bundled managed Python runtime`, audits the packaged resources server, then checks `/health`, `/ready`, and `/api/version`.

The copied `.venv` resources command remains as a comparison proof, but the managed resources command is the primary Phase 0 packaging path.

## Python Artifact Audit

The signed-app Python strategy now has a repeatable audit command:

```sh
npm run desktop:bundle:audit
```

It inspects the existing rehearsal `formic-server/.venv` for symlinks, absolute paths, console-script shebangs, executable files, and native `.so`/`.dylib` payloads. On the macOS arm64 rehearsal bundle it reports that `.venv/bin/python` resolves to the local uv-managed CPython under the user home, outside `formic-server`, and that generated console scripts contain absolute shebangs back to the original build path.

A relocation stress command now copies the server bundle to a second path with spaces and launches Electron against that relocated copy:

```sh
npm run desktop:bundle:relocation-smoke -- --clean
```

That smoke passes on this machine and verifies `/health`, `/ready`, and `/api/version`, but the audit explains why the pass is not enough for distribution: the interpreter is still the local uv-managed runtime, not an interpreter shipped inside the `.app`.

## Managed Python Runtime

The smallest self-contained server payload proof now copies uv-managed CPython 3.11 into the bundle and installs the frozen dependencies directly into that copied runtime:

```sh
npm run desktop:bundle:managed-smoke -- --clean
```

The managed bundle removes `.venv`/`venv`, writes `python-runtime/`, exports the lockfile to `requirements.lock.txt`, installs with `uv pip install --system --break-system-packages --link-mode copy`, and launches Electron against `python-runtime/bin/python3.11`.

Current result: Electron reports `FORMIC_SERVER_BUNDLE_DIR managed Python runtime`, the selected Python resolves inside `formic-server`, and `/health`, `/ready`, and `/api/version` pass. This makes managed-runtime the Phase 0 packaging strategy to keep proving. Remaining signing risks are the large runtime/dependency payload, hundreds of native libraries, and generated console scripts with absolute shebangs; the sidecar launch itself avoids those scripts by using `python -m uvicorn`.

The managed runtime now also passes from the unsigned packaged `.app` resources path. Electron reports `bundled managed Python runtime` with no `FORMIC_SERVER_BUNDLE_DIR`, and `/health`, `/ready`, and `/api/version` pass from the sidecar under `Contents/Resources/formic-server`.

## Local Signing Check

A local-only recursive ad-hoc signing check is available for the managed packaged app:

```sh
npm run desktop:resources:managed-adhoc-sign-check
```

It packages the managed runtime under `Contents/Resources/formic-server`, audits the packaged Python artifact, runs `codesign --force --deep --sign -`, and verifies with `codesign --verify --deep --strict`. This is not Developer ID signing, is not notarization, and does not prove Gatekeeper acceptance.

## Developer ID Signing Rehearsal

The signing preflight is credential-optional:

```sh
npm run desktop:resources:managed-signing-preflight
```

It packages the managed runtime under `Contents/Resources/formic-server`, runs the artifact audit, inventories the Python runtime Mach-O files, reports currently unsigned/signable files, and prints the intended signing order.

The Developer ID dry run is credential-gated:

```sh
FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" npm run desktop:resources:managed-developer-id-sign-check
```

`CSC_NAME` is accepted as a fallback identity variable. This command enables hardened runtime through `FORMIC_ELECTRON_BUILDER_SIGNING_MODE=developer-id`, uses the tracked minimal entitlements, and lets electron-builder sign Electron-managed app/framework files while ignoring `Contents/Resources/formic-server`. The rehearsal script signs only discovered Python runtime Mach-O files deepest-first, re-signs the outer `.app`, verifies with `codesign --verify --deep --strict --verbose=4`, runs diagnostic-only `spctl --assess --type execute --verbose=4`, then launches the signed app with no `FORMIC_SERVER_BUNDLE_DIR` and verifies `/health`, `/ready`, and `/api/version`.

Non-Mach-O Python sidecar resources such as compressed datasets and JSON fixtures are intentionally excluded from signing.

If no Developer ID Application identity is configured, the command runs preflight and fails with setup instructions. It does not fall back to ad-hoc signing and does not attempt notarization.

## Decision Notes

- The Electron shell can check for an already-running backend before spawning its own process.
- `FORMIC_SERVER_MODE=auto` checks for an existing backend, then spawns one if needed.
- `FORMIC_SERVER_MODE=spawn` always owns the local FastAPI sidecar.
- `FORMIC_SERVER_MODE=external` only connects to an already-running server and reports failure if it is unhealthy.
- The sidecar path now supports bundled Python rehearsals: set `FORMIC_SERVER_BUNDLE_DIR` to a server root containing `backend/`, lock/context files, and `.venv`, `venv`, or `python-runtime/`, and Electron will require that bundled Python unless `FORMIC_PYTHON` is explicitly supplied.
- In a packaged app, Electron will also look for that server root at `process.resourcesPath/formic-server`.
- Desktop launches set `FORMIC_DESKTOP=true` and default `FORMIC_LAZY_EMBEDDINGS=true`, deferring local embedding model initialization until first retrieval use.
- Electron shows a startup screen immediately, waits for FastAPI health, then waits for the renderer URL before loading the app.
- Backend failure screens include the selected launch plan and recent sidecar output.
- Bundle-specific failures now catch missing backend entry files, missing lock/context files, or missing bundled Python before launching a process.
- The next Phase 0 decision is the production signing recipe for bundled managed Python. Docker/server connection mode should stay as the fallback unless the bundled rehearsal proves too brittle.

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
- `npm run desktop:bundle:audit` now reports the copied `.venv` as a local rehearsal artifact, not a shippable Python payload: Python resolves outside the bundle, console scripts contain absolute build-path shebangs, and hundreds of native libraries remain to be signed.
- `npm run desktop:bundle:relocation-smoke -- --clean` now proves launcher path handling from a copied bundle path with spaces.
- `npm run desktop:bundle:managed-smoke -- --clean` now proves Electron can launch the API sidecar from an in-bundle managed `python-runtime/` with no `.venv` or user-home Python symlink.
- `npm run desktop:resources:managed-smoke` now proves the managed `python-runtime/` sidecar works from `Formic.app/Contents/Resources/formic-server` with no `FORMIC_SERVER_BUNDLE_DIR`.
- `npm run desktop:resources:managed-adhoc-sign-check` now proves the managed packaged resources layout can be recursively ad-hoc signed and verified locally; this does not replace Developer ID signing or notarization.
- `npm run desktop:resources:managed-signing-preflight` now inventories the managed packaged app's Python Mach-O payload and intended signing order without Apple credentials.
- `npm run desktop:resources:managed-developer-id-sign-check` now provides the credential-gated Developer ID hardened-runtime signing dry run; it still does not notarize or staple.

## Current Packaging Read

Recommended path: keep pursuing a bundled Python sidecar as the Phase 0 default because the current app shape already needs a local FastAPI process for desktop parity. Keep the `formic-server` layout and Electron launcher, and use the managed `python-runtime/` payload as the primary artifact strategy instead of a raw copied uv-created `.venv`. The copied `.venv` can be retired from the primary packaging path and kept only as a comparison/regression rehearsal.

Fallback path: keep `FORMIC_SERVER_MODE=external` for Docker or a user-managed server. Do not make this the primary desktop story unless the bundled-venv rehearsal fails on clean machines.

Remaining blocker for a distributable packaged `.app`: run the Developer ID dry run with real credentials, then upload the signed artifact to Apple's notary service, inspect the notary log, staple the ticket, and repeat Gatekeeper assessment. PyInstaller remains a fallback experiment if the managed-runtime payload cannot be made small or reproducible enough.
