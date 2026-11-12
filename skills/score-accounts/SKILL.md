---
name: score-accounts
description: Tiers a client's accounts 1 to 3 against the ICP and fresh buying signals, with a reason for each tier. Use it before building any list or campaign.
---
1. Ask which client if not given. Call `client_overview`. If there is no ICP, run the build-icp skill first.
2. If there are no accounts, call `prospect_from_icp` (or ask the user for a target-accounts.csv in the client's data/ folder and call `import_crm`).
3. Call `score_accounts` with `refresh_signals: true` and `one_batch: true`. This scores the first 100 accounts only.
4. Call `top_accounts` and show the Tier 1 list as a table: account, score, fit, intent, top 3 reasons.
5. Ask the user to check the batch. Only after they agree, call `score_accounts` again without `one_batch` to finish the rest (it resumes where it stopped).
6. Report the tier counts, how many accounts were suppressed (customers, open deals, do-not-contact) and the credits used (`spend_report`).
