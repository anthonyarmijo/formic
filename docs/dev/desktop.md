# Desktop Development

`npm run dev:desktop:all` is the canonical local desktop loop for Phase 0.

It starts the Vite/Svelte renderer on `http://127.0.0.1:5173` with a strict port, opens Electron immediately, and lets Electron own the FastAPI backend lifecycle. Electron first checks for an existing backend at `FORMIC_SERVER_URL` or `http://127.0.0.1:8080`; if none is ready and `FORMIC_SERVER_MODE` is `auto`, it starts the local FastAPI sidecar with `uv run --frozen --project . python -m uvicorn`.

Local dev routes generated backend static files to an untracked temp/user-data directory so starting the backend does not rewrite tracked assets under `backend/open_webui/static`.

The Phase 0 packaging direction is still bundled server first: Electron now looks for a future packaged server root at `process.resourcesPath/formic-server`, or an explicit `FORMIC_SERVER_BUNDLE_DIR`, and requires a bundled `.venv`/`venv` Python or managed `python-runtime/` in that root. The repo-local path still uses `uv run --frozen --project .` when no bundle root is selected. External/Docker server mode remains the fallback path while bundled packaging is hardened.

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

When `FORMIC_SERVER_BUNDLE_DIR` or the packaged `resources/formic-server` path is selected, Electron now treats the bundle as a real packaged-server root. It requires `backend/open_webui/main.py`, `backend/open_webui/env.py`, `pyproject.toml`, `uv.lock`, `package.json`, `CHANGELOG.md`, and a bundled `.venv`, `venv`, or `python-runtime/` Python. Missing files fail before launch with a clear bundle-specific message. The repo-local dev path still uses `uv run --frozen --project .` when no bundle root is selected.

`npm run dev:renderer` remains the standalone web renderer loop. It uses the same strict `127.0.0.1:5173` target so Electron and browser-based web development exercise the same renderer endpoint.

## Packaged Resources Rehearsal

The packaged-app resources rehearsal builds on the same `formic-server` shape, then asks electron-builder to create an unsigned local `.app` directory with that server copied outside `app.asar`:

```sh
npm run desktop:resources:smoke
```

The command:

- builds or refreshes `build/desktop-rehearsal/formic-server`.
- builds `@formic/desktop`.
- packages an unsigned directory target at `build/desktop-rehearsal/packaged-app/mac-arm64/Formic.app`.
- copies the server payload to `Formic.app/Contents/Resources/formic-server`.
- launches the packaged app without `FORMIC_SERVER_BUNDLE_DIR`.
- verifies Electron selects `process.resourcesPath/formic-server`, starts its `.venv` Python, and serves `/health`, `/ready`, and `/api/version`.

To only create the local packaged layout without launching it:

```sh
npm run desktop:resources:package
```

Useful overrides:

- `FORMIC_REHEARSAL_PACKAGE_DIR=/path/to/packaged-output`
- `FORMIC_REHEARSAL_BUNDLE_DIR=/path/to/formic-server`
- `FORMIC_REHEARSAL_SERVER_PORT=18081`
- `FORMIC_REHEARSAL_TIMEOUT_MS=240000`

The electron-builder config for this rehearsal is `electron-builder.desktop.cjs`. It keeps the Electron app code in `app.asar`, but stages Python, backend files, lock/context files, and `.venv/` as explicit `extraResources` under `resources/formic-server`, where the sidecar launcher can execute them directly.

The managed packaged-resources proof uses the same unsigned `.app` layout, but packages `python-runtime/` instead of the copied uv `.venv`:

```sh
npm run desktop:resources:managed-smoke
```

The command builds a managed `build/desktop-rehearsal/formic-server`, packages it to `build/desktop-rehearsal/packaged-app/mac-arm64/Formic.app/Contents/Resources/formic-server`, deletes `FORMIC_SERVER_BUNDLE_DIR` from the launched app environment, verifies Electron reports `bundled managed Python runtime`, audits the packaged resources server, and probes `/health`, `/ready`, and `/api/version`.

To create the managed packaged layout without launching it:

```sh
npm run desktop:resources:managed-package
```

The primary Phase 0 packaging path should now use this managed resources rehearsal rather than the copied `.venv` rehearsal. The `.venv` resources command remains useful as a regression comparison, but its audit findings mean it should not be the shippable Python artifact.

