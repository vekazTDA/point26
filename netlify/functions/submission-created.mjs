/*
  Posts every form submission to Slack.

  Netlify has a built-in Slack form notification, but its message format is fixed and
  basic; this reproduces the layout the team already uses elsewhere — emoji, bold label,
  value, one per line, with the campaign attribution that makes a lead worth reading.

  Naming the file submission-created is what wires it up: Netlify invokes it automatically
  once a submission is stored, and only for submissions that survived spam filtering and
  reCAPTCHA verification, so junk never reaches the channel.

  No package.json or netlify.toml is needed. netlify/functions is Netlify's default
  functions directory and is auto-detected, and fetch is global on the Node 18+ runtime,
  so this has no dependencies. A netlify.toml is deliberately avoided — this site's build
  settings live in the Netlify UI and a toml would start overriding them.

  The webhook lives in SLACK_WEBHOOK_URL. It never belongs in this repo: anyone holding it
  can post to the channel.
*/

const FORM_LABELS = {
  contact: "Website - Contact",
  "iso-application": "Website - ISO Application",
  newsletter: "Website - Newsletter",
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

export const handler = async (event) => {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.error("SLACK_WEBHOOK_URL is not set — skipping Slack notification");
    return { statusCode: 200 };
  }

  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (e) {
    console.error("could not parse submission payload:", e);
    return { statusCode: 200 };
  }

  const formName = payload.form_name || "unknown";
  const text = truncate(buildLines(formName, payload.data || {}).join("\n"), MAX_BLOCK);

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

  // Always 200. The submission is already stored; a Slack outage must never make it look
  // like the form failed.
  return { statusCode: 200 };
};
