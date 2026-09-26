<h1 align="center">Builders for Claude Code</h1>

<p align="center">
  <strong>The open-source builder job costing system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Buildxact data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=buildxact">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/buildxact?utm_source=github&utm_medium=readme&utm_campaign=buildxact">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-buildxact-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-buildxact">Instead of Buildxact</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Builders for Claude Code does the job you pay Buildxact, Buildertrend or CoConstruct for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and run the building business in plain language. It runs the right query, and it can answer questions the incumbent's dashboard cannot.

Buildxact's own pricing page runs US$199 to $599 a month, $2,400 to $7,200 a year, and its family climbs from there: Buildertrend's top plan is over US$13,000 a year, and the estimating add-ons, the accounting connectors and the per-project extras stack on top. What a residential builder actually needs to hold is ordinary: the clients, the jobs from quote to handover, the budget the estimate becomes, the costs and purchase orders against it, the variations, the progress claims, the subbies with their insurance, and the schedule. That is eleven Postgres tables, and the job costing report the incumbent sells as the product is one SQL view over three of them.

This repo is that record over Postgres, with the asking done by the agent you already have:

```
/attention                        everything that wants a decision this morning, worst first
/pipeline                         the quotes out, going cold first
/jobs                             the active jobs with the money story per job
/job                              one job's whole card before any conversation
/budget                           budget vs actual vs committed, the line doing the damage named
/variations                       the register of the industry's margin killer, kept loud
/claims                           who owes you, the Act's clock counting
/subbies                          the crew, expired insurance sorted first
/schedule                         this week on site, late tasks loud
/profit                           margin by job, worst first
/compliance                       nine rules from the Acts and your own standards
/weekly-review                    the Monday review, written from three commands
```

The sharp edges are deliberate, because this is the industry where soft edges become disputes:

- **A quote at $30,000 or more does not become an active job without a signed written contract date.** Section 362F of the Building Act 2004 requires it, the CLI refuses without it, and there is no force flag.
- **A progress claim never passes the contract plus APPROVED variations.** The claim that ignores that ceiling is the payment schedule dispute you lose. If the work is real, the fix is the client's written yes, not a bigger number.
- **A subbie with expired public liability does not go on a job**, and restricted building work does not get assigned without an LBP number on record.
- **A job does not complete with loose ends.** Unpaid claims, undecided variations and open purchase orders block handover, because every one of them is money.