## Local Signing Check

A local-only recursive ad-hoc signing check is available for the managed packaged resources layout:

```sh
npm run desktop:resources:managed-adhoc-sign-check
```

This command packages the managed runtime under `Contents/Resources/formic-server`, audits the packaged Python artifact, runs `codesign --force --deep --sign -` on the local `.app`, and verifies it with `codesign --verify --deep --strict`. It is only a local packaging sanity check. It is not Developer ID signing, does not notarize the app, and does not prove Gatekeeper acceptance.

## Developer ID Signing Rehearsal

The credential-optional signing preflight packages the managed runtime and inventories the Python Mach-O payload without requiring Apple credentials:

```sh
npm run desktop:resources:managed-signing-preflight
```

The preflight packages `python-runtime/` under `Contents/Resources/formic-server`, runs the existing artifact audit, reports sidecar size/native payload counts, checks which Mach-O files are currently unsigned, and prints the intended signing order. It does not sign, notarize, staple, or read notarization credentials.

When a local Developer ID Application certificate and private key are available, run:

```sh
FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" npm run desktop:resources:managed-developer-id-sign-check
```

`CSC_NAME` is accepted as a fallback identity variable. If neither variable is set and exactly one local Developer ID Application identity is available, the rehearsal auto-selects it; if there are none or multiple, it fails with setup instructions. The command packages the managed app with `FORMIC_ELECTRON_BUILDER_SIGNING_MODE=developer-id`, enables hardened runtime, and uses the tracked minimal Electron entitlements. electron-builder signs Electron-managed app/framework files while ignoring `Contents/Resources/formic-server`; the rehearsal script then signs only discovered Python runtime Mach-O files deepest-first, re-signs the outer `.app`, verifies with `codesign --verify --deep --strict --verbose=4`, runs `spctl --assess --type execute --verbose=4` as diagnostic-only, launches the signed app with no `FORMIC_SERVER_BUNDLE_DIR`, and verifies the code signature again after the launch smoke.

The Python sidecar contains many data files, archives, and test fixtures. Those non-Mach-O files must not be signed; only Mach-O executables/libraries from the inventory are sent to `codesign`.

If no Developer ID identity is configured, the Developer ID command intentionally runs the preflight and then fails with setup instructions. It never falls back to ad-hoc signing. This checkpoint still does not notarize, staple, create a DMG, or prove Gatekeeper acceptance.

The packaged sidecar is launched with `PYTHONDONTWRITEBYTECODE=1` by default so Python does not create or update `__pycache__` files inside the signed `.app` resources tree. The signing and notarization rehearsals re-run `codesign --verify --deep --strict --verbose=4` after the smoke launch to catch any mutation that would invalidate the bundle signature.

## Notarization and Stapling Rehearsal

The managed notarization dry run starts from the same Developer ID signed `.app`, then submits a zipped `.app` artifact to Apple's notary service:

```sh
FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" \
APPLE_ID="developer@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="TEAMID1234" \
npm run desktop:resources:managed-notarization-check
```

App Store Connect API key credentials are also accepted:

```sh
FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" \
APPLE_API_KEY="/path/to/AuthKey_ABC123DEFG.p8" \
APPLE_API_KEY_ID="ABC123DEFG" \
APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000" \
npm run desktop:resources:managed-notarization-check
```

The dry run can also use a stored `notarytool` keychain profile:

```sh
xcrun notarytool store-credentials formic-notary

FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" \
APPLE_NOTARY_KEYCHAIN_PROFILE="formic-notary" \
npm run desktop:resources:managed-notarization-check
```

`NOTARYTOOL_KEYCHAIN_PROFILE` and `APPLE_NOTARY_PROFILE` are accepted aliases for the profile name.

The command keeps all output under `build/desktop-rehearsal`. electron-builder notarization is explicitly disabled for this rehearsal so the script owns the notarization sequence. It packages the managed `.app`, signs it with Developer ID and hardened runtime, verifies `codesign --verify --deep --strict --verbose=4`, creates `build/desktop-rehearsal/notarization/Formic-notarization.zip` with `ditto --keepParent`, runs `xcrun notarytool submit --wait`, staples the accepted ticket to the `.app`, validates the staple, requires `spctl --assess --type execute --verbose=4` to pass, launches the stapled app with no `FORMIC_SERVER_BUNDLE_DIR` while probing `/health`, `/ready`, and `/api/version`, then verifies the code signature again after launch.

