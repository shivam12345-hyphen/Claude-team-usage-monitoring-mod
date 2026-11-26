# Claude team usage

A small chip above the Claude prompt showing everyone on your team who has installed it, ranked by how much
Claude Code they used (today, 7 or 30 days). No tokens, no passwords, no telemetry setup: install the mod and you are on the list.

## Install (each person, in the Claude desktop app or Claude Code)
```
/plugin install team-usage --marketplace shivam12345-hyphen/Claude-team-usage-monitoring-mod
```
Then use Claude Code as normal. Click the chip above the prompt to expand it.
Set the name teammates see with `/team-usage name <your name>` (it defaults to your computer username).

## How it works
The mod adds up your own usage from the transcripts Claude Code already keeps on your computer, and sends only
your name and token totals to a small server in this repo (`/api/sync`), stored in Redis. It reads everyone's totals back
from `/api/team`. Prompts, code and file names never leave your machine.

The server is open: it has no login, so anyone with the URL can read the list or add an entry. Each install uses a
random id (stored only on your machine; the server keeps just its hash), so nobody else can change your row.
Counts are new tokens (input, output and cache writes). Cache reads are left out.

## Deploy the server (once)
Import this repo in Vercel and add **Upstash Redis** (it provides `REDIS_URL`). No other settings are needed.
