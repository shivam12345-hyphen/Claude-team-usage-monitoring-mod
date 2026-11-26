#!/bin/bash
# Claude Code usage tracker setup (Mac/Linux). Asks for a name and token, then
# merges the telemetry settings into ~/.claude/settings.json without touching other settings.
set -e
ENDPOINT="https://claudeusage-mocha.vercel.app"
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -r -p "Your first name (lowercase, e.g. pranav): " NAME </dev/tty
NAME=$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-')
[ -n "$NAME" ] || { echo "Name cannot be empty"; exit 1; }
read -r -s -p "Token (sent to you privately): " TOKEN </dev/tty; echo
[ -n "$TOKEN" ] || { echo "Token cannot be empty"; exit 1; }

NAME="$NAME" TOKEN="$TOKEN" ENDPOINT="$ENDPOINT" python3 - <<'PY'
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
    "OTEL_RESOURCE_ATTRIBUTES": "member.name=" + os.environ["NAME"],
})
json.dump(d, open(p, "w"), indent=2)
PY
echo "Done. Set up as '$NAME'. Fully quit and reopen Claude Code."
