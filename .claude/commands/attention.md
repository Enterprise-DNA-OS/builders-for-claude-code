---
description: Everything that wants a decision this morning, worst first. Overdue payment claims, unapproved variations, uninsured subbies on site, blown budget lines, held retentions, cold quotes, floating purchase orders and late tasks.
---

1. Run `npm run builders -- attention`.
2. The list is already ordered by how much each item can cost. Read it in that order and do not reorder it by ease:
   - **An overdue payment claim** outranks everything. It is your money, and the Construction Contracts Act gives an unpaid claim real remedies. The action is a phone call today and a diary entry (`log <PC-ref> "..."`).
   - **An unapproved variation** is work someone may already be doing for free. Chase the written yes (`variation approve <ref> --by=`) or stop the work.
   - **A subbie with expired insurance on an active job** is uncapped risk today: get the certificate or stand them down (`insurance <subbie> --expires=`).
   - **A budget line OVER** is margin leaking now. Name the cause: scope creep is a variation to price, a rate rise is the estimator's problem, waste is the site's.
   - **Retention held after handover** is trust money. Check the defects period and release it or diarise the date.
   - **Cold quotes, claim gaps, floating POs, late tasks, quiet diaries** are money and evidence leaking quietly.
3. For each item, say the one action: the command to run, the person to ring, or the decision to make. Name who.
4. Anything that needs paper is drafted, never sent: `npm run docs`, a person sends.

If the operator asks "what should I do today", pick the top three and say why those three.
