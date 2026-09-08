/*
  Fans every form submission out to Slack and to a live Excel workbook (OneDrive for
  Business), via a Power Automate flow.

  Netlify has a built-in Slack form notification, but its message format is fixed and
  basic; postToSlack reproduces the layout the team already uses elsewhere — emoji, bold
  label, value, one per line, with the campaign attribution that makes a lead worth
  reading. postToExcel appends the same submission as a row via an HTTP-triggered Power
  Automate flow that writes into an Excel Table (see power-automate/leads-intake-flow.md
  for that side — it's a cloud flow built in Microsoft's UI, not a file this repo runs).

  Naming the file submission-created is what wires it up: Netlify invokes it automatically
  once a submission is stored, and only for submissions that survived spam filtering and
  reCAPTCHA verification, so junk never reaches either destination.

  No package.json or netlify.toml is needed. netlify/functions is Netlify's default
  functions directory and is auto-detected, and fetch is global on the Node 18+ runtime,
  so this has no dependencies. A netlify.toml is deliberately avoided — this site's build
  settings live in the Netlify UI and a toml would start overriding them.

  Both webhook URLs (SLACK_WEBHOOK_URL, LEADS_EXCEL_WEBHOOK_URL) live only in Netlify's
  environment variables. Neither belongs in this repo: anyone holding one can post into
  that channel or trigger the flow.

  The two destinations are independent by design: a missing env var, or a failure
  reaching one, must never prevent or affect the other. The submission is already stored
  in Netlify regardless of what either webhook does with it, so this handler always
  returns 200.
*/

const FORM_LABELS = {
  contact: "Website - Contact",
  "iso-application": "Website - ISO Application",
  newsletter: "Website - Newsletter",
};

// Field order per form, matching exactly what's declared in netlify-forms.html — the
// same list the Power Automate flow's Excel column mapping uses, and the whitelist that
// keeps Netlify's own bookkeeping fields (form-name, bot-field) out of the workbook.
const EXCEL_FIELDS = {
  contact: [
    "name", "email", "phone", "company", "companyType", "address", "intent", "message",
    "landing", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  ],
  "iso-application": [
    "name", "email", "phone", "company", "companyType", "message", "documents",
    "landing", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  ],
  newsletter: [
    "email", "page",
    "landing", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  ],
};

// Slack rejects a section block over 3000 characters, and a pasted-in essay would take the
// whole notification down with it.
const MAX_MESSAGE = 1200;
const MAX_BLOCK = 2900;

function truncate(v, max) {
  const s = String(v || "").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Empty fields are dropped rather than printed blank: a newsletter signup has no phone,
// message or documents, and a wall of empty labels would bury the one line that matters.
function line(emoji, label, value) {
  const v = truncate(value, 500);
  return v ? `${emoji} *${label}:* ${v}` : null;
}

function buildLines(formName, d) {
  const lines = [
    line("🌐", "Web Source", FORM_LABELS[formName] || formName),
    line("👤", "Full Name", d.name),
    line("✉️", "Email", d.email ? `<mailto:${d.email}|${d.email}>` : ""),
    line("📞", "Phone", d.phone),
    line("🏢", "Company", d.company),
    line("🏷️", "Company Type", d.companyType),
    line("📍", "Address", d.address),
    line("🎯", "Intent", d.intent),
    line("💬", "Message", truncate(d.message, MAX_MESSAGE)),
    line("📄", "Page", d.page),
    line("🔖", "Landing", d.landing),
    line("🔗", "Referrer", d.referrer),
    line("🔗", "UTM source", d.utm_source),
    line("📊", "UTM campaign", d.utm_campaign),
    line("📰", "UTM content", d.utm_content),
    line("📡", "UTM medium", d.utm_medium),
    line("🔑", "UTM term", d.utm_term),
  ];

  // Only the ISO form has an upload, and uploading is optional — so "0" is real
  // information there (the applicant sent no paperwork) and is worth printing.
  if (formName === "iso-application") {
    const docs = String(d.documents || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    lines.push(
      docs.length
        ? `📎 *Attached files:* ${docs.length} — ${truncate(docs.join(", "), 400)}`
        : "📎 *Attached files:* 0"
    );
  }

  return lines.filter(Boolean);
}

async function postToSlack(formName, data) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.error("SLACK_WEBHOOK_URL is not set — skipping Slack notification");
    return;
  }

  const text = truncate(buildLines(formName, data).join("\n"), MAX_BLOCK);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Fallback for notifications and screen readers, which do not render blocks.
        text: `New ${FORM_LABELS[formName] || formName} submission`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      }),
    });
    if (!res.ok) console.error("Slack rejected the message:", res.status, await res.text());
  } catch (e) {
    console.error("could not reach Slack:", e);
  }
}

async function postToExcel(formName, data) {
  const url = process.env.LEADS_EXCEL_WEBHOOK_URL;
  if (!url) {
    console.error("LEADS_EXCEL_WEBHOOK_URL is not set — skipping Excel notification");
    return;
  }

  // Only the fields that form actually has, whitelisted against netlify-forms.html —
  // keeps Netlify's own bookkeeping fields (form-name, bot-field) out of the workbook,
  // and gives the flow a stable, predictable shape per form_name.
  const fields = EXCEL_FIELDS[formName];
  if (!fields) {
    console.error("no Excel column mapping for form:", formName);
    return;
  }

  const row = {};
  for (const f of fields) row[f] = data[f] || "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ form_name: formName, data: row }),
    });
    if (!res.ok) {
      console.error("Power Automate flow rejected the request:", res.status, await res.text().catch(() => ""));
      return;
    }
    // A flow with no explicit Response action returns 202 with an empty body — that is
    // the expected, healthy case, not an error. Only inspect the body if the flow chose
    // to send one back, and only treat it as a problem if it explicitly says so.
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.ok === false) console.error("Excel flow reported an error:", parsed.error);
      } catch (e) {
        // Non-JSON body on a successful status is not itself a failure.
      }
    }
  } catch (e) {
    console.error("could not reach the Excel flow:", e);
  }
}

export const handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (e) {
    console.error("could not parse submission payload:", e);
    return { statusCode: 200 };
  }

  const formName = payload.form_name || "unknown";
  const data = payload.data || {};

  // Independent by design: awaited together only so the invocation doesn't exit early,
  // not as a barrier — a rejection in one has already been caught inside its own function
  // and cannot reach here.
  await Promise.all([postToSlack(formName, data), postToExcel(formName, data)]);

  return { statusCode: 200 };
};
