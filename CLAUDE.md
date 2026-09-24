# Builders for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR COMPANY], a residential builder in [region, New Zealand]
- **Operator:** [YOUR NAME], [owner / director / office manager]
- **The work:** [roughly what: new builds, renovations, extensions; how many jobs run at once]
- **The contracts:** [which standard form you build under: Master Builders, Certified Builders, NZS 3902, your own]
- **Who approves a variation:** [name them now: whose written yes counts, and where it usually arrives (email, signed quote)]
- **What matters most:** [for example: never an unapproved variation worked, every claim chased at due date plus one, margin known per job every Monday]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a job, a claim or a client, read the whole card first: `job <ref>`, `client <name>`, `subbie <name>`.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The industry's words, not software words: a job, a quote, a contract, a variation, a progress claim, a retention, a subbie, an LBP, a PC sum, practical completion.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or goes to a client, a subbie or the council waits for a yes in this session.
6. **Never invent a fact.** Contract values, dates, amounts and approvals come from the record. If a fact is missing, ask for that one fact.
7. **Never rule on the law.** This system records the dates and enforces the gates; whether a specific contract, claim or variation meets the Act is the operator's and their lawyer's call, never yours.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs a decision today | `/attention` |
| The quotes out, who to chase | `/pipeline` |
| A new enquiry to quote | `job add`, then `/pipeline` owns it |
| We won it | `job win <ref> --signed=<date>` |
| The active jobs, the money story | `/jobs` |
| One job, before any conversation | `/job` |
| Are we over budget, where | `/budget` |
| A cost or invoice to book | `cost <job> --line= --amount= --supplier= --invoice=` |
| An order to a supplier | `po create`; invoice lands: `po bill <PO-ref>` |
| The client wants a change | `/variations`, then `variation add` |
| The client said yes in writing | `variation approve <VAR-ref> --by=` |
| Bill the next stage | `claim <job> --amount=`, then `/draft-progress-claim` |
| Money landed | `paid <PC-ref>` |
| Who owes us, who to ring | `/claims` |
| Chase an overdue claim | `/draft-claim-chaser` |
| Put a subbie on a job | `assign <subbie> --job= --scope=` |
| A subbie's insurance renewed | `insurance <subbie> --expires=` |
| Who is on site this week | `/schedule` |
| A task finished | `task done <job> "<task>"` |
| How are we doing on margin | `/profit` |
| The Monday review | `/weekly-review` |
| Are we compliant, what would a dispute find | `/compliance` |
| The variation letter | `/draft-variation-letter` |
| Something happened on site | `/log` |
| Handover | `job complete <ref>` |
| Bring us over from Buildxact | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run builders -- help`) and then propose a new command for it.

## Hard rules

- **A quote at $30,000 or more does not become an active job without a signed written contract date.** The CLI refuses at `job win`, and there is no force flag: section 362F of the Building Act 2004 requires the written contract, and the contract is what protects this business when the money is argued about.
- **No variation work, and no claiming it, until the variation is approved in writing.** `variation approve` requires the name of who said yes; a progress claim never passes the contract plus APPROVED variations, and `claim` refuses with no force flag.
- **A subbie with expired or missing public liability insurance does not go on a job.** `assign` refuses. Restricted building work needs an LBP number on record first; `assign --restricted` refuses without one.
- **A job does not complete with loose ends.** Unpaid claims, undecided variations and open purchase orders block `job complete`, because every one of them is money.
- **Nothing here connects to a bank, IRD, the council or a client, and nothing sends.** Claims and letters render to `docs-out/`, drafts to `drafts/`; a person sends.
- **Never delete records.** Jobs are lost or complete, subbies become former, claims stay. The job record is this business's ten-year liability tail and, in a dispute, its defence.
- **Never invent a record.** If a name or a reference is ambiguous, list the candidates and ask. The CLI already does this.
- The database is the source of truth. If the answer is not in it, say so.

## Words this business uses

- A **job** runs quote, active, complete (or lost). The **contract value** plus **approved variations** is the ceiling every claim is checked against.
- A **variation** is a change to the contracted work: priced, put to the client, and approved **in writing** before the work happens. Unwritten variations are the industry's margin killer and its commonest dispute.
- A **progress claim** (payment claim) is served under the **Construction Contracts Act 2002**: it states the amount and the due date, and an unpaid claim past due carries statutory remedies. A **payment schedule** is the client's formal reply when they will not pay in full.
- **Retention** is money held back from a claim against defects, held on trust under the Act, released when the contract says.
- A **budget line** carries the estimate onto the job; **actual** is invoiced cost, **committed** is open **purchase orders**: money promised that no invoice has landed for yet.
- A **subbie** is a subcontracted trade. **Public liability** insurance current or they do not set foot on site. An **LBP** (Licensed Building Practitioner) must do or supervise **restricted building work**: primary structure, weathertightness, certain fire safety design.
- **Practical completion** is handover; the **defects period** runs after it; the final claim and the retention release bracket it.
- The **site diary** is the daily record: instructions, delays, weather, deliveries, promises. In a dispute it is the defence.

## Where things live

- `scripts/builders.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-buildxact.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` whole database dumps. `drafts/` and `docs-out/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/buildxact
