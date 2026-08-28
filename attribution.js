/*
  First-touch attribution for the forms.

  The site captured none of this before: GTM is on every page, but it feeds Google
  Analytics only, so a lead arrived in Netlify with no way to tell which ad or page paid
  for it. This records where the visitor came from on the first page of their session and
  hands it to netlifyPost, which attaches it to every submission.

  First touch, not last. Someone can land on /iso-resources from an ad and submit from
  /contact — reading the query string at submit time would lose the campaign entirely, so
  the landing values are stored once per session and reused.

  Everything touching sessionStorage is wrapped: it throws outright in some privacy modes,
  and a lead must never be lost because storage was unavailable.
*/
(function () {
  var KEY = "p26_attr";
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var FIELDS = ["landing", "referrer"].concat(UTM);

  function blank() {
    var o = {};
    for (var i = 0; i < FIELDS.length; i++) o[FIELDS[i]] = "";
    return o;
  }

  function read() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function capture() {
    var a = blank();
    a.landing = location.href;

    // A same-origin referrer is just the previous page of this visit, not a referral.
    var ref = document.referrer || "";
    if (ref) {
      try {
        if (new URL(ref).host !== location.host) a.referrer = ref;
      } catch (e) {
        a.referrer = ref;
      }
    }

    try {
      var q = new URLSearchParams(location.search);
      for (var i = 0; i < UTM.length; i++) a[UTM[i]] = q.get(UTM[i]) || "";
    } catch (e) {}

    return a;
  }

  var current = read();
  if (!current) {
    current = capture();
    // If this throws, current still describes this page load — degrading to last-touch is
    // far better than reporting nothing.
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(current));
    } catch (e) {}
  }

  window.P26Attribution = {
    // Always returns all seven keys, empty string when unknown, so the submission body has
    // a stable shape and Netlify records the field even when it is blank.
    fields: function () {
      var out = blank();
      for (var i = 0; i < FIELDS.length; i++) out[FIELDS[i]] = (current && current[FIELDS[i]]) || "";
      return out;
    },
  };
})();
