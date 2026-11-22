# Performance logs

The API server and the worker log where time goes, so a slow or stalled
request can be traced to a step, and CPU starvation can be told apart from
slow code. The code is `packages/logger/src/perf.ts` (`@campuspilot/logger/perf`);
the request end line is written by `pinoLogger` in `packages/logger/src/hono.ts`.
Only names, ids, sizes and durations are logged, never content.

## Events

| Event | Level | When | Fields |
| --- | --- | --- | --- |
| `http.request.end` (and `.4xx`, `.5xx`, `.error`) | info; warn when `slow` | every HTTP request | `durationMs`, `path`, `status`, `loopBusy`, `steps`, `stepCalls`, annotations, `slow` |
| `perf.step.slow` | warn | one timed step took 250 ms or more | `step`, `durationMs`, `blocking`, `reqId` (inside a request) |
| `runtime.stats` | info; warn when the loop p99 reaches 300 ms or the container was throttled 100 ms or more | every 30 s, server and worker | `loopDelayMs` (`p50`, `p99`, `max`), `loopBusy`, `cpuCores`, `cpuLimitCores`, `periods`, `throttledPeriods`, `throttledMs`, `rssMb`, `heapUsedMb`, `inFlight` |
| `runtime.eventloop.blocked` | warn | a 100 ms probe timer fired 300 ms or more late | `blockedMs`, `inFlight` (up to 10 requests, longest running first: `reqId`, `method`, `path`, `elapsedMs`) |
| `question-paper.save.timing` | info; warn when slow or failed | the worker saves a generated paper | `jobId`, `durationMs`, `steps`, `slow`, `failed` |

- `steps` maps a step name to its total milliseconds in that request; `stepCalls` says how
  often a step ran when more than once. Nested steps are listed separately, so a parent's
  time includes its children's.
- `blocking: true` marks a synchronous step: for that long the event loop served nothing
  else, so every other request on the pod waited. `blocking: false` is wall time of an
  awaited step (I/O, another service, a queue), which also grows when the loop is busy
  with other work.
- `loopBusy` is event loop utilisation from 0 to 1. On a request line it covers the whole
  process while that request ran, so concurrent requests share it. Near 1 means the
  process was CPU-bound.
- `slow` is set from 1,000 ms (`SLOW_REQUEST_MS`).
- `cpuCores` is CPU time used per second of the interval (1 is one full core). Compare it
  with `cpuLimitCores` (from the container's `cpu.max`).
- `throttledMs` is how long the kernel paused the container for exceeding its CPU limit
  in that interval (cgroup `cpu.stat`). Outside a container with a limit these fields
  are absent.

## Step names

| Step | Where | Kind |
| --- | --- | --- |
| `rpc.context` | session or API key lookup of a staff RPC request | async |
| `rpc.handle` | the procedure, including its permission checks | async |
| `qp.template.read` | reading the question paper template (pinned revision or the selected one) | async |
| `qp.figures.load`, `qp.figure.read` | loading a paper's figures from storage | async |
| `qp.body.sanitize` | `question_paper_body` cleaning of the fragment | sync |
| `qp.body.figures` | placing figure data URIs | sync |
| `qp.body.math` | KaTeX typesetting | sync |
| `qp.body.compose` | adding the stylesheets | sync |
| `qp.context` | building the template context | async |
| `qp.document.render` | template render, document sanitiser and body substitution | sync |
| `qp.preview.placeholders` | counting figure placeholders for a version preview | sync |
| `qp.draft.check` | `checkQuestionPaperDraft` | async |
| `qp.docx.html` | the Word conversion's HTML step: sanitising, the CSS cascade and the mapping (`question-paper.docx-html.ts`) | sync |
| `qp.docx.svg` | drawing the paper's SVG diagrams to PNG (Gotenberg's Chromium) | async |
| `qp.docx.images` | turning WebP images (a template's logo) into PNG | async |
| `qp.docx.convert` | Pandoc conversion (in its own container) | async |
| `qp.docx.package` | the table fix-ups of the converted package | sync |
| `doc.template.compile`, `doc.template.render` | Handlebars, for every document type | sync |
| `doc.sanitize` | the document sanitiser, for every document type | sync |
| `doc.pdf.convert` | Gotenberg conversion (Chromium in its own container) | async |
| `doc.pdf.pagecount` | the question paper page cap check | async |
| `image.decode.wait` | an upload waiting for one of the two decode slots | async |
| `image.decode` | sharp decoding and encoding (libuv thread pool) | async |
| `assistant.spend.window` | the school's active billing period, read before the cached AI spend on every assistant access check (docs/school-billing.md) | async |

Question paper previews and draft previews also annotate `htmlBytes` (the size of the
response's document), `paperId` and `versionNo`; the body adds `qpFormulas`, `qpFigures`
and `qpBodyBytes`; a PDF adds `pdfHtmlBytes` and `pdfBytes`. A Word download that makes its file adds `docxHtmlBytes`,
`docxBytes`, `docxTables`, `docxImages`, `docxSvgs`, `docxWorkUnits` (the HTML step's work budget spent,
see docs/question-papers.md "Word download") and `docxWarnings` (Pandoc's warning count).

## Reading them

Logs are JSON lines (pino). With `kubectl logs` and `jq`, where `API` is the API
deployment of the environment (`-n` its namespace; the worker is a separate deployment):

```bash
# The slowest requests, with where their time went
kubectl logs deploy/$API --since=1h | jq -c 'select(.msg=="http.request.end" and .slow) | {path, durationMs, loopBusy, steps}'

# Every stall and what was running during it
kubectl logs deploy/$API --since=1h | jq -c 'select(.msg=="runtime.eventloop.blocked")'

# CPU and throttling over time
kubectl logs deploy/$API --since=1h | jq -c 'select(.msg=="runtime.stats") | {time, cpuCores, cpuLimitCores, throttledMs, loopDelayMs, loopBusy}'
```

To tell the causes apart:

- **A step blocks the loop.** A `perf.step.slow` with `blocking: true`, a
  `runtime.eventloop.blocked` listing that request, and `throttledMs` near 0. The code is
  the problem; the step name says which part.
- **The pod is CPU-throttled.** `throttledMs` is large and `cpuCores` sits at
  `cpuLimitCores`. Stalls appear across unrelated requests. The limit is too low for the
  load, or one request's CPU work (often a blocking step) spends the quota for everyone.
- **Waiting on something else.** A slow request with `loopBusy` low and slow async steps
  (`doc.pdf.convert`, `qp.figure.read`, `rpc.context`): the time is spent in another
  service, storage or the database, not in this process.
- **Slow on the network only.** `http.request.end` is fast but the browser waits: the
  response is produced quickly and delayed on the way (compare with `htmlBytes`).

## Adding timings

Wrap a step with `measure('area.step', () => work())` (it returns `work`'s result,
sync or async) and add facts with `annotateTiming({ ... })`. Both find the
current request through async context, so nothing needs to be passed down; outside a
request they only log `perf.step.slow`. For worker code that should log its own
summary line, wrap it in `withTimingScope(log, 'area.event', { id }, () => work())`.
Name steps by area and step (`qp.body.math`), never log content, and do not wrap a
hot inner loop (one record per item would cost more than the work).
