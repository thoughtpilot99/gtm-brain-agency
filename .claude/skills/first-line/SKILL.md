---
name: first-line
description: Writes the first cold email for an account from its strongest buying signal, with every sentence checked against sources. Use it for every first email.
---
1. Ask which client and which account (domain) if not given. Call `client_overview` and `read_brain` for icp.md, offers.md and rules.md.
2. Call `account_detail` for the domain. If it has no signals, call `find_signals` first.
3. If no contact is given, call `find_people` with the buyer titles from icp.md and pick the most senior match. Skip anyone marked suppressed.
4. Call `write_email` with the domain and contact. Pass `angle` if the user named one.
5. Show the user the email, then the claim ledger: each sentence with the source ids it relies on, and any problems.
6. If the verdict is `blocked`, say exactly which sentence failed and why. Do not hand over a blocked draft as ready.
7. If the verdict is `needs_review`, list the lint warnings and offer a fix, then run `lint_copy` on the edited text.
8. Never add a fact, number or name that is not in the sources. Write "not found" instead.
