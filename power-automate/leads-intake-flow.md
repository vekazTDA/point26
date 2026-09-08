# Point26 leads intake — Power Automate flow

Not part of the site build — nothing in this repo runs this flow. It documents what was
built in **make.powerautomate.com** so a future edit doesn't mean reverse-engineering it
out of Microsoft's UI. The flow itself lives entirely in the Microsoft 365 tenant.

`netlify/functions/submission-created.mjs` POSTs every accepted form submission here —
the same fan-out it already does to Slack. Google Sheets was the original plan and was
replaced by this before anything was deployed on that side; no Google artifacts remain.

**This flow is built and saved.** The sections below describe what exists, not a plan.
Where reality diverged from the original design, the divergence is called out — those
notes are the expensive part to rediscover.

## What exists today

| | |
|---|---|
| Flow name | **Point26 Leads Intake** |
| Environment | Digital Artistry (default) — `Default-96fac87b-7a37-433d-a829-f0e38e2564f3` |
| Flow id | `c5ba6c96-8f93-4b9d-9167-0da003884ba0` |
| Owner / connection | `vekaz@itsda.com` |
| Workbook | **Point26 Leads Sheet.xlsx** |
| Workbook location | `julia@itsda.com`'s OneDrive root, **not** the flow owner's drive |
| Licence | Power Automate **Premium**, 90-day trial activated 2026-09-08 |

### The Premium licence is not optional

The **When an HTTP request is received** trigger is a premium connector. Without a
Premium licence the flow saves but refuses to run, with:

> Your flow is saved but can't be used.

A 90-day Premium trial was started from the flow checker's *free 90-day trial* link,
which cleared it. **That trial expires around 2026-12-07** — after which this flow stops
firing until a Premium licence is assigned. Put a reminder somewhere that isn't this file.

## 1. The Excel workbook

One workbook, **Point26 Leads Sheet.xlsx**, holding three sheets, each with a real Excel
**Table** object (the connector's "Add a row into a table" action requires a Table, not a
plain range).

| Sheet tab | Table name | Columns |
|---|---|---|
| `Sheet1` | `ContactTable` | 11 — see gap below |
| `Sheet2` | `IsoTable` | 19 |
| `Sheet3` | `NewsletterTable` | 14 |

Two things differ from the original design and are worth knowing:

- **The sheet tabs were never renamed** — they are still `Sheet1`/`Sheet2`/`Sheet3`.
  Functionally irrelevant: the flow addresses tables by table name, never by tab name.
- **The header rows do not start at row 1.** `ContactTable`'s headers sit in **row 3**.
  Also irrelevant to the flow — a Table can start anywhere — but it surprises you when
  you open the file.

> **Widening a Table later.** `ContactTable` was originally built 9 columns short and had
> to be extended. Typing the new headers into the cells beside a Table is *not* enough:
> Excel Online often does **not** auto-extend the Table object on paste, so the cells hold
> the headers while the Table still ends where it did. The connector reads the *Table*,
> not the sheet, so the new columns stay invisible to the flow. Fix with **Table Design →
> Resize Table** over the full range, then re-select the table in the flow's action so the
> connector re-reads the schema.

## 2. The flow

**Trigger — When an HTTP request is received.**

> **`Who can trigger the flow?` must be `Anyone`.** This is not a security preference, it
> decides which *kind of URL* the trigger issues, and the default is wrong for this use:
>
> - **Any user in my tenant** (the default) issues a Direct-API URL —
>   `…/powerautomate/automations/direct/…?api-version=1` — which requires an Entra **OAuth
>   bearer token** on every call. `postToExcel` sends a plain unauthenticated POST, so
>   every request dies at the gateway with `401 DirectApiAuthorizationRequired`
>   ("The OAuth authorization scheme is required"), and **no flow run is recorded at
>   all** — the run history stays empty, which makes it look like the webhook was never
>   called.
> - **Anyone** issues the SAS-signed URL, whose query string carries `sp`, `sv` and
>   **`sig`**. That one works with a plain POST.
>
> Quick check: if `LEADS_EXCEL_WEBHOOK_URL` has no `sig=` in it, it is the wrong URL.
> Changing this setting **reissues the URL**, so Netlify's variable must be updated and
> the site redeployed afterwards.

The Request Body JSON Schema was generated from this sample —
the union of every field across all three forms, so every column has a usable token
regardless of which form submitted:

```json
{
  "form_name": "contact",
  "data": {
    "name": "Test Lead",
    "email": "test@example.com",
    "phone": "555-0100",
    "company": "Acme",
    "companyType": "ISO",
    "address": "1 Main St",
    "intent": "project",
    "message": "Sample message",
    "documents": "",
    "page": "",
    "landing": "https://point26cap.com/contact",
    "referrer": "",
    "utm_source": "meta",
    "utm_medium": "paid-social",
    "utm_campaign": "sample",
    "utm_content": "",
    "utm_term": ""
  }
}
```

Saving the flow generates the trigger's **HTTP POST URL**. That value is
`LEADS_EXCEL_WEBHOOK_URL` in Netlify — see §3. It is a bearer credential in URL form:
anyone holding it can write rows. It is deliberately not recorded in this repo.

### Route by form — Switch

A **Switch** control on:

```
triggerBody()?['form_name']
```

with three cases — `contact`, `iso-application`, `newsletter` — and an empty **Default**,
so an unrecognised form name is ignored, matching the Netlify function's own behaviour.

> **Gotcha that costs an hour.** Typing that expression as plain text into the Switch's
> *On* field looks fine in the designer but fails on save with:
>
> > The property 'expression' 'triggerBody()?['form_name']' of template action 'Switch' …
> > is not a valid template language expression.
>
> It must be entered through the **fx / expression editor** (the little `fx` button on the
> field), which is what wraps it correctly in the saved definition. Same applies anywhere
> an expression is the *whole* value of a control field.