If notarization credentials are missing, incomplete, or rejected by `notarytool`, the command fails before packaging with setup instructions. The preflight and Developer ID signing-only commands do not read or require notarization credentials.

## DMG Distribution Rehearsal

The managed DMG distribution rehearsal starts from the same signed, notarized, and stapled managed `.app`, then proves a plain user-facing DMG preserves the app seal and bundled runtime:

```sh
APPLE_NOTARY_KEYCHAIN_PROFILE=formic-notary npm run desktop:resources:managed-dmg-check
```

The command keeps all output under `build/desktop-rehearsal`. It repeats the Developer ID signing and notarization/stapling sequence, builds and bundles the Svelte static renderer under `Contents/Resources/formic-server/build`, launches the stapled source app with no `FORMIC_SERVER_BUNDLE_DIR`, creates `build/desktop-rehearsal/dmg/Formic-managed-notarized.dmg`, mounts the DMG read-only, verifies the mounted app with `codesign --verify --deep --strict --verbose=4` and `spctl --assess --type execute --verbose=4`, launches the mounted app with Electron-owned writable backend directories and the packaged renderer loaded from the bundled FastAPI server, copies the mounted app back out with `ditto`, verifies the copied app with the same `codesign` and `spctl` checks, launches the copied app with no `FORMIC_SERVER_BUNDLE_DIR`, confirms Electron reports `bundled managed Python runtime`, probes `/health`, `/ready`, and `/api/version`, verifies codesigning again after launch, and unmounts the DMG in cleanup.

This is intentionally a distribution-container proof only. It does not add DMG window polish, `.pkg` work, updater work, or Phase 1 product/runtime changes.

### Phase 0 Release-Readiness Checkpoint

The managed notarization/stapling and DMG distribution paths have been proven with the stored keychain-profile credential path:

```sh
APPLE_NOTARY_KEYCHAIN_PROFILE=formic-notary npm run desktop:resources:managed-notarization-check
APPLE_NOTARY_KEYCHAIN_PROFILE=formic-notary npm run desktop:resources:managed-dmg-check
```

Successful evidence captured from the May 31, 2026 restored-profile runs:

- The latest notary artifact was `build/desktop-rehearsal/notarization/Formic-notarization.zip`, a zipped `.app` made with `ditto --keepParent`; observed size was about 717.8 MB (`752632727` bytes).
- `xcrun notarytool submit --wait` returned `Accepted` for the latest DMG rehearsal submission `eef5db46-6df0-4710-b5cc-ff5d6c6be5d1`.
- `xcrun stapler staple -v` and `xcrun stapler validate -v` passed on `build/desktop-rehearsal/packaged-app/mac-arm64/Formic.app`.
- `spctl --assess --type execute --verbose=4` accepted the stapled app with `source=Notarized Developer ID`.
- The stapled app launched the sidecar from `Formic.app/Contents/Resources/formic-server/python-runtime` and Electron reported `bundled managed Python runtime`.
- The stapled-app API smoke passed `/health`, `/ready`, and `/api/version=0.9.5`.
- The DMG artifact was `build/desktop-rehearsal/dmg/Formic-managed-notarized.dmg`; observed size was about 965.1 MB (`1011936438` bytes).
- The mounted DMG app and the copied-out DMG app both passed `codesign --verify --deep --strict --verbose=4`.
- The mounted DMG app and the copied-out DMG app both passed `spctl --assess --type execute --verbose=4` with `source=Notarized Developer ID`.
- The mounted DMG app launched with the packaged renderer from the bundled FastAPI server; the copied-out DMG app launched the sidecar from `build/desktop-rehearsal/dmg/extracted/Formic.app/Contents/Resources/formic-server/python-runtime`, Electron reported `bundled managed Python runtime`, and the API smoke passed `/health`, `/ready`, and `/api/version=0.9.5`.

