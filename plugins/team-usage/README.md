# team-usage

A small chip above the Claude prompt that ranks everyone on your team by Claude Code token usage. Click it to expand a leaderboard for today, the last 7 days or the last 30 days: name, a bar and new tokens, with a dot for who is online now and your own row marked.

There is no server and no token. The team shares one folder it already syncs (Google Drive, Dropbox, iCloud, OneDrive). Each mod writes one tiny file there with only a name and token totals, and reads everyone else's. Set the folder with `/team-usage folder <path>`, and your name with `/team-usage name <your name>`.

Privacy: the mod adds up usage numbers from the transcripts Claude Code keeps on your computer and shares only your name and token counts. It never stores or sends prompts, code, file names or model answers.
