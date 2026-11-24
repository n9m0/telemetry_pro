# Mac System Monitor

A local-first macOS dashboard for CPU, unified memory, storage, network, processes, Ollama workloads, inference history, and controlled model benchmarks.

## Screenshots

_Screenshot placeholder._

## Architecture

- React 19, TypeScript, Vite, Recharts, and Lucide icons for the dashboard.
- Node.js 24, TypeScript, and Express 5 for collectors, Ollama integration, streaming updates, history, and benchmarks.
- Server-Sent Events deliver one-second telemetry snapshots to the browser.
- The server binds to `127.0.0.1`; the Vite development server proxies `/api` and `/ollama` to it.
- Native macOS commands are invoked with explicit argument arrays. Collectors fail independently and return provenance-bearing unavailable metrics instead of substitutes.

## Requirements

- macOS (Apple Silicon is the primary target).
- Node.js 22 or later and npm.
- Ollama is optional. The system dashboard works without it.

## Install And Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5175>. The local API listens on <http://127.0.0.1:4174>.

Production build and server:

```sh
npm run build
npm start
```

The production server serves `dist/` on `127.0.0.1:4174`.

## Ollama

Install and start Ollama separately, then open **AI workloads** to inspect `/api/ps`, `/api/version`, and loaded model metadata. The monitor contacts only `127.0.0.1:11434` by default. `OLLAMA_HOST` may select another loopback address; non-loopback hosts are rejected. The monitor never invokes `ollama pull`.

Ollama's model APIs do not expose statistics for requests made by unrelated clients. To record prompt/generation timing and TTFT, configure an Ollama-compatible client to use this monitor's local proxy:

```text
http://127.0.0.1:4174/ollama
```

The proxy forwards `/api/*` requests only to the configured local Ollama endpoint. Streaming generation records Ollama's prompt/evaluation counts and nanosecond durations, and measures TTFT from request start to the first non-empty response content. Non-streaming requests can provide Ollama's timing statistics but have unavailable TTFT. Direct requests to Ollama are not intercepted. The proxy currently captures completed `/api/generate` and `/api/chat` requests.

Loaded model size is labeled estimated. Process RSS and Ollama-reported `size_vram` are displayed separately. An MLX backend is shown as verified only when Ollama explicitly reports a backend field; model names are not used to infer it.

## Local Benchmarks

The **Benchmark** page runs one installed local model sequentially. Context size, prompt, output target, run count, and an optional warm-up are configurable. Only names returned by the local Ollama `/api/tags` endpoint are accepted. Benchmarks do not change fan, CPU/GPU limits, or power settings; stop aborts the active request. Results include cold-start/warm-run labels and measured Ollama statistics. macOS sensor values that are inaccessible remain unavailable. Results are stored locally and can be exported as CSV or JSON.

## Telemetry And Accuracy

| Metric | Source / status |
| --- | --- |
| CPU total, user, system, per-core | Calculated from `os.cpus()` time deltas. |
| Unified memory total, active, wired, compressed, file-backed | `os` and cached `vm_stat` page counts; used is calculated from active + wired + compressed pages, and available from total minus that value. `os.freemem()` is the explicit fallback if `vm_stat` is unavailable. |
| Startup volume capacity | `df -kP /`, refreshed every 60 seconds. |
| Network throughput | `netstat -ibn` physical-interface counters; rates are unavailable until a second sample establishes a baseline. |
| Process CPU, RSS, runtime | `ps`, refreshed every 2.5 seconds; top 30 are retained. |
| Hardware model, chip, core counts, OS version | `sysctl`, `os`, and `sw_vers` where present. |
| Swap usage | `sysctl vm.swapusage` where available. |
| Battery charge/state | `pmset -g batt` where available. |
| Ollama loaded models/version | Local Ollama HTTP API. |
| Prompt/output counts, prefill/generation speed, total/load time | Calculated from Ollama request statistics observed by the local proxy. |
| TTFT | Measured from first streamed content; unavailable when it cannot be observed. |
| GPU utilization, GPU core count | `ioreg -c IOAccelerator` "Device Utilization %" and `gpu-core-count`; no root required. |
| CPU (SoC die) and battery temperature | Unprivileged IOHID sensor reads through a small C helper ([backend/native/thermal.c](backend/native/thermal.c)) that is compiled once with `clang` into `~/.mac-system-monitor/`. CPU temperature is the hottest `PMU tdie*` sensor; Apple Silicon exposes no per-core or dedicated GPU sensor. Unavailable if Xcode command line tools are missing. |
| Fan speed | Actual RPM per fan (tile shows the average) read from the AppleSMC IOKit user client by a second compiled helper ([backend/native/fans.c](backend/native/fans.c)); no privileges needed. Unavailable on fanless Macs or without `clang`. |
| Neural Engine utilization, GPU temperature, thermal pressure, power | Unavailable unless a supported local source exposes them. No arbitrary temperature thresholds are presented as macOS thermal pressure. |
| Disk throughput, detailed battery health/cycles, per-model exact unified-memory allocation | Not exposed by the current collectors; shown unavailable. |

