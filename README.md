# Claude team usage

A small chip above the Claude prompt that ranks everyone on your team by Claude Code token usage
(today, 7 or 30 days). No server, no tokens, no accounts: the team shares one folder it already syncs.

## Install (each person, in the Claude desktop app or Claude Code)
```
/plugin install team-usage --marketplace shivam12345-hyphen/Claude-team-usage-monitoring-mod
```

## Connect your team (once per person)
1. Create or pick a folder everyone on the team can open in a synced drive (Google Drive, Dropbox, iCloud, OneDrive).
   Share it only with your team.
2. Point the mod at it, using the folder's path on your computer, for example:
   ```
   /team-usage folder ~/Google Drive/Claude usage
   ```
3. Optional: choose the name teammates see (defaults to your computer username):
   ```
   /team-usage name Pranav K
   ```
Click the chip above the prompt to expand it. `/team-usage` opens the full pane.

## What is shared, and what is not
The mod adds up usage numbers from the transcripts Claude Code keeps on your computer, and writes one small file,
`claude-usage-<id>.json`, into the shared folder. It contains only your name and token counts (input, output and
cache) for today, 7 days and 30 days. It never stores or sends prompts, code, file names or answers, and it reads only
files named `claude-usage-*.json` in the shared folder. Counts are new tokens (input, output and cache writes); cache
reads are left out. Who can see the numbers is decided by who the folder is shared with.
