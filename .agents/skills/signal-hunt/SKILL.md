---
name: signal-hunt
description: Finds net-new accounts that match the ICP and show fresh buying signals this week, then finds and verifies the right contacts. Use it to build a list for a new campaign.
---
1. Ask which client and how many accounts (default 25). Call `client_overview`.
2. Call `prospect_from_icp` with the limit. Drop anything marked suppressed.
3. For each new account, call `find_signals`. Then call `score_accounts` with those domains.
4. Keep Tier 1 and Tier 2 only. For each, call `find_people` with the buyer titles from icp.md (limit 2).
5. For each person, call `enrich_contact`. Keep `verified` emails. Flag `catch_all` and `risky` separately. Never use `invalid`.
6. Show a table: account, tier, strongest signal, contact, title, email status. Then the credits used from `spend_report`.
7. Stop at 100 rows and ask the user to check the list before doing more.
