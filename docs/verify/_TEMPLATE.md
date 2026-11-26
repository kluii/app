# Wave K<n> — verification

> One section per exit criterion, in the order of `ROADMAP.md`. Each section contains the command, the real trimmed output, and a verdict. No invented numbers. A red gate that is not fixed is recorded as red and the wave stops here.

Environment: commit `<sha>`, branch `<branch>`, Node `<version>`, Postgres `<version>`, date `<YYYY-MM-DD>`.

## Gate

```
$ npm ci && npm run format:check && npm run typecheck && npm run lint
…
$ npm test
… (paste the summary lines: files, tests, duration)
$ npm run build
…
$ npm run test:e2e
…
```

## K<n>-<nn> — <task title>

### Exit: <the criterion, copied verbatim from ROADMAP.md>

```
$ <command>
<real output, trimmed to the lines that prove it>
```

Verdict: PASS | FAIL

## Deviations

| What | Why | Where recorded |
|---|---|---|
| … | … | ADR-NNNN / decisions.md D-nn |

## Open items handed to the next wave

- …
