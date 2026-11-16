# ENKYRON — manual B2B AI-agent security outreach (operator checklist)

**Scope:** Manual CRM records, one-to-one commercial email and follow-up. No automated prospecting, no consent inference, no assessment authority, no testing of a third party.

## 1. Company and contacts: evidence before entry

1. Search the existing CRM for duplicates before creating a company or contact.
2. Confirm trading name, **exact UK legal entity**, company number, active status, registered office and website independently (Companies House plus first-party company site). Record research date and source URLs in the company dossier.
3. Choose the primary sector for the company, not the vertical of its customers. An AI-agent supplier for banks belongs to *AI & Automation*, not automatically *Financial Services*.
4. Record named stakeholders only when current roles are publicly verifiable. Unverified personal email/phone fields stay blank.
5. A company's published shared email address must be stored as a **shared inbox / functional contact**. Never assign it as a person's private address or infer a guessed mailbox.
6. No contact's presence in CRM means marketing permission or consent was obtained. Respect objections and suppression requirements.

## 2. Create a genuine CRM-only opportunity

1. Record a concrete next action: recipient/role, intended security-assessment offer, document to prepare, internal review and expected follow-up. Use plaintext; paragraph breaks may be entered after the multiline-validation fix.
2. No prospective budget or win likelihood is invented. **Estimated win probability is Not estimated** until the operator deliberately checks *Record a manual estimate* and supplies a defensible number.
3. Do not create an assessment ticket, target access, authorisation, contract or invoice from prospect research alone.
4. Internal stages reflect facts: *Research* before contact; *Contacted* only after an actual outbound email or other recorded contact; *Discovery* only after real reciprocal discussion.

## 3. Quality gate for a commercial PDF

1. Align every claim with the current canonical ARL service documentation: human-led scope and authorisation, frozen target, inspection/evidence, applicability, **expressly authorised** controlled tests, human-reviewed findings, remediation and **exact retest**, report and final human decision.
2. Distinguish the **offered methodology** from technically demonstrated capabilities; do not claim end-to-end assessment or verified PASS/FAIL for unsupported closed-source remote agents.
3. Use customer-neutral language: no untested vulnerability allegation, no guarantee/certification, no invented case studies.
4. Render every page to an image and visually inspect at 100%; check margins, clipping, line wraps, typographic legibility, exact contact name, address, dates and version; inspect extracted PDF text and page count.
5. Open the final actual PDF in a PDF viewer, verify attachment file bytes/name and use only a tested file path. Do not label a preview image as the attached final brochure.

## 4. Prepare and send the email in ENKYRON

1. Select the real operator mailbox explicitly from *From*; in this setup the displayed sender is `guillaume.strohecker@agentrisklayer.com`. Do not invent aliases or conflate brand, legal entity or domain.
2. Choose a CRM contact from autocomplete. The **To** input must contain only the actual email, never `Person · Company <email>`. The contact/company association must remain correct.
3. Write a concise personalised introduction based on first-party public facts; offer asynchronous discussion **by email only** unless the operator changes this preference. Do not presume a phone, video call or meeting.
4. Review the full message, subject, address and actual attachment; explicitly approve **one** send.
5. Record `provider submitted/accepted` only from provider acknowledgement, `delivered` only from a separate confirmed provider delivery status. Neither means read or commercial interest. Never retry an uncertain submission blindly.

## 5. Follow-up and case disposition

1. Preserve the exact original opportunity action and append change events; do not rewrite the history of a sent message.
2. Change the stage to *Contacted* after a verified submission. If provider delivery is independently confirmed, record the source and time of that confirmation in a factual activity note.
3. Record a specific due date for **reviewing** whether to send a follow-up, not a promise to send automatically. If the prospect replies earlier, review that before further contact.
4. Keep win probability **Not estimated** until factual commercial qualification permits a defensible human estimate.
5. Avoid duplicate follow-ups, parallel messages to several contacts at one company and any outbound security probe without written Rules of Engagement.

## Regression defects and controls (16 Nov 2026)

- **ENK-CRM-OPP-001:** multiline Qt next-action editor rejected newline characters; backend now allows CR/LF with normalisation and maintains strict other-control rejection.
- **ENK-CRM-OPP-002:** literal `\\n` printed in two company-opportunity dialogs; corrected to real paragraph breaks.
- **ENK-MAIL-RECIP-001:** displayed `Name · Company <email>` in a single-address field; completer now inserts mailbox only, preserving the separately linked contact.
- **ENK-CRM-PROB-001:** optional forecast was hidden behind an obscure `-1` spinbox value and encouraged false precision; explicit *Record a manual estimate* checkbox now makes clearing straightforward.

**Safety:** Draft source changes do not alter the running ENKYRON desktop; approval, merge and a tested local installation are separate controlled steps. No production data is automatically edited.
