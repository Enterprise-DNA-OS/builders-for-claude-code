---
description: Nine rules from the Building Act, the Construction Contracts Act and the business's own standards, run against the live records, sources cited. The gates enforce the sharpest ones; this reports the rest.
---

1. Run `npm run builders -- compliance`.
2. Report it as it comes: FAIL rules first, each breach named with its record and the fix. The sources live in `docs/compliance.md`; cite them when the operator asks why a rule exists.
3. The gates already enforce the sharpest rules at the door, so a clean report is normal:
   - `job win` refuses $30,000+ work without a signed written contract date (Building Act 2004 s362F).
   - `claim` refuses anything past the contract plus approved variations (no force flag).
   - `assign` refuses expired insurance, and refuses restricted building work without an LBP number.
   - `job complete` refuses while claims are unpaid, variations undecided, or purchase orders open.
4. A breach on imported history is a finding, not a bug: the old system allowed what this one refuses. Fix the record (chase the contract, approve or decline the variation, release the retention) and the rule clears.
5. One rule alone: `npm run builders -- compliance <rule>`. Changing a threshold or adding a rule is a `/customise` job: the rule, the check and the doc move together.

Nothing here is legal advice. The rules are what this business has told the system to enforce, with the sources they came from.
