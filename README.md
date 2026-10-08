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
npm link   # makes `ghpr` available everywhere
```

## Usage

```sh
ghpr        # opens the current branch's PR if there is one, otherwise the list
ghpr --all  # always start on the list
```

Results from the previous run show instantly while fresh data loads in the background.

## Statuses

PRs are grouped by status, most actionable first:

| Status | Meaning |
|---|---|
| ✔ ready to merge | Required checks pass and the PR is approved |
| ⊘ bot blocking | The review bot is requesting changes |
| ✗ checks failing | A required check failed |
| ● checks running | Required checks are still running |
| ◎ in bot review | `tunnel-review-vision` is on, so checks are paused |
| ◌ needs approval | Checks pass, but a human approval is missing |

Only required checks count. Archived PRs sit collapsed at the bottom.

## Keys

| Key | Action |
|---|---|
| `↑/↓` `j/k` | Move |
| `←/→` `h/l` `tab` | Switch repo tab |
| `enter` | Open PR details / open the selected failing check |
| `w` | Open the PR in the browser |
| `m` | Queue via GitQueue (`/gitqueue add normal`), only when ready |
| `t` | Toggle the `tunnel-review-vision` label |
| `b` | Toggle the `in-review` label |
| `a` | Archive / unarchive |
| `esc` | Back to the list |
| `R` | Refresh |
| `q` | Quit |

## Local files

- `~/.cache/ghpr/prs.json`: results from the last fetch
- `~/.config/ghpr/archived.json`: archived PRs
- `~/.config/ghpr/state.json`: last selected repo tab
