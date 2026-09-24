---
description: Render the progress claim paperwork for a served claim, in the business's brand, ready for a person to check and send. Drafts only, never sends.
---

1. If the claim does not exist yet, serve it first: `claim <job> --amount= [--terms=20]`. The CLI enforces the contract ceiling; do not argue with it, fix the variation approvals instead.
2. Render it: `npm run docs -- progress-claim`. One HTML file per claim lands in `docs-out/progress-claim/`; open the right one, print to PDF from the browser.
3. Check it reads like a payment claim should: the amount, the job, what has been claimed to date against the revised contract, the due date, and the approved variations listed. That context is what makes the claim hard to argue with.
4. If the operator wants a covering email, draft it to `drafts/` in plain language: the claim number, the amount, the due date, one sentence on what was done. A person sends it.
5. Log that it went out once the operator sends it: `log <PC-ref> "served by email to ..."`.
