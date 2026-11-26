# team-usage

A small chip above the Claude prompt that ranks everyone on your team by Claude Code token usage. Click it to expand a leaderboard for today, the last 7 days or the last 30 days: name, a bar and new tokens, with a dot for who is online now and your own row marked.

After installing, sign in once with the team login you were given: `/team-usage login <username> <password>`. The mod adds up usage numbers from the transcripts Claude Code keeps on your computer and sends only a random id, a name and token counts to the team server, which rejects anyone without the login. It never stores or sends prompts, code, file names or answers. Rename yourself with `/team-usage name <your name>`; sign out with `/team-usage logout`.