The API-only rehearsal uses `FORMIC_RENDERER_URL=about:blank` to keep the smoke scoped to the backend sidecar. Electron now treats that URL as an explicit renderer-load skip after backend readiness, so a successful API-only smoke is distinct from a full renderer smoke and no longer emits `Renderer startup failed: ERR_FAILED (-2) loading 'about:blank'` during intentional teardown. The rehearsal fails if future output includes a renderer startup failure or unhandled promise rejection.

The local `formic-notary` profile was restored after an earlier keychain-profile miss, and the command above now repeats live notarization successfully. The rehearsal checks `notarytool history` before packaging so missing, incomplete, or rejected local credentials fail fast before the large managed runtime is rebuilt.

Good enough for Phase 0 now means the managed `.app` and plain DMG can be rebuilt, notarized, stapled, Gatekeeper-assessed, launched from the mounted DMG with the packaged renderer, copied out of the mounted DMG, launched with the bundled managed Python runtime, and smoke-tested against `/health`, `/ready`, and `/api/version`. Visual DMG polish, `.pkg` packaging, updater work, and managed-runtime pruning are deferred unless a release consumer or distribution channel makes one of them a blocker. The next desktop work should move back to app features rather than expand packaging scope.

## Python Artifact Audit

The signed-app Python decision is now captured by a repeatable, non-destructive audit against the existing rehearsal bundle:

```sh
npm run desktop:bundle:audit
```

The audit validates the bundle shape, walks `.venv/`, and reports size, symlinks, absolute text references, console-script shebangs, executable files, and native `.so`/`.dylib` payloads that will matter for relocation and Developer ID signing. It does not mutate files or attempt signing/notarization.

Current result on the macOS arm64 rehearsal bundle:

- `.venv/bin/python` resolves outside the bundle to the uv-managed CPython under the local user home.
- The copied `.venv` contains absolute console-script shebangs back to the original build path.
- The venv is roughly 1.3-1.5 GB and contains hundreds of native extension/library files that will need recursive signing in a real `.app`.
- The API sidecar still works because Electron launches `python -m uvicorn` and this machine has the external uv-managed interpreter available.

That means the copied uv-created `.venv` is useful as a Phase 0 rehearsal input, but it is not by itself a shippable signed Python artifact.

A relocation stress rehearsal exercises the same bundle from a second path containing spaces:

```sh
npm run desktop:bundle:relocation-smoke -- --clean
```

The command builds the server bundle, copies it under `build/desktop-rehearsal/relocation path with spaces/formic-server`, audits the relocated copy, launches Electron with that relocated `FORMIC_SERVER_BUNDLE_DIR`, and verifies `/health`, `/ready`, and `/api/version`. Passing this test proves the current launcher path handling is sound on this machine; it does not prove the copied `.venv` will run on a clean Mac because the Python executable still resolves outside the bundle.

## Managed Python Runtime Rehearsal

The next Phase 0 artifact proof creates a self-contained server bundle without a copied `.venv`:

```sh
npm run desktop:bundle:managed-smoke -- --clean
```

The managed-runtime rehearsal:

- copies the resolved uv-managed CPython 3.11 install into `build/desktop-rehearsal/formic-server/python-runtime`.
- exports the frozen lockfile to `requirements.lock.txt`.
- installs locked dependencies into that copied runtime with `uv pip install --system --break-system-packages --link-mode copy`.
- removes `.venv`/`venv` so Electron must launch `python-runtime/bin/python3.11`.
- audits the runtime and verifies `/health`, `/ready`, and `/api/version`.

Current result on macOS arm64: Electron launches both `FORMIC_SERVER_BUNDLE_DIR managed Python runtime` from the loose bundle and `bundled managed Python runtime` from the packaged `.app` resources path. In both cases `python-runtime/bin/python3.11` resolves inside `formic-server`. This proves the sidecar no longer depends on a user-home uv Python symlink. The remaining risks are size, hundreds of native `.so`/`.dylib` files that need recursive signing, and generated console scripts with absolute shebangs. Electron does not use those console scripts for the sidecar path because it launches `python -m uvicorn` directly.

## Current Reliability Notes

Works:

