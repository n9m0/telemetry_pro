# Security Review

Scope: whole codebase (no branch diff available; single `init` commit on `main`).
No XSS, command injection, path traversal or SSRF found. Bind-address and Ollama-host checks in `backend/server.ts` and `backend/ollama.ts` are sound.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | backend/server.ts | 111-216 | No auth or `Host`/`Origin` validation; DNS rebinding reaches `/api/*` and the open `/ollama` proxy | 8/10 |
| 2 | 🟡 MEDIUM | backend/collectors.ts | 43-65 | `redactCommand` never matches `Authorization: Bearer …`; other secret forms missed | 7/10 |
| 3 | ⚪ LOW | package.json | deps | `express` → `body-parser` (high) and `qs` (moderate) DoS advisories | 9/10 |

## 1. Unauthenticated API and Ollama proxy (MEDIUM)

Loopback binding stops network clients but not a malicious web page in the user's browser. With DNS rebinding, the page becomes same-origin with `127.0.0.1:4174` and gets full access to:

- `/ollama/api/*`: the proxy forwards any method and body, so `pull`, `delete`, `create`, `copy` and generation calls are possible.
- `DELETE /api/history` and `POST /api/benchmark`.
- `/api/stream`, `/api/snapshot`, `/api/history`: telemetry, prompt-derived metrics and process command lines.

The proxy also defeats Ollama's own `Host` check, because its `fetch` to `http://127.0.0.1:11434` sends a loopback `Host`.

Fix:
- Reject requests whose `Host` is not exactly `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`.
- Require a matching `Origin` on state-changing requests.
- Add a per-process random token for `/ollama` and mutating routes.
- Allowlist proxy methods and endpoints (`generate`, `chat`, `tags`, `ps`, `show`, `version`); drop `pull`, `delete`, `create`, `copy`, `push`.

## 2. Incomplete command-line redaction (MEDIUM)

`redactCommand` splits on whitespace, then tests each single token against `/^authorization:\s*bearer\s+/i`. A token never contains that whitespace, so the branch at line 58 is dead and bearer tokens pass through. Short flags (`-p`, `-k`), `--access-key`, `--pass`, URLs with embedded credentials and `KEY=value` arguments are also not redacted. The result is served by `/api/snapshot` and `/api/stream`, and shown in the UI. Combined with issue 1, any rebinding page can read these secrets.

Fix:
- Redact on the whole string before splitting (`Authorization:\s*\S+\s+\S+`, `://[^/@\s]+@`, a broader set of secret-like flag and env names).
- Prefer sending only the executable name unless the user opts in.

## 3. Vulnerable dependencies (LOW)

`npm audit --omit=dev` reports `body-parser` (high) and `qs` (moderate) denial-of-service advisories. Low impact because of the loopback binding. Run `npm audit fix` or update `express` to the latest 5.x.