**Nothing here connects to a bank, IRD, the council or a client, and nothing sends.** Claims and letters draft to files in your brand; a person sends them. Nothing here is legal advice.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your job record sits in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No plan tiers, no add-ons, no per-project pricing. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/builders-for-claude-code.git
cd builders-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Harbourline Builds (a demo Tauranga residential builder with six clients, six jobs and a season going slightly wrong: an $88,000 progress claim ten days overdue, a $12,600 deck variation nine days without a written yes, an electrician mid-rewire with expired insurance, the framing line $15,400 over budget, $13,800 of retention still held after handover, and a $1.24m duplex quote going cold), then prints the attention list, the margin table and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/profit`, `/claims`, `job 101`, `budget JOB-101`, `subbie Brightline`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), especially whose written yes counts on a variation, and put your name and colours in [brand.json](brand.json) so every claim and letter carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A building company shares one database: each person clones the repo, points at the same `DATABASE_URL`, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: overdue claims outrank all. |
| `/pipeline` | The quotes out, going cold first, with the total the pipeline is worth. |
| `/jobs` | The active jobs with the money story: contract, claimed, owed, costs, committed. |
| `/job` | One job's whole card: budget, variations, claims, crew, schedule, diary. |
| `/budget` | Budget vs actual vs committed per line; the incumbent calls this job costing. |
| `/variations` | Proposed, approved and declined, with the unapproved pile valued and aged. |
| `/claims` | The claims position under the Construction Contracts Act, overdue first. |
| `/subbies` | The crew register: insurance state loud, LBP numbers on record. |
| `/schedule` | This week on site; every late task pushes the claim behind it. |
| `/profit` | Margin by job, worst first: the number the owner runs the business on. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Nine rules from the Acts and your own standards, run against your records, sources cited. |
| `/draft-progress-claim` | The payment claim paperwork, in your brand. Drafts only. |
| `/draft-variation-letter` | The variation approval letter the written yes replies to. Drafts only. |
| `/draft-claim-chaser` | The firm, factual follow-up for an overdue claim. Drafts only. |
| `/log` | The site diary: calls, delays, instructions, promises. In a dispute, the defence. |
| `/import` | Bring the business across from Buildxact or plain CSV. The import is the first audit. |
| `/customise` | Add a field, change a rule, rename things, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run builders -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # progress claims, variation letters, job cost reports
npm run view    # the builders board and the money pages, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your company's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser; the job cost report is the bank's and the client's question answered in advance. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached, each rule citing its source. The CLI enforces the sharpest ones at the gate: unsigned $30k+ work does not start, over-ceiling claims do not go out, uninsured subbies do not get assigned, jobs do not complete with loose ends.

1. Every dollar of cost sits on a won job and a budget line (the discipline job costing exists for).
2. Every job at $30,000 or more has a signed written contract on record (Building Act 2004 s362F).
3. No variation work without written approval (every standard-form contract; the industry's commonest dispute).
4. Total claims never pass the contract plus approved variations (Construction Contracts Act 2002).
5. No served claim sitting past its due date unchased (CCA 2002 statutory remedies).
6. Every subbie on an active job carries current public liability insurance (your subcontract terms).
7. Restricted building work is done or supervised by a Licensed Building Practitioner (Building Act 2004 ss 84 to 87).
8. Retention money is released or accounted for after handover (CCA 2002 retention trust regime).
9. No budget line spent past its budget without a decision (your own standard: name the cause this week).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your contracts.

## Ten questions Buildxact cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which claims are past their due date right now, how many days, and what did the client last promise?
2. What is the total value of variation work we are exposed on because nobody has approved it in writing?
3. Which subbie on which active site has expired public liability insurance today?
4. Which budget line on which job is doing the most margin damage, and is it scope creep, a rate rise, or waste?
5. Which active job has gone longest without a progress claim while costs kept landing?
6. How much retention are we holding past the defects period, job by job, and when should each have been released?
7. Which quotes are going cold, what is each worth, and what did the diary say the client was waiting on?
8. What is our real forecast margin per job type: new builds against renovations against extensions?
9. Which restricted building work on our sites has no LBP number recorded against it?
10. If this job ends in a dispute, what does the site diary actually say happened, week by week?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your business.

1. "Put our real clients and jobs in, with the contract values and signed dates."
2. "Put our logo and colours on the claims and the letters, and change the business name to ours."
3. "Our claims are due on the 20th of the month following, not 20 days. Change the default."
4. "Add a defects list per job: item, raised date, who fixes it, closed date."
5. "Import our Buildxact exports, then show me what the old system never told us."
6. "Add a compliance rule: no job starts without a building consent number on record."
7. "Track council inspections per job like the schedule tracks tasks."
8. "Build a page per client: their jobs, claims, what they owe, what they approved."
9. "When I serve a claim, render the paperwork in the same breath."
10. "Write a command that drafts the month-end work-in-progress summary for the accountant."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Buildxact

Export your clients, jobs and cost history from Buildxact (its leads, estimates, jobs, contacts and clients screens all export to Excel/CSV), run one command, and the record comes with you. Step by step, with what maps and what deliberately does not carry over: [docs/replace-buildxact.md](docs/replace-buildxact.md).

```bash
npm run builders -- import buildxact --clients=clients.csv --jobs=jobs.csv --costs=costs.csv --dry-run
npm run builders -- import buildxact --clients=clients.csv --jobs=jobs.csv --costs=costs.csv
```

The import is the first audit: a $30,000+ job with no contract signed date, or a cost category with no budget behind it, is loud the moment the import finishes.

## Architecture

```
builders-for-claude-code/
  CLAUDE.md                 how the business wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your company's name, logo and colours on every claim and letter
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/builders.mjs      the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-buildxact.md moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, no bank or council credentials, nothing that sends, and the contract, claim, insurance and completion gates stay.

## Want it installed and run for you?

Enterprise DNA installs Builders for Claude Code for your company, migrates your Buildxact data, writes your contracts' rules in as commands, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=buildxact
- Read more: https://enterprisedna.co/omni/instead-of/buildxact?utm_source=github&utm_medium=readme&utm_campaign=buildxact

## License

MIT. Copyright (c) 2026 Enterprise DNA.
