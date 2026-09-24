---
description: The progress claims position: what is served and unpaid, what is overdue with the days counting, what has been paid. The Construction Contracts Act machine.
---

1. Run `npm run builders -- claims` (add `--all` for the full history, `--job=` for one job).
2. Overdue claims are the headline: name each one, the amount, the days overdue, and the client. The chase is a phone call today, logged (`log <PC-ref> "..."`), then the written reminder (drafts only).
3. New claim: `claim <job> --amount= [--due= or --terms=20]`. The CLI refuses any claim that takes the total past the contract plus APPROVED variations; if it refuses, the answer is a written variation approval, never a bigger number.
4. The claim paperwork renders with `npm run docs` (the progress-claim document); a person sends it.
5. Money lands: `paid <PC-ref> [--amount=]`. A short payment is said out loud and logged: short payment without a payment schedule is exactly what the Act exists for.
