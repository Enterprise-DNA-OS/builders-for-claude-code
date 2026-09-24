# Moving off Buildxact

Buildxact (and the Buildertrend / CoConstruct family it sits in) holds three things you need back before anything else: your clients, your jobs with their contract values, and the cost history. All of them export, and one command brings them across.

## 1. Export from Buildxact

Buildxact exports a summary of its leads, estimates, jobs, contacts and clients screens to Excel, and each estimate or job costing exports from the settings cog on its screen. Save as CSV (XLSX saves as CSV from Excel):

- **Clients / contacts** with name, contact and email columns.
- **Jobs** with the job name, client, site address, type, status, contract or quote total, and dates. Note that Buildxact's list export ignores the on-screen filter and exports everything, which is exactly what you want here.
- **Costs** (actuals or invoices per job) with the job, cost category, supplier, invoice reference, amount and date.

If a report only prints, print it to CSV. The mapping below matches column names generously; the raw export is enough.

## 2. Dry run, then import

```bash
npm run builders -- import buildxact --clients=clients.csv --jobs=jobs.csv --costs=costs.csv --dry-run
npm run builders -- import buildxact --clients=clients.csv --jobs=jobs.csv --costs=costs.csv
```

The dry run prints exactly what the real run will create, update and skip; nothing is skipped silently. Then prove it landed:

```bash
npm run builders -- stats
npm run builders -- attention
npm run builders -- compliance
```

**The import is the first audit.** Two findings are normal and worth acting on the same day:

- An imported job at $30,000 or more with no contract signed date in the export. Section 362F of the Building Act wants paper behind each of those; chase the contracts and record the dates.
- Cost categories that arrive with no budget behind them (the costs came across, the estimates did not). Set real budgets with `budget add` before trusting the budget report, or export each job's estimate costings from Buildxact and enter the line budgets from there.

## What maps

| Buildxact | Here |
|---|---|
| Clients / contacts | `clients`, with contact and email |
| Jobs / leads | `jobs`, with client, site, type, status, contract value and dates |
| Estimate costings per job | `budget_lines` (you enter the line budgets: `budget add`) |
| Actual costs / invoices | `costs`, landing on a budget line by category name |
| Job statuses | quote / active / complete / lost, mapped generously |
| Quotes and estimates as documents | your paperwork re-renders from the data (`npm run docs`) |

Variations, claims and schedules generally start fresh: this system's gates (written approval before variation work, claims under the ceiling, insurance at the door) are guarantees about what happens from the day you switch, and half-imported workflow history weakens them. Keep the final Buildxact export as the archive of record (`export` here does the same job going forward).

## What deliberately does not carry over

- **Takeoffs and supplier price lists.** Buildxact's takeoff tool and dealer price feeds are its genuine moat for estimating. Keep using whatever you estimate with; the estimate's line totals land here as the budget, which is the part that runs the job.
- **Screen layouts and document templates.** The facts live on in the rows; the form builder does not. Your paperwork renders from `documents.json` in your brand, and new recurring questions become commands.
- **The client portal.** A client login is the incumbent's product. Here the client gets a rendered claim, a variation letter and a straight answer, which is what the portal was for.
- **Accounting sync.** Xero or MYOB stays your ledger. This is the job record; `export` hands your accountant clean JSON of every table, and a sync is a customisation Enterprise DNA builds when it earns its keep.

## The first month's cutover, in order

1. Import clients and jobs. Check the money story: `jobs --all`, `profit`.
2. Enter each active job's budget lines from its Buildxact estimate: `budget add`.
3. Record the live position: unpaid claims (`claim` with the real served dates via `--on=`), open variations (`variation add`), the crew (`add subbie`, `assign`, insurance dates).
4. Run the intake live from day one: `/attention` every morning, `/weekly-review` every Monday.
5. Keep Buildxact read-only for one billing cycle as the archive, then archive the export.
