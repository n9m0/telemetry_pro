# Telemetry Cloud Pro — Analysis & Findings

_Local-first macOS system + Ollama telemetry dashboard._
_Analysis date: 2026-11-15. No code was changed during this analysis._

---

## 1. Executive Summary

This is a small, high-quality monorepo (~2,800 LOC) that serves a React 19 / Vite
dashboard for CPU, unified memory, disk, network, thermal/fan sensors, and Ollama
LLM workloads on Apple Silicon Macs. A Node 24 / Express 5 backend samples system
state every second and streams it over Server-Sent Events; two small unprivileged
C helpers read thermal and fan data from IOKit.

**Verdict: the codebase is in good shape.** Every automated check is green:

| Check | Command | Result |
| --- | --- | --- |
| Unit tests (Vitest) | `npm test` | ✅ 24/24 passed (4 files) |
| End-to-end (Playwright) | `npm run test:e2e` | ✅ 3/3 passed |
| Typecheck | `npm run typecheck` | ✅ clean (app + backend projects) |
| Lint (oxlint) | `npm run lint` | ✅ 0 warnings/errors |
| Production build | `npm run build` | ✅ 2,481 modules, ~261 ms |

There are **no defects that block the build or tests**. The issues below are
correctness-edge-cases, robustness improvements, and process/quality suggestions —
ranked by impact. None are strictly required for the app to function.

---

## 2. Architecture

```
Browser (React 19, Vite) ──SSE /api/stream──▶ Express server (127.0.0.1:4174)
   ▲                                             │
   │ REST: /api/snapshot, /api/history,          ├─ MacCollector   (ps/df/vm_stat/ioreg/netstat/sysctl/pmset)
   │        /api/models, /api/benchmark/*        ├─ OllamaCollector (loopback /api/ps, /api/version)
   │                                             ├─ OllamaLogWatcher (tail ~/.ollama/logs/server.log)
   │                                             ├─ SessionHistory / BenchmarkHistory (owner-only JSON files)
   │                                             └─ native/thermal.c, native/fans.c (clang → ~/.mac-system-monitor/)
   │
   └─ Vite dev proxy: /api, /ollama → 127.0.0.1:4174
```

### 2.1 Backend
- **`server.ts`** — Express app. Loopback-only host validation (rejects non-loopback
  `HOST`); SSE broadcaster with a client `Set`; 1 s sample + 1 s log-poll timers;
  graceful `SIGINT`/`SIGTERM` shutdown; an Ollama proxy (`/ollama/api/*`) that
  records request metrics and TTFT; production static serving of `dist/`.
- **`collectors.ts`** — `MacCollector`. All external commands go through a single
  `command()` helper using `execFile` (argument arrays, 2.5 s timeout, 1 MiB cap) —
  no shell injection surface. Per-source caching with staggered refresh intervals
  (processes 2.5 s, disk 60 s, vm_stat 5 s, thermal/fans 2 s). Each metric carries
  `value / unit / quality / source`.
- **`ollama.ts`** — `OllamaCollector`. Fails closed: remote `OLLAMA_HOST` values are
  rejected and it falls back to loopback. Never pulls models.
- **`ollama-log.ts`** — Tails Ollama's server log to estimate metrics for requests
  that bypass the proxy. Robust partial-line handling; 16 MiB read cap.
- **`benchmark.ts`** — Sequential model benchmark runner with validation, warmup,
  thermal-pressure auto-abort, cancellation, and 100-entry cap.
- **`history.ts` / `benchmark-history.ts`** — JSON persistence to
  `~/.mac-system-monitor/` with `0o600` perms and atomic `writeFile`+`rename`.
- **`native/*.c`** — IOKit/AppleSMC helpers, compiled once via `clang`; metrics stay
  `unavailable` if the compiler is missing.

### 2.2 Frontend
- **`App.tsx`** — Four pages (Overview / AI workloads / Model performance /
  Benchmark) behind an SSE `EventSource` hook. Lazy-loads `BenchmarkView` and
  `TelemetryChart` (Recharts) to keep the main bundle small.
