---
description: The subbies register with the insurance and licensing state loud: who is expired, who is expiring, who carries an LBP number, and who is on which job.
---

1. Run `npm run builders -- subbies`. Expired insurance sorts first, on purpose.
2. Anyone EXPIRED or with no insurance on record who is on an active job is the headline: get the current certificate today or stand them down. Record it: `insurance <subbie> --expires=`.
3. Anyone expiring inside 30 days: chase the renewal certificate now, not the week it lapses.
4. One subbie's full card (assignments, billed to date, the log): `subbie <name>`.
5. Putting someone on a job: `assign <subbie> --job= --scope= [--price= --restricted]`. The CLI refuses expired insurance, and refuses restricted building work without an LBP number on record (`lbp <subbie> --number=`).
6. New trade: `add subbie "<name>" --trade= [--insurance-expires= --lbp=]`.
