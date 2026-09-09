# Contact Extractor
## Technical White Paper

**A usable contact list is a classification problem, not an export problem**

**Organization:** Right&Above  
**Version:** 1.0  
**Publication date:** September 2026  
**Document status:** Public technical white paper  
**Source:** MIT-licensed desktop application

A reasoned approach to extracting real correspondents from an IMAP mailbox without uploading the mailbox to a third party.

Contact Extractor is a local desktop application that connects to an IMAP server, walks the folders the user selects, and keeps the people they actually correspond with — filtering out newsletters, robots and internal traffic — then exports the result to XLSX or CSV. This paper argues that the failure mode in mailbox-to-CRM work is not a missing “export contacts” button. It is the absence of an executable definition of *who counts as a contact*, applied on the machine that already holds the mail.

---

## Contents

1. Abstract
2. The problem in industry context
3. What would have to be true for a contact list to be trustworthy
4. Approach
5. Who does what
6. Architecture, as a consequence of the approach
7. Evidence from the implementation
8. Scope, applicability, and limits
9. Conclusion
10. Notes and sources

## Executive Summary

Mailbox extraction is often treated as a unique-address dump: collect every `From` and `To`, drop duplicates, import the rest into a CRM. In practice the difficult part is deciding, for each address, whether it is a person you correspond with — under rules you can state, change, and defend — without sending the mailbox to a vendor.

This paper presents a narrower alternative to a cloud contact-enrichment product: a desktop IMAP client whose only network path is outbound IMAP to the user’s own server. Its central design principle is that **a contact is a classified relationship**, not an address that appeared once. Bidirectionality, excluded domains, automation headers, and automation local-parts are represented as data and applied by a deterministic classifier.

The system tags every address `kept` or `filtered:*` with a reason. Message headers are cached in a local SQLite database. Bodies are fetched only if the user enables that option, then truncated and encrypted through the OS keystore. The renderer is sandboxed. Nothing is inferred by a model.

The paper is intentionally not a claim of customer ROI or measured CRM conversion. Its evidence is the classification model, automated tests, architecture, and the public source repository.

## Abstract

A working mailbox is a poor address book. Most of what arrives is automated: list traffic, bounce daemons, billing robots, “noreply” senders, calendar invites. The Radicati Group’s *Email Statistics Report, 2024–2028* puts worldwide email traffic at **361.6 billion messages sent and received per day in 2024**, forecast to **424.2 billion by 2028**.[1] A unique-address export of that stream is not a contact list. It is a dump of every machine that was allowed to write to the inbox.

Cloud extractors can replace the dump. They solve a different job. They require the mailbox — or a sync token — to leave the building. They encode a vendor’s idea of a “good lead.” They rarely let the user state, as data, that `example.com` is internal, that `support@` is a robot unless the list is edited, or that a contact is kept only when there is at least one inbound and one outbound message in the folders actually scanned.

This paper analyses that gap and describes a narrower design. Classification is the unit of computation. A contact is kept only when no disqualifying rule fires. Bidirectionality is a threshold, not a slogan. Automation is a per-message property that becomes a contact decision only if *every* sampled message is automated — one human message rescues the address. Domain exclude/include lists are applied before an address enters the result table. The application is not a CRM. It does one job: decide who, in this mailbox, is a correspondent, and export that table.

---

## 1. The problem in industry context

### 1.1 A contact is a relationship, not a header

An email address in a mailbox is not, by itself, a business contact. It is a string that participated in at least one message. A usable list has four moving parts:

1. **Direction** — whether mail went in, out, or both, inside the folders the user chose to scan.
2. **Scope** — which domains are counterparties and which are “us.”
3. **Automation** — whether the traffic is a person or a machine (headers, local-part, optional body unsubscribe).
4. **Explainability** — why a row was kept or dropped, so the next import is not an argument about a black box.

If any of those four is computed in a different place — a CRM deduper, a spreadsheet filter, a vendor model — the organisation no longer has one list. It has several plausible lists. That is the operational failure. The institutional failure is worse: when someone asks “why is this address in the export?”, there is no reconstructable reason.

