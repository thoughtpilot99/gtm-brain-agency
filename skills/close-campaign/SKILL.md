---
name: close-campaign
description: Writes a finished campaign into past-campaigns/ with results by segment and suggests brain updates. Use it at the end of every campaign and every Monday for last week's campaigns.
---
1. Ask which client and campaign. Get the results: either totals (sent, replies, positive replies, meetings, segment, angle, first email) or a per-recipient export saved in the client's data/ folder (columns: email, industry, employees, title, replied, positive, meeting).
2. Call `close_campaign` with the totals or `results_csv`.
3. Show the results by segment and the 3 recommendations (scale, test more, explore or stop) with their reasons.
4. If it created a proposal for icp.md, show the diff with `list_proposals` and tell the user the brain owner must approve it in the web app (Approvals) or with `gtm approve`.
5. Never change icp.md, rules.md or the skills directly. Suggest edits as proposals and wait for the owner.
