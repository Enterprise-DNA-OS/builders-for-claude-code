---
description: The variations register: what is proposed and waiting on a written yes, what is approved and claimable, what was declined. The margin killer of the industry, kept loud.
---

1. Run `npm run builders -- variations` (add `--all` for approved and declined too, `--job=` for one job).
2. Anything proposed is the headline: no variation work, and no claiming it, until it is approved in writing. Say how many days each has waited and what the unapproved pile is worth.
3. New change on site: `variation add <job> --description="what changes" --price=<price to the client> [--cost=<what it costs you>]`. Render the letter (`npm run docs`), a person sends it.
4. The client says yes in writing: `variation approve <VAR-ref> --by="who said yes, and how"`. That name is the evidence when the invoice is argued about. The contract ceiling rises the moment it lands.
5. The client says no: `variation decline <VAR-ref>`, and no work happens.
