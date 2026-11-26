# team-usage

A small chip above the Claude prompt that shows everyone on your team who has installed this mod, with their Claude Code usage. Click it to expand a ranked leaderboard for today, the last 7 days or the last 30 days: name, spend and new tokens, with a dot for who is online now and your own row marked. Installing the mod adds you to the list straight away, even before you have any usage.

Set the name your teammates see with `/team-usage name <your name>`. Open the full pane with `/team-usage`. The mod reads the team server address and your personal token from `~/.claude/settings.json`, which the team setup script writes, so run that script first. Only usage numbers are shared, never prompts or code.
