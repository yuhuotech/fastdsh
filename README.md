# FastDSH

One-click desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`@deepseek-ai/dsh`).

FastDSH wraps the Harness Web UI in an Electron shell: it launches a local
Harness instance on a random loopback port, waits for it to become ready, and
opens the full interface — no terminal, no Node.js install, no port management.

## Features

- Zero prerequisites: Harness runs on Electron's embedded Node.js (24.x)
- Random `127.0.0.1` port per launch — never collides with a manual `dsh web`
- User data (profiles, sessions, credentials, plugins) lives in the OS user-data
  directory and survives app upgrades
- Startup failure recovery: retry / view log from the error page or the
  **Harness** application menu
- Hardened renderer: `contextIsolation`, sandbox, no Node in the page,
  external links open in the system browser
- One-click installers for macOS, Windows and Linux

## Development

Requirements: Node.js ^22.19 || >=24, npm.

```sh
npm install
npm run dev        # typecheck + build + launch
npm run typecheck  # types only
```

## Packaging

dsh ships native modules, so **each artifact must be built on a runner of the
matching platform/arch** (this is what CI does).

```sh
npm run package:mac     # DMG + ZIP (host arch)
npm run package:win     # NSIS installer + portable (run on Windows)
npm run package:linux   # AppImage + deb (run on Linux, or via Docker below)
```

Linux on a macOS/Windows host via Docker:

```sh
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine \
  bash -c "npm ci && npm run package:linux"
```

macOS builds are unsigned by default. To sign and notarize, install a
Developer ID certificate and set the standard electron-builder secrets
(`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`), then flip `notarize: true` in `electron-builder.yml`.

## Architecture

```
FastDSH (Electron main)
├── pick a free 127.0.0.1 port
├── fork dsh CLI as a child process
│     (Electron binary + ELECTRON_RUN_AS_NODE=1, --expose-internals
│      granted to the child only; DSH_HOME = userData/harness)
├── poll HTTP readiness → BrowserWindow.loadURL
├── append child output to userData/logs/harness.log
└── kill the child gracefully on quit

BrowserWindow (contextIsolation + sandbox)
└── http://127.0.0.1:<random> → DeepSeek Harness Web UI
```

Note: the Harness child is spawned with `child_process.fork` and
`ELECTRON_RUN_AS_NODE=1`, not Electron's `utilityProcess` — in packaged apps a
utility-process child never actually enables `--expose-internals` (required by
dsh's Cordis HMR), while a run-as-Node child honors it.

## Upgrading dsh

The dsh version is pinned in `package.json`. After bumping it, run a real
startup (`npm run dev`) and a packaged smoke test before releasing — dsh is in
RC and its runtime contract can change between releases.

## License

MIT. DeepSeek Harness and its dependencies remain under their own upstream
licenses.