- **`shared/metrics.ts`** — Pure metric helpers; well-tested.
- **`components/`** — `Gauge`, `Thermometer`, `MetricTile`, `TelemetryChart`
  (+`LazyTelemetryChart`), `BenchmarkView`.

### 2.3 Quality
- Strong test suite covering parsers, Ollama host policy, benchmark sequencing/
  cancellation/thermal-abort, log parsing, and metric math.
- A written **constitution** (`.specify/memory/constitution.md`) codifies five
  principles: local-first privacy, provenance-bearing metrics, safe system
  integration, failure isolation, and behavior-preserving verified changes. The
  implementation is consistent with all five.

---

## 3. Findings

Ranked by impact. `Severity` reflects impact if the edge case is hit, not likelihood.

### F1 — `refresh()` is not re-entrancy-guarded (robustness, low severity)
`server.ts` fires `refresh()` from three places: the 1 s sample timer
(`void refresh()`), and on-demand inside `/api/snapshot` and `/api/stream`
(`if (!snapshot) await refresh()`). Because `refresh()` is `async` and unguarded,
overlapping invocations can interleave: two samples both `push` to `chartHistory`
and both reassign the shared `snapshot`, so a single tick can emit two history
points or a slightly stale frame.
- **Impact:** Minor — a transient, self-healing duplicate sample in the live chart;
  no data loss. More likely under bursty SSE reconnects than steady state.
- **Suggested fix:** Serialize with an in-flight guard, e.g.
  `let refreshPromise: Promise<void> | null = null` and have every entry point
  `await (refreshPromise ??= refresh().finally(() => (refreshPromise = null)))`.
  This also removes the redundant `await refresh()` in the two handlers.

### F2 — `BenchmarkHistory.add()` lacks the write queue `SessionHistory` uses (correctness edge-case, low)
`history.ts` serializes all writes through a `writeQueue` (safe under concurrent
`add`/`clear`), but `benchmark-history.ts` writes a fixed `.tmp` name directly.
Concurrent calls would race on the same temp file. Today this is not reachable
(benchmarks run one at a time via the `controller` guard in `BenchmarkRunner`), but
the two history classes now diverge in concurrency safety.
- **Impact:** None today; latent if a future caller ever persists benchmark results
  concurrently.
- **Suggested fix:** Give `BenchmarkHistory` the same `writeQueue` pattern, or
  randomize the temp suffix. Cheapest is to extract a shared atomic-write helper.

### F3 — e2e webServer is fragile: no port isolation / stale-server tolerance (process robustness, medium)
`playwright.config.ts` runs `npm run dev:e2e` as the `webServer` with
`reuseExistingServer: !CI`. Two concrete failure modes were observed / found:
1. **Stale server blocks the run.** A leftover dev server held `127.0.0.1:4174`;
   `dev:e2e`'s backend then failed to bind and Playwright reported
   *"Process from config.webServer was not able to start. Exit code: 1"* with no
   hint about the port. (During this analysis a stale `tsx` server was found on
   4174 and cleared; after that the suite passed 3/3.)
2. The backend binds a **fixed** port 4174 with no `strictPort:false` fallback, and
   `dev:e2e` does not clean up, so a crashed previous run can leave the port bound.

- **Impact:** Intermittent e2e failures that are hard to diagnose; a CI blocker in
  shared environments.
- **Suggested fixes (any combination):**
  - Have the backend exit clearly when the port is bound (the `listen` callback
    already logs success; add an `error` handler on `server` for `EADDRINUSE` that
    prints the offending port and exits non-zero).
  - Add a `beforeEach`/global hook that waits for `http://127.0.0.1:4174/api/health`
    to respond, or use a per-run `PORT`/`VITE` override so parallel workers don't
    collide.
  - Optionally set `reuseExistingServer: true` locally and document that a stale
    server must be killed.

### F4 — No CI, no `.nvmrc`, no `engines` field (quality, low)
There is no `.github/workflows` and `package.json` has no `engines`/`.nvmrc`, even
though the README states "Node.js 22 or later." A Node version mismatch is a common
cause of "works on my machine."
- **Suggested fix:** Add `engines: { node: ">=22" }`, a `.nvmrc` (`22`), and a CI
  workflow that runs `typecheck`, `lint`, `test`, `test:e2e` (with
  `npx playwright install --with-deps chromium`), and `build`. This also gives the
  F3 e2e issues a safe place to surface.

