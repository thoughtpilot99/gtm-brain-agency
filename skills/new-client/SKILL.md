---
name: new-client
description: Sets up a brain for a new client, from an empty folder to a scored account list. Use it when onboarding a client.
---
1. Ask for the client name and the name of the brain owner (the one person who approves changes). Tell the user to run `npm run gtm -- init "<name>" --owner "<owner>"` (or run it yourself if you have a shell).
2. Ask for the CRM exports and save them as data/closed-won.csv, data/closed-lost.csv and data/crm-contacts.csv in `workspaces/<client>/`.
3. Run the build-icp skill.
4. Fill offers.md, rules.md and one products/<name>.md per product from what the user tells you. Use `propose_brain_change` for each. Never invent proof: if the user has no nameable customer result, leave the section for them.
5. Save any call notes in call-notes/ with the buyer's exact words as `> quotes`.
6. Run the score-accounts skill, then `brain_health`, and list what is still missing.
