---
description: Render the variation approval letter for a proposed variation, in the business's brand, ready for the client's written yes. Drafts only, never sends.
---

1. If the variation is not on the record yet: `variation add <job> --description= --price= [--cost=]`.
2. Render it: `npm run docs -- variation-letter`. One HTML file per variation lands in `docs-out/variation-letter/`; print to PDF from the browser.
3. The letter carries the description, the price, and what the contract becomes if approved. The ask is one line: reply approving this variation and the work goes on the schedule.
4. Nothing about the variation is claimable, and no work starts, until the yes arrives. When it does: `variation approve <VAR-ref> --by="who said yes, and how"`, and log where the written approval lives.