This is why “we exported unique senders” does not solve contact extraction. An export captures presence. It does not apply a definition.

### 1.2 The volume is large enough that informal methods do not scale

Email is not a rare channel that a person can babysit. Radicati’s public executive summary of the 2024–2028 report counts **361.6 billion** messages a day in 2024 and **4.48 billion** email users, rising toward **424.2 billion** messages and **4.97 billion** users by 2028.[1] Microsoft’s 2025 Work Trend Index special report, *Breaking Down the Infinite Workday*, puts Microsoft 365 knowledge workers at **117 emails a day**.[2] A professional mailbox of a few years is tens or hundreds of thousands of messages. Informal methods — scrolling Sent, copying From lines, filtering `noreply` by eye — fail at that frequency long before they fail at “does anyone remember who we actually talk to.”

The growth is not only human correspondence. List traffic, transactional mail and bounce handling are first-class parts of the protocol: `List-Id`, `List-Unsubscribe`, `Auto-Submitted`, `Precedence: bulk|list|junk` exist because the industry already knew that not every message is a person talking to a person.[3][4] A contact extractor that ignores those headers will treat a newsletter as a lead.

### 1.3 Cloud extractors solve a broader job, and miss this one

The obvious alternative to a local scan is a SaaS that “connects Gmail and builds your CRM.” For organisations that want enrichment, sequencing and a hosted pipeline, that is the right purchase. For organisations that already have IMAP, already have a CRM, and need a *defensible* list of counterparties, it is often the wrong one, for three structural reasons.

**The mailbox leaves the machine.** Email is personal data. Handing a sync token or an uploaded MBOX to a vendor is a residency and access decision, whether or not the organisation has named it as one.[5]

**The definition of “contact” is the vendor’s.** Bidirectionality, role addresses, and internal domains become sliders in someone else’s product — or disappear into a model. The user cannot put the rule next to the row.

**Identity is a cloud account.** OAuth to a consumer mailbox is convenient. It is also a second identity system, and it excludes servers that only speak IMAP username and password. Contact Extractor’s constraint is the opposite: IMAP credentials only; Gmail and Outlook.com need an app password; token-only mailboxes cannot be connected.

None of this is an argument that CRM platforms are poorly built. It is an argument that **contact extraction, done correctly, is a classifier with an IMAP client**, not a screen in a general sales suite.

### 1.4 Why not a unique-address spreadsheet?

The alternatives are not equivalent because they optimise for different jobs.

| Requirement | Unique-address dump | Cloud extractor / CRM import | Contact Extractor |
| --- | --- | --- | --- |
| Mailbox stays on the user’s machine | Yes | No | Yes |
| Executable keep/drop rules | Fragile filters | Product-dependent | Yes |
| Bidirectionality as a first-class threshold | Manual | Product-dependent | Yes |
| Reason tagged on every dropped row | Weak | Product-dependent | Yes |
| Automation headers (`List-*`, `Auto-Submitted`, `Precedence`) | Rarely | Product-dependent | Yes |
| User-editable local-part and domain lists | Possible | Product-dependent | Yes |
| No model inference | Yes | Often no | Yes |

This is positioning, not a claim that every CRM lacks these capabilities. The relevant distinction is that the extractor makes them the centre of the design rather than features surrounding a broader sales platform.

## 2. What would have to be true for a contact list to be trustworthy

A contact list is trustworthy when a competent outsider can answer four questions from the system of record, without asking a person:

| Question | What “good” looks like |
| --- | --- |
| Who is on the list? | Addresses that passed an explicit keep/drop function. |
| Why is this address on it? | A tag: kept, or `filtered:not-bidirectional`, `filtered:automation-localpart`, `filtered:all-messages-automated`. |
| Why is this address *not* on it? | Either a classifier reason, or a hard drop at aggregate (excluded domain, failed include-whitelist) so it never enters the table. |
| What left the machine? | IMAP to the user’s server. No telemetry, no cloud classify, no auto-update. |

