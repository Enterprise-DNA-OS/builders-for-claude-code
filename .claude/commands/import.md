---
description: Bring the business across from Buildxact (or any system that exports CSV). Clients, jobs and cost history in one command, dry run first. The import is the first audit.
---

1. Read `docs/replace-buildxact.md` for what to export and how columns map.
2. Always dry run first, and show the operator what it says:
   ```
   npm run builders -- import buildxact --clients=clients.csv --jobs=jobs.csv --costs=costs.csv --dry-run
   ```
3. The dry run prints exactly what the real run will create, update and skip; nothing is skipped silently. If it looks right, run it without `--dry-run`.
4. Then prove it landed, in this order: `stats`, `attention`, `compliance`.
5. The import is the first audit. Two findings are normal and worth saying out loud:
   - Jobs at $30,000+ with no contract signed date in the export: s362F wants paper behind each. Chase the paper, record the dates.
   - Cost categories that arrived with no budget behind them: the old system's costs came across, its estimates did not. Set real budgets with `budget add` before trusting the budget report.
6. Anything skipped is listed with the reason. Fix the source rows or add the missing clients, then run the import again; it is idempotent where the export carries IDs.
