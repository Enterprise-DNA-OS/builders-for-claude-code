# The rule book `/compliance` runs

Nine rules, each with its source, each checked against the live records by `npm run builders -- compliance`. The CLI enforces the sharpest ones at the gate; the rest are checks that report. Change any of them to match your contracts: the rule, the threshold and the check live together (`/customise` edits both).

**None of this is legal advice.** These are the rules this business has told the system to enforce, with the sources they came from. What the law and your contracts actually require of you is between you, your lawyer and your contract administrator; the sections below are the reading list, not the reading.

## 1. Every dollar of cost sits on a won job and a budget line

**Source:** the discipline job costing exists for. Your accountant needs job-level costs at year end, and in any dispute the first question asked is what the job actually cost. The schema requires a budget line on every cost; this check catches costs booked to jobs never won.

**The check:** any cost whose job is still a quote or was lost.

**The gate:** `cost` refuses to land money on a job you have not won.

## 2. Every job at $30,000 or more has a signed written contract on record

**Source:** Building Act 2004, section 362F: residential building work of $30,000 (including GST) or more requires a written contract, and the prescribed checklist and disclosure information must be given to the client. The written contract is also simply what protects the builder when the money is argued about later.

**The check:** any active or complete job at $30,000+ with no contract signed date.

**The gate:** `job win` refuses, with no force flag. Breaches on this check are usually imported history: chase the paper, record the date.

## 3. No variation work without written approval

**Source:** every standard-form residential contract (Master Builders, Certified Builders, NZS 3902) requires variations agreed in writing before the work, and the Building Act 2004 consumer protection regime assumes it. Unwritten variations are the industry's margin killer and its commonest dispute: work done on a nod, argued about at the final account.

**The check:** any variation still proposed, with its value and days waiting.

**The gate:** `variation approve` requires the name of who said yes, and `claim` refuses to count unapproved variation value toward the ceiling.

## 4. Total claims never pass the contract plus approved variations

**Source:** Construction Contracts Act 2002: a payment claim is for work done under the construction contract. A claim past the contract ceiling invites a payment schedule dispute, and loses it, and burns the client relationship on the way through.

**The check:** any job whose total claims exceed contract value plus approved variations.

**The gate:** `claim` refuses, with no force flag. This check staying clean is the gate working.

## 5. No served claim sitting past its due date unchased

**Source:** Construction Contracts Act 2002: an unpaid payment claim past its due date, with no payment schedule served, is recoverable as a debt due, and the Act adds suspension and adjudication rights. Not chasing it is a gift of working capital to the client.

**The check:** any served claim past its due date, with the days counting.

**The gate:** none; chasing is a person's job. `/draft-claim-chaser` writes the firm, factual follow-up; a person sends it.

## 6. Every subbie on an active job carries current public liability insurance

**Source:** your own subcontract terms and every principal contract worth signing: trades on site carry current public liability. An uninsured subbie's incident lands on the builder, uncapped.

**The check:** any subbie assigned to an active job whose public liability is expired or not on record.

**The gate:** `assign` refuses, with no force flag. `insurance <subbie> --expires=` records the renewal.

## 7. Restricted building work is done or supervised by a Licensed Building Practitioner

**Source:** Building Act 2004, sections 84 to 87: restricted building work (primary structure, weathertightness, certain fire safety design) must be carried out or supervised by an LBP, and records of building work kept. Check numbers at lbp.govt.nz.

**The check:** any assignment flagged as restricted work where the subbie has no LBP number on record.

**The gate:** `assign --restricted` refuses without an LBP number. `lbp <subbie> --number=` records one.

## 8. Retention money is released or accounted for after handover

**Source:** Construction Contracts Act 2002 retention money regime (introduced 2017, strengthened 2023): retention money is held on trust, with records kept and available, and released when the contract says. Retention quietly kept past the defects period is trust money misused.

**The check:** any complete job still holding retention 60 or more days after completion. Change the 60 to your contracts' defects period.

**The gate:** none; release is a person's decision. `job complete` reminds you the moment retention survives handover.

## 9. No budget line spent past its budget without a decision

**Source:** this business's own standard. A line over budget has exactly three causes, and each has a different fix: scope creep is a variation to price to the client, a rate rise is the estimator's next quote, waste is the site's conversation. All three get worse with time, so the rule is a decision this week, never a surprise in the final account.

**The check:** any budget line on an active job where actual plus committed exceeds budget.

**The gate:** none, deliberately: costs are facts and refusing to record them helps nobody. `cost` and `po create` announce the moment a line goes over.
