# veruslink.au

**Deploy rule (James's ruling, 1 Oct 2026): this site ships one way.** Commit here and `git push origin main`. Vercel builds production from GitHub `main` (project `veruslink-website`, veruslink account). Preview a change by pushing a branch.

- The one clone is `/root/.openclaw/sites/veruslink-website` on the VPS.
- Never `vercel --prod`, `vercel deploy`, or a `.vercel/` link in any folder. The JARVIS Wall refuses them for this site.
- Before touching it, read its row in `30-Ventures/ESTATE.md`.

This file is kept off the live site by `.vercelignore`.
