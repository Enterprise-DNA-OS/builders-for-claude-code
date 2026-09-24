---
description: The quotes out the door, going cold first. What the pipeline is worth, which quote needs the phone call, and how to record a win or a loss.
---

1. Run `npm run builders -- pipeline`.
2. Present it as it comes: coldest first, with the total value in the heading. A quote past 14 days without a decision gets named for a follow-up call today.
3. When one is won: `job win <ref> --signed=<date the contract was signed>`. The CLI refuses $30,000+ work without the signed date, and that is the Building Act, not pedantry. Then build the budget line by line: `budget add <ref> --code= --name= --budget=`.
4. When one is lost: `log <ref> "who went where and why"` so the pricing lesson is on the record, and update the job honestly.
5. New enquiry: `job add "<name>" --client= --value= [--type= --site=]` (add the client first if they are new: `add client`).