Every metric includes its value, unit, quality (`measured`, `calculated`, `estimated`, or `unavailable`), and source in the API. Metric tiles expose quality and source on hover. The current implementation does not invoke `powermetrics`, install privileged helpers, request administrator access, or change system settings. This means several Apple Silicon sensor and thermal-correlation requirements are intentionally unavailable rather than guessed.

## Data And Security

- No telemetry or request data is uploaded. There are no analytics or remote APIs.
- API and dashboard servers bind to loopback only. Set `PORT` to change the API port; `HOST` must remain a loopback address. Update `vite.config.ts` if changing the development API port.
- Inference session history is capped at 200 requests in `~/.mac-system-monitor/llm-history.json`.
- Benchmark history is capped at 100 results in `~/.mac-system-monitor/benchmark-history.json`.
- History files are created with owner-only permissions. Clearing inference history is available from **Model performance**.
- Ollama proxy targets are fixed to the validated loopback host; request paths are restricted to `/api/*`, and only `GET /api/tags|ps|version` and `POST /api/generate|chat|show|embed|embeddings` are forwarded. Model management routes (`pull`, `delete`, `create`, `copy`, `push`) are blocked; use Ollama directly for those.
- Every request must carry a loopback `Host` (`127.0.0.1`, `localhost` or `[::1]` on the server port or `DEV_PORT`, default `5175`) and, if present, a matching `Origin`. This blocks DNS-rebinding and cross-origin browser access.
- Process command lines are redacted for bearer/basic authorization values, URL credentials, secret-like flags and `KEY=value` arguments before they reach the API.

## Development And Validation

```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

Unit tests mock Ollama and never download a model. Playwright starts both local servers and exercises telemetry rendering, unavailable readings, process filtering, and benchmark navigation. Install the browser used by Playwright if it is not present:

```sh
npx playwright install chromium
```

## Troubleshooting

- **Dashboard reconnecting:** confirm the API is available at `http://127.0.0.1:4174/api/health`; restart `npm run dev` if needed.
- **Ollama unavailable:** start Ollama locally and check `http://127.0.0.1:11434/api/version`.
- **No request timings:** direct Ollama traffic is not visible to the monitor. Set the client's Ollama base URL to `http://127.0.0.1:4174/ollama`.
- **Sensor shows unavailable:** this is expected when the active Mac/macOS version does not expose that metric to an unprivileged process. The monitor does not prompt for sudo or fabricate a reading.
- **Benchmark has no models:** ensure a model is already installed and listed by `ollama list`; the benchmark never downloads one.

## Known Limitations

The app currently does not collect Neural Engine utilization, GPU temperature, macOS thermal pressure, power draw, disk throughput, or detailed battery health. Without those sources it cannot establish synchronized thermal throttling correlation. Live per-token speed is also unavailable during generation because Ollama streaming chunks are not guaranteed to represent one token each; completed-request throughput is calculated from Ollama's authoritative evaluation counts and durations. Privileged sensor helpers, alert thresholds/settings, and a broad multi-volume storage inventory are not included.