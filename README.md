# Claude team usage

A small chip above the Claude prompt that ranks everyone on your team by Claude Code token usage
(today, 7 or 30 days). Install the plugin and you appear for everyone. No tokens, no setup.

## Install (each person, in the Claude desktop app or Claude Code)
```
/plugin install team-usage --marketplace shivam12345-hyphen/Claude-team-usage-monitoring-mod
```
Click the chip above the prompt to expand it. Rename yourself with `/team-usage name <your name>`.

## What is shared
The mod adds up usage numbers from the transcripts Claude Code keeps on your computer and sends the team server only
a random id, your name and token counts (input, output, cache) for today, 7 days and 30 days. It never stores or sends
prompts, code, file names or answers. Counts are new tokens (input, output and cache writes); cache reads are left out.
The server has no login: anyone who knows its address can read the list or add an entry, but only your install can
change your own row (the server keeps only a hash of your random id).

## Host the server (once, by the team owner)
1. In Vercel, import this repo as a project named `claudeteamusage` (it gives `claudeteamusage.vercel.app`).
2. In the project, open Storage and add **Upstash Redis**; it provides `REDIS_URL`. No other settings are needed.
3. Redeploy. If your address differs, change `SERVER` at the top of `plugins/team-usage/hooks/register.tsx` and push.