### Inside each case — Excel Online (Business) → Add a row into a table

All three actions share the same file coordinates:

| Field | Value |
|---|---|
| Location | `https://digitalartistry816-my.sharepoint.com/personal/julia_itsda_com` — typed via **Enter custom value** |
| Document Library | `OneDrive` |
| File | `01NSKHR3PIUUVH5LAZXFD3KHF23SAVR2E7` — the driveItem id, typed directly |
| Table | `ContactTable` / `IsoTable` / `NewsletterTable` |

> **Gotcha, and the reason for those odd values.** Because the workbook lives in
> *another user's* OneDrive, the connector's file **browser cannot reach it** — the picker
> only lists your own drives and the SharePoint sites you belong to, and the one file it
> did offer was unrelated. Typing a filename or a path (`/Point26 Leads Sheet.xlsx`,
> `/Documents/Point26 Leads Sheet.xlsx`) into the File field fails with Graph
> `itemNotFound`: the field wants a **driveItem id**, not a path.
>
> The id above was obtained out-of-band, by reading the drive's root listing through
> Microsoft Graph. If the file is ever moved, renamed into a different drive, or
> re-created, **this id changes and all three actions break** with `itemNotFound`.
>
> This is the concrete cost of leaving the workbook in a personal OneDrive rather than the
> shared **Point26** SharePoint site. Moving it there would let all three actions use the
> normal picker and survive reorganisation. It was a deliberate call to leave it — worth
> revisiting the first time this breaks.

Common to every case: **Date** = `convertFromUtc(utcNow(), 'Eastern Standard Time')`,
**Status** = literal `New`, and **Owner** / **Follow-up Date** / **Notes** left blank for
the team to fill in as they work the lead. **DateTime Format** is left blank.

Everything else maps straight through as `@{triggerBody()?['data']?['<field>']}` — `name`
→ Full Name, `companyType` → Company Type, `utm_source` → UTM Source, and so on by the
obvious correspondence. Case 2 additionally maps `documents` → Documents; Case 3 maps
`page` → Page.

> **The `@{…}` wrapper is mandatory, and omitting it fails silently — the worst bug here.**
> These column fields are rich text editors: whatever you type is a **literal string**
> unless it is an expression. Type `triggerBody()?['data']?['name']` bare and the flow
> saves cleanly, Flow Checker reports zero errors, and every run reports **Succeeded** —
> while writing rows whose cells contain the text `triggerBody()?['data']?['name']`
> instead of the lead's name. Nothing anywhere reports a problem; you only find it by
> looking at the sheet.
>
> Wrapping the same expression as `@{triggerBody()?['data']?['name']}` makes the designer
> store a real expression. You can confirm visually: a correct field renders as a
> coloured **token chip** (or an `fx` chip for functions), a broken one as plain text.
> Inserting via the `fx` / dynamic-content picker does the same thing.
>
> This applies to `Date` too — `@{convertFromUtc(utcNow(), 'Eastern Standard Time')}`.
> `Status` is genuinely literal, so `New` is correct there with no wrapper.

### No Response action

The original design ended with an explicit `200` / `{"ok": true}` **Response** action.
It was never added. The flow returns Power Automate's default empty `202`, which
`postToExcel` already treats as healthy, so nothing is broken — adding it would only make
the Netlify function's logs marginally clearer on failure.

## 3. Wire it to Netlify

**Netlify → Environment variables → `LEADS_EXCEL_WEBHOOK_URL`** = the trigger's HTTP POST
URL, all scopes, same discipline as `SLACK_WEBHOOK_URL`: never in this repo or in chat,
since anyone holding it can write rows. Redeploy so the function picks it up.

Note that `postToExcel` only exists in `submission-created.mjs` as of the commit that
added this paragraph. Setting the variable against an older deploy does nothing, because
the deployed function has no code that reads it.

## If leads stop arriving, check these in order

1. **Is the flow `On`?** A flow created while the environment was unlicensed is saved in a
   **disabled** state, and a disabled flow does not fire at all — run history stays empty.
   *My flows → Point26 Leads Intake → Turn on.* This bit us: the flow sat `Off` from
   creation, so the first live submission produced nothing.
2. **Any runs in the run history?**
   - **No runs at all** → the request never reached Power Automate. Either the URL is the
     unsigned Direct-API one (see the trigger section), `LEADS_EXCEL_WEBHOOK_URL` is
     missing from the deploy, or the deployed function predates `postToExcel`.
   - **Runs failing** → open one; the failed action shows the error.
   - **Runs succeeding but the sheet is wrong** → the `@{…}` wrapper, above.
3. **Is the deploy current?** Netlify env vars only reach a function on a *new* deploy.

Note that the Graph/Excel read-back lags by a few minutes, so a row can be genuinely
written and still not show up in an immediate read. The run history is the faster oracle.

## Remaining limitations

- **File referenced by id, in a personal OneDrive.** Fragile against the file being moved
  or re-created; see the gotcha above.
- **Premium trial expiry ~2026-12-07.** The flow stops firing when it lapses.
- **No auto-created tables.** All three Tables must exist before the first submission of
  each type; the flow does not create them.
- **No concurrency lock.** The Apps Script design used `LockService`; there is no
  equivalent here. Microsoft's backend handles concurrent writes to one workbook
  acceptably at this volume, but the flow does not guard against it.
- **No dropdown validation on Status.** Constraining it to New/Contacted/Qualified/Won/
  Lost is a manual **Data → Data Validation** step in the workbook; the flow does not
  enforce it.
