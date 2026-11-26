# Claude team usage

Shows how much each person on a team uses Claude Code, inside Claude itself: a small
chip above the prompt that expands into a ranked leaderboard (today, 7 days, 30 days).
Only usage numbers and estimated cost are tracked, never prompts or code. Covers Claude
Code only, not claude.ai chat.

How it works: each person's Claude Code sends its usage to a small server in this repo
(`/v1/metrics`), stored in Redis. The mod reads it back from `/api/usage`. Each person has
a personal token, so usage is attributed by token even when people share one Claude account.

## 1. Deploy (once)
1. Import this repo in Vercel and add **Upstash Redis** (provides `REDIS_URL`).
2. Add env var `INGEST_TOKENS`: `token1=shivam,token2=pranav,...` (make tokens with `openssl rand -hex 24`).
3. Optional: `HIDE_USERS` (comma list to hide) and `USER_ALIASES` (`old=new` renames).
4. Redeploy. Edit `INGEST_TOKENS` and redeploy any time to add or remove people.

## 2. Each person: set up telemetry (Mac)
```bash
curl -fsSL https://raw.githubusercontent.com/shivam12345-hyphen/Claude-team-usage-monitoring-mod/main/setup.sh | bash
```
Paste your personal token when asked, then fully quit and reopen Claude Code.
(Windows: `setup.ps1` in PowerShell.)

## 3. Each person: install the mod (Claude desktop app)
```
/plugin install team-usage --marketplace shivam12345-hyphen/Claude-team-usage-monitoring-mod
```
Installing adds you to the team list straight away, even before you have any usage. Click the chip above the prompt to expand it; `/team-usage` opens the full pane, and `/team-usage name <your name>` sets the name teammates see.
The mod reads the endpoint and token from `~/.claude/settings.json` written by step 2.