Those questions imply design constraints. They are worth stating before the product, because they are the reasons the product is shaped the way it is.

1. **The definition must be executable.** A policy that exists only as “we skip newsletters” will be re-implemented, wrongly, in the next spreadsheet. Thresholds, header checks, local-part lists and domain lists have to be data that a deterministic function can apply.
2. **Bidirectionality must be first-class — or explicitly off.** If Sent is not in scope, outbound counts are zero and a bidirectional rule will keep nobody. That is correct behaviour, not a bug. The user can switch the rule to one-directional or off. The rule must not silently count folders that were not selected.
3. **Automation is per-message, then per-contact.** A single `List-Unsubscribe` must not condemn an address that also sent a human reply. The contact is automated only if every sampled message is automated. One legitimate message rescues them.
4. **Internal is a list, not a guess.** Subdomain match (`dev.example.com` when `example.com` is listed), not a suffix collision (`evilexample.com`). Empty by default; filled in on the Scan screen.
5. **The mailbox does not leave the device.** Classification runs in the local main process. The renderer cannot open a raw IMAP socket. Bodies, if stored, are encrypted with the OS keystore and capped.
6. **A change to the lists is a scan input, not a hidden override.** Removing `support` from the automation local-parts is how a helpdesk address becomes a contact. There is no silent “you replied, so we keep it” exception unless that exception is written as a rule and tested. In this implementation, reply does not rescue an automation local-part.

If a design violates any of these, it will recreate the unique-address dump with a nicer UI.

## 3. Approach

Contact Extractor is a desktop application (Electron) for people who already have an IMAP mailbox and need a table of counterparties they can export. It is not a CRM, not a mail client, and not a cloud service. Sign-in is IMAP username and password. There is no OAuth flow.

The rest of this section is the reasoning, not the feature list.

### 3.1 Classification is the unit of computation

A contact is kept only when **no** disqualifying rule fires. The reasons are a closed set:

- `not-bidirectional` — fails the inbound/outbound/total thresholds;
- `automation-localpart` — the local part matches the configured list (or the `noreply-` / `no-reply-` prefix);
- `all-messages-automated` — every sampled message carries automation signals.

Default bidirectionality is at least one inbound, one outbound, and two messages in total. The Scan screen can set `bi`, `one`, or `off`. Domain exclude/include is applied at aggregation, *before* an address enters the result table: an excluded domain is not tagged; it is absent.

Default automation local-parts include `noreply`, `bounce`, `mailer-daemon`, `support`, `billing`, `calendar`, and related names. The list is editable per scan. Prefixes `noreply-*` and `no-reply-*` always match.

### 3.2 Direction is derived from the selected folders

The user’s own addresses are derived from Sent-folder `From` lines, not typed in as a second identity. Each message is `in`, `out`, or `self`. Counts that feed bidirectionality come only from folders included in the run. Selecting INBOX alone yields `countOut = 0`; the bidirectional rule then keeps nobody. That is the cost of not lying about scope.

### 3.3 Automation headers are a published protocol, not a heuristic vibe

A message is flagged automated when any of the following is true: `Auto-Submitted` present and not `no`; `Precedence` is `bulk`, `list` or `junk`; `List-Unsubscribe` present; `List-Id` present; or, if bodies are parsed, an inline unsubscribe instruction (a cue such as `reply`/`send`/`email` near the word `unsubscribe`).[3][4]

`Auto-Submitted: no` is not automated. That distinction is tested.

### 3.4 Email identity is conservative

Addresses are trimmed and lowercased. Gmail-style dots and plus-tags are **not** aliased. Collapsing `j.smith+list@gmail.com` into `jsmith@gmail.com` would merge people the user did not ask to merge. The function that would make the list “cleaner” would make it less true.

Domain lists match the exact domain or a subdomain. A listed `example.com` matches `dev.example.com`. It does not match `evilexample.com`.

### 3.5 Privacy is a consequence of the job, not a badge

