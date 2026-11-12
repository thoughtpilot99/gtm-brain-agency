---
name: brain-review
description: Weekly review of a client's brain - health score, pending approvals, which segments to run this week. Use it every Monday or before a client meeting.
---
1. Ask which client (or run it for every client from `list_clients`).
2. Call `brain_health`. List every check that is not passing with its fix.
3. Call `list_proposals` and summarise each pending change in one line with its diff size. Remind the user who the owner is.
4. Call `recommend_segments` and give the 3 segments to run this week with the reason for each.
5. Call `spend_report` and give credits used vs budget and the cache hit rate.
6. End with a short list of actions, owner first.
