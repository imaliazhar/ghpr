# ghpr

> [!NOTE]
> This project is AI-generated. The code and this README were written by [Claude Code](https://claude.com/claude-code) with human direction and review. Treat it as such before relying on it.

A terminal dashboard for your open GitHub pull requests. It shows what each PR is waiting on, so you know what to do next.

## Requirements

- Node.js 22+
- [GitHub CLI](https://cli.github.com/) (`gh`), logged in with `gh auth login`

## Install

```sh
npm install
npm run install:local   # bundles the app into ~/.local/bin/ghpr, next to the ghpr-claude-state hook script
```

Rerun `npm run install:local` after pulling changes. For development, `npm start` runs from source.

## Usage

```sh
ghpr        # opens the current branch's PR if there is one, otherwise the list
ghpr --all  # always start on the list
```

Results from the previous run show instantly while fresh data loads in the background. The status line at the bottom shows when data was last fetched; messages replace it for a few seconds.

## Statuses

PRs are grouped by status, most actionable first:

| Status | Meaning |
|---|---|
| ✔ ready to merge | Required checks pass and the PR is approved |
| ✗ checks failing | A required check failed |
| ⊘ bot blocking | The review bot is requesting changes |
| ● checks running | Required checks are still running |
| ◎ in bot review | `tunnel-review-vision` is on, so checks are paused |
| ◌ needs approval | Checks pass, but a human approval is missing |

Only required checks count. Archived PRs sit collapsed at the bottom.

## Local checkouts

ghpr looks through the git repos directly under `~/Projects` in the background, and marks PRs whose branch is checked out in one with `⌂`. Inside tmux, `o` switches to that checkout's session, named after its folder with `.` replaced by `_`. If the session doesn't exist, ghpr creates it in the folder with `$EDITOR` in window 1 and `claude` in window 2. It focuses window 2 whenever the session has one. In [tmux popup mode](#tmux-popup), `o` switches the client the popup was opened from, then hides the popup.

## Claude sessions

With Claude Code hooks set up, the `⌂` of a PR whose checkout has a Claude Code session shows what that session is doing, and the detail page spells it out:

| Marker | Meaning |
| --- | --- |
| yellow spinner | working |
| `●` magenta | waiting for you |
| `!` red | needs permission or an answer |

The hooks run `ghpr-claude-state`, which records each session's state in `~/.cache/ghpr/claude`, keyed by its project folder. Add them to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state waiting", "async": true}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state working", "async": true}]}],
    "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state working", "async": true}]}],
    "Notification": [{"matcher": "permission_prompt|elicitation_dialog", "hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state permission", "async": true}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state waiting", "async": true}]}],
    "StopFailure": [{"hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state waiting", "async": true}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "~/.local/bin/ghpr-claude-state ended"}]}]
  }
}
```

Claude Code runs no hook when you interrupt it with `esc`, so the session shows as working until its next prompt.

## Keys

| Key | Action |
|---|---|
| `?` | Show all keys (`esc` closes) |
| `↑/↓` `j/k` | Move |
| `g` / `G` | Jump to top / bottom |
| `ctrl+u` / `ctrl+d` | Half a screen up / down (list) |
| `←/→` `h/l` `tab` | Switch repo tab |
| `enter` | Open PR details / open the selected failing check |
| `s` | Leap: the icons of the PRs on screen turn into two-character labels; type one to jump there (`esc` or a wrong key cancels) |
| `/` | Fuzzy search titles: matches are highlighted and the cursor jumps to the best one. `enter` stops typing, `esc` cancels |
| `n` / `N` | Next / previous match |
| `O` | Open the PR in the browser |
| `o` | Switch to the tmux session for the PR's local checkout, creating it if needed |
| `c` | Write a message for claude in that session's window named `claude`; `enter` sends, `esc` cancels |
| `B` | Ask that claude whether the review bot's blocking review is valid, when the bot is requesting changes |
| `ctrl+g` | Open the PR's repo in GitQueue (`app.gitqueue.com/install/<owner>/<repo>`) |
| `m` | Queue via GitQueue (`/gitqueue add normal`), only when ready |
| `t` | Toggle the `tunnel-review-vision` label |
| `b` | Toggle the `in-review` label |
| `a` | Archive / unarchive |
| `esc` | Back to the list / clear the search |
| `R` | Refresh |
| `q` | Quit (hides the popup in [tmux popup mode](#tmux-popup)) |

## tmux popup

Run ghpr in its own tmux session with `GHPR_POPUP` set to that session's name, and attach to it from `display-popup`. `q` and `esc` then detach the session instead of quitting, so ghpr keeps its state between toggles:

```sh
tmux new-session -d -s _ghpr -e GHPR_POPUP=_ghpr ghpr
tmux display-popup -E "TMUX= tmux attach-session -t =_ghpr"
```

If tmux can't detach the session, ghpr quits.

## Local files

- `~/.cache/ghpr/prs.json`: results from the last fetch
- `~/.cache/ghpr/claude/`: the state of each Claude Code session, written by `ghpr-claude-state`
- `~/.config/ghpr/archived.json`: archived PRs
- `~/.config/ghpr/state.json`: last selected repo tab