The only intended network path is outbound IMAP. There is no telemetry and no auto-updater. Headers live in `{userData}/contact-extractor.db`. Bodies are stored only with “Parse message bodies,” truncated at 256 KB, and encrypted with `safeStorage` (Keychain, DPAPI, libsecret). If the OS cipher is unavailable, bodies are not written in plaintext. Cache wipe clears messages, folders, addresses and bodies; it keeps saved accounts (still encrypted) and settings.

The renderer runs with `contextIsolation`, no Node integration, and `sandbox: true`. IPC is validated with zod on both ends. The CSP blocks remote scripts.

## 4. Who does what

The product surface follows the constraints in section 2. It is included here so the approach can be evaluated against the actual jobs, not against an abstract architecture.

| Who | What they do |
| --- | --- |
| Operator | Enters IMAP host, port, TLS, username and password; optionally stores the password in the OS keystore; chooses folders and filters; runs a scan; inspects kept/filtered rows; exports XLSX or CSV. |
| Classifier (local) | Aggregates addresses from the selected folders, applies domain lists, then keep/drop rules with a reason tag. |
| OS | Encrypts remembered passwords and optional body blobs. Does not see a cloud copy of the mailbox. |

There is no second user role inside the app. There is no shared tenant.

## 5. Architecture, as a consequence of the approach

The stack is an Electron desktop app. Secrets stay in the OS keystore and in environment unused by the product; this paper does not describe any specific mailbox.

| Layer | Choice | Why it is in this paper |
| --- | --- | --- |
| Shell | Electron 33, electron-vite | One local process owns IMAP and SQLite; the UI cannot. |
| UI | React, Material UI, Redux Toolkit, redux-observable | Connect → Scan → Results. No public site. |
| Bridge | Preload `contextBridge`, zod contracts | Constraint 5: the renderer does not get a raw IMAP handle. |
| Mail | IMAP (imapflow), connection pool | Username/password only; no OAuth. |
| Data | SQLite (better-sqlite3), WAL | The mailbox cache is a local file, not a vendor database. |
| Classify | Pure functions over aggregates | Constraint 1: the same rules are unit-tested without IMAP. |
| Export | XLSX (exceljs), CSV | The output is a table, not a CRM record. |

Two properties are load-bearing.

**The browser does not decide who is a contact.** It displays tags the main process wrote. A crafted renderer cannot keep an excluded domain.

**The classifier is testable without a mailbox.** Bidirectionality, domain matching, local-parts, automation headers, inline unsubscribe, and the “one human message rescues them” rule are specification tests. That is the evidence that “classification is executable” is not a slogan.

Pipeline phases, in order: connect; list folders; derive `myAddresses` from Sent; ingest headers (batched); optional body pass; aggregate; classify; disconnect.

## 6. Evidence from the implementation

A design paper that never touches the artefact it describes is a prospectus. Two kinds of evidence are available here: that the rules exist as tested code, and that the public tree is the same product this paper describes.

### 6.1 Domain rules as tests

The classifier’s core is expressed as small functions and exercised by specification tests. Examples of claims those tests pin down:

- Bidirectionality requires the configured inbound, outbound and total thresholds; `off` collapses them to a tautology.
- A domain list matches subdomains and rejects suffix lookalikes.
- `Auto-Submitted: no` is not an automation header; `List-Unsubscribe` and `List-Id` are.
- A contact is `all-messages-automated` only if every sampled message is automated; one non-automated message keeps them out of that bucket.
- Default local-parts such as `support@` are `filtered:automation-localpart` even when the user replied; removing `support` from the list is what keeps the address.
- Email normalisation does not collapse Gmail dots or plus-tags.

That is the standard of evidence this paper can honestly offer for the approach in section 3: the rules are written down, and a failing change is a failing test. It is not a field study of CRM win-rates after import. Organisations evaluating the system should treat the public repository and the test suite as the primary artefacts, and this paper as the argument for why those artefacts are shaped that way.

### 6.1.1 Representative verification cases

