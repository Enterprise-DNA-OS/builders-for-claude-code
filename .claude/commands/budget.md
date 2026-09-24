---
description: Budget vs actual vs committed for one job, line by line, with the over and near lines loud. The report the incumbent calls job costing.
---

1. Run `npm run builders -- budget <job>`.
2. Present the table, then the totals line. Committed is open purchase orders: money promised that no invoice has landed for yet. A budget report that ignores committed money lies to you for a month.
3. Any line OVER: name the number and ask which of the three causes it is, because each has a different fix:
   - **Scope creep**: price it as a variation today (`variation add`), it is the client's cost, not yours.
   - **A rate or price rise**: the estimator's next quote needs the new rate; log it.
   - **Waste or rework**: the site's problem; log what happened while people remember.
4. Costs land with `cost <job> --line= --amount= --supplier= --invoice=`. Committed money lands with `po create`; the invoice closes it with `po bill <PO-ref>`.