- `npm run dev:desktop:all` is the canonical local loop.
- Electron can connect to an already-running backend, spawn the repo backend with `uv`, or wait for an external backend.
- The sidecar launcher can be pointed at a future bundled server root with `FORMIC_SERVER_BUNDLE_DIR` and now requires a bundle-local Python environment for that path.
- Startup failures now show the launch command, server root, backend path, and recent sidecar output.
- `npm run desktop:bundle:build` creates a repeatable disposable `formic-server` root with backend files, lock/context, and `.venv`.
- `npm run desktop:bundle:smoke` verifies Electron can launch the bundle-local venv server and serve `/health`, `/ready`, and `/api/version`.
- `npm run desktop:resources:smoke` verifies the unsigned packaged `.app` launches from `Contents/Resources/formic-server` with no `FORMIC_SERVER_BUNDLE_DIR`.
- `npm run desktop:bundle:audit` makes `.venv` relocation/signing risks visible without mutating the rehearsal output.
- `npm run desktop:bundle:relocation-smoke -- --clean` verifies Electron can launch the sidecar from a copied bundle path with spaces.
- `npm run desktop:bundle:managed-smoke -- --clean` proves a self-contained `python-runtime/` server artifact can launch the FastAPI sidecar without a `.venv` or user-home Python symlink.
- `npm run desktop:resources:managed-smoke` proves the same managed artifact works from `Formic.app/Contents/Resources/formic-server` with no `FORMIC_SERVER_BUNDLE_DIR`.
- `npm run desktop:resources:managed-adhoc-sign-check` proves this local unsigned rehearsal layout can be ad-hoc signed and verified with recursive `codesign --deep`; this does not change the Developer ID/notarization requirement.
- `npm run desktop:resources:managed-signing-preflight` inventories the managed packaged app's Python Mach-O payload and intended signing order without Apple credentials.
- `npm run desktop:resources:managed-developer-id-sign-check` is the credential-gated hardened-runtime signing dry run; it still does not notarize or staple.
- `npm run desktop:resources:managed-notarization-check` is the credential-gated notarization/stapling dry run for the signed managed `.app`.
- The managed notarization/stapling path has passed end-to-end with the restored keychain profile, a stapled app accepted by Gatekeeper, and a smoke from the bundled managed Python runtime.
- `npm run desktop:resources:managed-dmg-check` proves the stapled managed `.app` survives a plain DMG distribution container: mounted and copied apps pass `codesign`/`spctl`, and both launch the bundled managed Python runtime and serve `/health`, `/ready`, and `/api/version=0.9.5`.

Still flaky:

- First-run local backend startup can still be slow when dependency/model caches are cold.
- The copied `.venv` packaged resources rehearsal uses the current machine's uv-created `.venv`; it relocated successfully into the local `.app` resources path and a second path with spaces on this machine, but the audit shows the Python executable is still an absolute symlink to the local uv-managed runtime outside the bundle.
- The smoke command verifies the API sidecar path with an `about:blank` renderer URL. It now deliberately skips renderer loading after backend readiness, so it does not prove the full packaged renderer, installer, updater, signing, or notarization path.
- electron-builder warns that arm64 macOS normally requires signing; this rehearsal intentionally skips signing with `identity: null`.
- The local ad-hoc signing check proves the current filesystem layout is signable on this machine, while the Developer ID rehearsal is the first real hardened-runtime signing gate. The notarization rehearsal now covers zip submission, stapling, post-staple Gatekeeper assessment, and a managed sidecar smoke from the stapled `.app`; the DMG rehearsal proves a plain distribution container preserves that app seal, but final visual DMG polish, updater behavior, and any `.pkg` alternative remain separate.

Recommended Phase 0 packaging strategy: keep the `formic-server` sidecar layout and Electron launcher, and use the managed `python-runtime/` artifact as the primary path. The copied uv `.venv` can be retired from the primary packaging path and kept only as a comparison/regression rehearsal.

Phase 0 remains focused on desktop packaging readiness. The current signed, notarized, stapled, and DMG-copied managed `.app` proof is enough to stop expanding packaging for now. Keep the keychain-profile notarization and DMG checks repeatable; defer runtime pruning, DMG window polish, updater behavior, and any `.pkg` alternative unless they become concrete release blockers. Phase 1 starts after this packaging boundary and should cover product/runtime work such as memory behavior; it should not be mixed into the Phase 0 signing/notarization/DMG checkpoint. PyInstaller can stay as a fallback experiment if the managed-runtime payload later proves too large or too brittle.
