# Claude usage tracker

Receives Claude Code OpenTelemetry metrics from your team and shows per-person
token usage and estimated spend. Covers Claude Code only (not claude.ai chat).

## 1. Deploy
1. Push this folder to a GitHub repo and import it in Vercel (or run `vercel` in this folder).
2. In the Vercel project: Storage / Marketplace -> add **Upstash Redis** and connect it to the project.
3. Add environment variables:
   - `INGEST_TOKEN`  a long random string (teammates' Claude Code uses it)
   - `DASH_PASSWORD` the password for the dashboard
4. Redeploy.

## 2. Point Claude Code at it (each teammate, or via managed settings)
```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=https://YOUR-APP.vercel.app
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer YOUR_INGEST_TOKEN"
```
Protocol must be `http/json` (Vercel doesn't accept gRPC). Claude Code appends
`/v1/metrics` itself.

## 3. View
Open your Vercel URL. Username is anything, password is `DASH_PASSWORD`.