| Case | Input condition | Expected invariant |
| --- | --- | --- |
| Bidirectional default | One in, one out, selected folders include Sent | Contact can be kept if no other rule fires |
| INBOX only | Sent not in scope | Outbound count is 0; `bi` keeps nobody |
| Newsletter | Every message has list headers | `filtered:all-messages-automated` (or not-bidirectional if one-way) |
| Mixed sender | Nine list messages and one human message | Not condemned solely as all-messages-automated |
| Excluded domain | Domain or subdomain on the exclude list | Address never enters the addresses table |
| Automation local-part | `noreply@` / `support@` on the default list | `filtered:automation-localpart` |
| List override | `support` removed from the local-part list | `support@` can be kept |
| Normalisation | `j.smith+tag@gmail.com` | Not merged with `jsmith@gmail.com` |

A production evaluation should run these cases against the published test suite (`tests/main/classifier/**`, `tests/main/pipeline/scan-runner.test.ts`).

### 6.2 What this paper does not treat as evidence

There is no Application Assembly Pipeline share figure for this product, and this paper does not invent one. Internal benchmark notes exist for large synthetic mailboxes; they are engineering observations, not a published SLA. The honest reading is: the cost of a trustworthy contact list is the classifier, not the Electron ritual around it.

## 7. Scope, applicability, and limits

**Who should use it.** People and firms who already have IMAP (including self-hosted and app-password mailboxes), want a local extract of real counterparties, and will take a spreadsheet or a CRM import *after* the keep/drop decision — not instead of it.

**Who should not.** Organisations that need OAuth-only consumer mail with no app-password path. Organisations that want enrichment, sequencing, or a hosted CRM in the same product. Organisations whose real rule is “sales decides who is a lead” and cannot be stated as thresholds and lists.

**What this paper does not claim.** It does not claim a measured lift in pipeline quality at a named customer. It does not claim that every newsletter is detected (plain conversational mentions of “unsubscribe” are deliberately not enough). It does not describe a specific mailbox, password, or deployment. The MIT-licensed source is the public artefact; this paper is the argument.

## 8. Conclusion

Contact lists go wrong when presence, relationship and policy live in different places. Unique-address dumps keep presence that cannot explain itself. CRM imports keep a vendor’s idea of a lead. Cloud extractors keep a copy of the mailbox.

The approach argued here is narrower. Make the definition executable. Count direction only in the folders that were scanned. Treat automation as a message fact that aggregates honestly. Keep internal domains as a list. Keep the mail on the machine. Tag every drop with a reason.

A white paper should be judged by whether a reader can disagree with the argument. The disagreement worth having is this: either a contact is an address that appeared, in which case a unique-From export is enough, or a contact is a classified relationship, in which case the classification has to live in one place, with a name on every drop.

---

## Notes

## References and Public Artefacts

MIT-licensed source: https://github.com/raa-org/email-contact-extractor

1. The Radicati Group, *Email Statistics Report, 2024–2028*, Executive Summary (December 2024). 361.6 billion emails sent and received per day in 2024; 4.48 billion email users; forecast 424.2 billion messages per day and 4.97 billion users by 2028. https://www.radicati.com/wp/wp-content/uploads/2024/10/Email-Statistics-Report-2024-2028-Executive-Summary.pdf
2. Microsoft, *Breaking Down the Infinite Workday*, Work Trend Index Special Report (2025). 117 emails per day for Microsoft 365 knowledge workers. https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday
3. J. Palme, A. Murchison, *Recommendations for Automatic Responses to Electronic Mail*, RFC 3834 (IETF, July 2004), `Auto-Submitted`. https://www.rfc-editor.org/rfc/rfc3834
4. J. Levine, R. Gellens, *Signaling One-Click Functionality for List Email Headers*, RFC 8058 (IETF, January 2017); see also RFC 2369 (`List-Unsubscribe`, `List-Id`). https://www.rfc-editor.org/rfc/rfc8058
5. Regulation (EU) 2016/679 (General Data Protection Regulation). Email addresses used to identify a person are personal data; transferring a mailbox to a processor is a disclosure that needs a lawful basis and appropriate safeguards.
