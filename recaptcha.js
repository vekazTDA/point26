/*
  reCAPTCHA v2 (checkbox) for the JS-rendered forms.

  Netlify normally injects and places the widget itself, but it only ever sees the static
  declarations in netlify-forms.html — the live forms are rendered by React at runtime, so
  there is nothing for Netlify to inject into. We therefore bring our own site key and
  render the widgets here, then hand the token to netlifyPost so it rides along in the
  submission body. Netlify still does the server-side verification, using the secret in its
  SITE_RECAPTCHA_SECRET environment variable.

  The site key below is public by design — it is sent to every visitor's browser. Only the
  secret is confidential, and it never appears in this repo.

  Usage from a page:
    <div data-recaptcha="contact" data-recaptcha-theme="dark"></div>
    P26Recaptcha.token("contact")   -> token string, "" when unticked/expired/not ready
    P26Recaptcha.reset("contact")   -> clear the widget after a submit

  Containers are found by scanning, not registered by the pages, because the forms mount
  and unmount as React re-renders (contact.html's <sc-if>, the ISO mobile step flow). A
  one-time render would leave a dead widget id behind the first time a form came back.
*/
(function () {
  var SITE_KEY = "6LchB5wtAAAAAGqJP6Q3YlPntHZar1XzXsPKzENN";
  var API = "https://www.google.com/recaptcha/api.js?onload=__p26RecaptchaReady&render=explicit";
  var ready = false;

  // reCAPTCHA renders blank into a display:none container, and iso-resources.html keeps the
  // desktop form and the mobile step flow in the DOM at the same time, switching them by
  // media query. So only ever render into — and read from — the one that is on screen.
  function visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function widgetFor(formName) {
    var els = document.querySelectorAll('[data-recaptcha="' + formName + '"]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].__p26Widget !== undefined && visible(els[i])) return els[i];
    }
    return null;
  }

  function renderInto(el) {
    try {
      el.__p26Widget = window.grecaptcha.render(el, {
        sitekey: SITE_KEY,
        theme: el.getAttribute("data-recaptcha-theme") || "light",
      });
    } catch (e) {
      // Already rendered into this node, or the API is unavailable. Leave it unmarked so a
      // later pass can retry rather than caching a broken widget.
    }
  }

  // Render any container that is on screen and does not have a widget yet. Safe to call as
  // often as we like: containers that already carry a widget id are skipped.
  function sync() {
    if (!ready) return;
    var els = document.querySelectorAll("[data-recaptcha]");
    for (var i = 0; i < els.length; i++) {
      if (els[i].__p26Widget === undefined && visible(els[i])) renderInto(els[i]);
    }
  }

  // A timer, not requestAnimationFrame: rAF is suspended while the tab is hidden, which would
  // leave a form that mounted in a background tab without a widget when the user came back.
  var queued = 0;
  function schedule() {
    if (queued) return;
    queued = setTimeout(function () { queued = 0; sync(); }, 60);
  }

  window.__p26RecaptchaReady = function () { ready = true; sync(); };

  window.P26Recaptcha = {
    // "" when the box is unticked, when the token has expired (they last 120s), or when the
    // API never loaded. Callers treat all three the same way: block the submit.
    token: function (formName) {
      var el = widgetFor(formName);
      if (!el) return "";
      try { return window.grecaptcha.getResponse(el.__p26Widget) || ""; } catch (e) { return ""; }
    },
    // Call before the form is hidden — a hidden container is skipped by widgetFor().
    reset: function (formName) {
      var el = widgetFor(formName);
      if (!el) return;
      try { window.grecaptcha.reset(el.__p26Widget); } catch (e) {}
    },

    // netlify-honeypot="bot-field" is declared on all three forms in netlify-forms.html but
    // no live page ever rendered the input, so it caught nothing. The pages now render a
    // visually hidden one; this reads it back so its value reaches Netlify. A human leaves
    // it empty, a bot that fills every field it finds does not.
    honeypot: function (formName) {
      var els = document.querySelectorAll('[data-bot-field="' + formName + '"]');
      for (var i = 0; i < els.length; i++) {
        if (visible(els[i].parentNode || els[i])) return els[i].value || "";
      }
      return els.length ? (els[0].value || "") : "";
    },
  };

  // 304x78 is wider than the content column on the narrowest phones; scale it rather than
  // letting it push the layout sideways.
  var css = document.createElement("style");
  css.textContent =
    "[data-recaptcha]{min-height:78px;}" +
    "@media (max-width:359px){[data-recaptcha]>div{transform:scale(.86);transform-origin:0 0;}[data-recaptcha]{min-height:68px;}}";
  document.head.appendChild(css);

  // childList only: the pages re-render on scroll, but those are attribute changes and must
  // not wake this up. Mounting or unmounting a form is a childList change, which must.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);

  var s = document.createElement("script");
  s.src = API;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
})();
