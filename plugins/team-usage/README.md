# team-usage

A pane beside the Claude chat that shows everyone's Claude Code usage for your team: spend and new tokens for today, the last 7 days and the last 30 days, ranked, with your own row marked. It uses the personal token and endpoint you already set up for the team usage dashboard (read from your ~/.claude/settings.json), so there is nothing else to configure. Open it with /team-usage; it refreshes every minute and shows your rank in the status line. Only usage numbers are shared, never prompts or code.
