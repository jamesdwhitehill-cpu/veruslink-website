# CLAUDE.md - veruslink-website

## What this is
veruslink-website for VerusLink. Serves veruslink.au. Business context, decisions and prompts live in ~/Documents/JARVIS/30-Ventures/VerusLink/ and the app's row in ~/Documents/JARVIS/30-Ventures/ESTATE.md. Read that row before changing anything that touches hosting, DNS or keys.

## How it ships
Deploys from GitHub on push to main via Vercel. ./deploy.sh pushes main.
Deploy only when James's message says deploy, ship or push. Otherwise build, verify, commit locally, report, stop.

## Model
Read the whole ask first, then pick: Haiku 4.5 for trivial edits, Sonnet 5 for anything substantive or when unsure. Never Opus or above without James naming it with a spend cap and expiry. State your choice in one line before starting.

## Rules
- Commit as James Whitehill <jamesdwhitehill@gmail.com>. No Co-Authored-By, no session links, no AI mention in commits, code comments or files.
- Never modify passwords, keys, tokens, sudoers or auth. Print what James must land.
- Never write a secret value into any file. Reference the env var name.
- Verify before reporting: run the thing, check is-active or the live URL, and say what you saw. "Should work" is not a report.
- One pass. Diagnose and fix together; never hand James a diagnosis and a question.
- Australian English. No em dashes; spaced hyphens or full stops.
- Report under 150 words: what changed, what you verified, anything left for James. Then stop.
