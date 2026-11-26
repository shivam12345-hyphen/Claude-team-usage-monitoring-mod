#!/bin/bash
# Claude Code usage tracker setup (Mac/Linux). Asks for a name and token, then
# merges the telemetry settings into ~/.claude/settings.json without touching other settings.
set -e
ENDPOINT="https://claudeusage-mocha.vercel.app"
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -r -s -p "Your personal token (sent to you privately): " TOKEN </dev/tty; echo
[ -n "$TOKEN" ] || { echo "Token cannot be empty"; exit 1; }

TOKEN="$TOKEN" ENDPOINT="$ENDPOINT" python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
try:
    d = json.load(open(p))
except FileNotFoundError:
    d = {}
except ValueError:
    raise SystemExit("~/.claude/settings.json is not valid JSON; fix it first (nothing was changed).")
d.setdefault("env", {}).update({
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": os.environ["ENDPOINT"],
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer " + os.environ["TOKEN"],
})
d["env"].pop("OTEL_RESOURCE_ATTRIBUTES", None)  # name now comes from your personal token
json.dump(d, open(p, "w"), indent=2)
PY
echo "Done. Set up. Fully quit and reopen Claude Code."
