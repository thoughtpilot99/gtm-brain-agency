---
name: build-icp
description: Builds or rebuilds a client's ICP from closed-won and closed-lost deals using statistical lift, and files it for the owner to approve. Use it for a new client or when brain health flags ICP drift.
---
1. Ask which client. Check the client's data/ folder has closed-won.csv and closed-lost.csv (`read_brain` without a path). If not, tell the user the columns: company, domain, industry, employees, region, tech (separated by ;), signer_title, deal_value, closed_at.
2. Call `import_crm`, then `build_icp`.
3. Show the core traits as a table: dimension, value, wins, losses, lift, confidence. Then the traits to avoid.
4. Read out any warnings (for example fewer than 20 wins) plainly.
5. Tell the user the new icp.md is a proposal and the owner approves it in the web app (Approvals) or with `gtm approve`. Show the proposal id.
6. Never add a trait the statistics do not support.