### F5 — `index.html` document title is the stale package name (cosmetic, trivial)
`index.html` sets `<title>ai_agentic_tools_cloud_pro</title>` and
`package.json` `"name"` is `ai_agentic_tools_cloud_pro`, but the app is branded
**FIELDNOTE · SYSTEM MONITOR** (README title: "Mac System Monitor").
- **Suggested fix:** Set the title to something user-facing, e.g.
  `<title>Fieldnote — Mac System Monitor</title>`. Optional: align the package
  `name` with the product.

### F6 — Trivial indirection wrappers (style, trivial)
`App.tsx` defines `const navigate = (next) => setPage(next)` and
`const changeSort = (next) => setSort(next)` — one-line pass-throughs that add a
layer without behavior. Harmless (they may exist to keep click handlers stable),
but `setPage`/`setSort` from `useState` are already stable, so they could be
inlined.
- **Suggested fix:** Optional; inline the setters or keep them only if referenced by
  a callback-identity dependency elsewhere. No correctness impact.

### F7 — CPU frequency and several sensors are permanently `unavailable` by design (informational)
`cpu.frequency` is hard-coded `unavailable('MHz')` and GPU temperature, thermal
pressure, and power are `unavailable` because no unprivileged source exposes them.
This is **correct and intentional** (principle II — honesty over fabrication) and is
documented in the README and surfaced in the UI. Listed only so a reader doesn't
mistake it for a bug. No action needed.

### F8 — `dist/` is present on disk but gitignored (housekeeping, trivial)
`dist/` exists locally (regenerated by `npm run build`) yet is in `.gitignore`.
That's the correct setup; it only matters because this directory is **not a git
repo** (see F9). No action for the project itself.

### F9 — Working copy is not a git repository (process, informational)
`git rev-parse` reports "not a git repository." The project has a `.gitignore` and
a CI expectation but no `.git`. This blocks commits, PRs, and diff-based review.
- **Suggested action:** If version control is intended, `git init` and make an
  initial commit (excluding `node_modules`, `dist`, `test-results` per `.gitignore`).

---

## 4. Strengths (worth preserving)

- **Safety by construction:** all external commands via `execFile` with argument
  arrays and timeouts; loopback-only host enforcement; Ollama remote-host
  rejection; owner-only (`0o600`) history files with atomic writes; no model
  downloads; no elevated privileges.
- **Honest metrics:** every value carries `quality`/`source`; unavailable readings
  are never fabricated or substituted — a strong, unusual property.
- **Failure isolation:** each collector returns a provenance-bearing `unavailable`
  rather than throwing; one bad source never blanks the dashboard.
- **Solid tests** for the hard parts (Go-duration parsing, log-chunk estimation,
  prefill/generation separation, prompt-cache exclusion, cold/warm sequencing,
  cancellation, thermal auto-abort, network counter selection).
- **Small, cohesive** frontend with lazy-loaded heavy charts; clean typecheck/lint.

---

## 5. Recommended Priority Order

1. **F3** — Make e2e resilient (port error handling + health-wait). Highest daily
   friction; blocks CI.
2. **F1** — Guard `refresh()` against re-entrancy. Small, self-contained fix.
3. **F4** — Add `engines`/`.nvmrc` + a CI workflow (also covers F3).
4. **F2** — Unify atomic-write behavior across both history classes.
5. **F5 / F6** — Cosmetic title cleanup and dead-wrapper removal.
6. **F9** — Initialize git if the project will be version-controlled.
7. **F7 / F8** — No action (by-design / correct).

---

## 6. How This Analysis Was Verified

| Step | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | 24/24 passed |
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` | 0 findings |
| Build | `npm run build` | success (~261 ms) |
| E2E | `npm run test:e2e` | 3/3 passed (after clearing a stale server on :4174) |
| Source review | full read of `backend/*`, `src/**`, native C, configs, tests | — |

No source files were modified during this analysis.
