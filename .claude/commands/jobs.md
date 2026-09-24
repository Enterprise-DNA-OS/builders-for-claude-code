---
description: The active jobs on one screen, with the money story per job: contract plus approved variations, claimed, owed, costs, committed, and any variations waiting on approval.
---

1. Run `npm run builders -- jobs` (add `--all` for quotes, completes and losses too).
2. Present the table as it comes. Call out anything in the "owed" or "vars?" columns: money claimed and not paid, and variations waiting on a written yes.
3. For one job's full card (budget vs actual, variations, claims, crew, schedule, diary): `job <ref>`.
4. Filters: `--type=new_build|renovation|extension|other`, `--client=<name>`.
