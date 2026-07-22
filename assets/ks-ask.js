/**
 * Ask KnoSky — client-side NL FAQ (no LLM / no egress).
 * Scores keyword overlap against assets/ks-faq.json.
 */
(function () {
  "use strict";

  var ROOT_ID = "ks-ask-root";
  if (document.getElementById(ROOT_ID)) return;

  function resolveAssetBase() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i].getAttribute("src") || "";
      if (s.indexOf("ks-ask.js") !== -1) {
        return s.replace(/ks-ask\.js(?:\?.*)?$/, "");
      }
    }
    // fallbacks
    if (location.pathname.indexOf("/wiki") === 0 || location.hostname.indexOf("knosky.wiki") !== -1) {
      if (location.pathname.indexOf("/wiki/") !== -1) {
        // under /wiki/...
        var depth = location.pathname.replace(/^\/wiki\/?/, "").split("/").filter(Boolean).length;
        // page in /wiki/ → assets at /wiki/assets or site /assets
        return depth <= 1 ? "assets/".replace(/^/, "../assets/").replace("../assets/", "/assets/") : "/assets/";
      }
      return "/assets/";
    }
    return "assets/";
  }

  // Prefer absolute site assets for dual-host deploy
  var ASSET_BASE = (function () {
    if (location.hostname.indexOf("knosky.wiki") !== -1) return "/assets/";
    if (location.hostname.indexOf("knosky.com") !== -1) return "/assets/";
    // local file or preview: relative to script
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i].getAttribute("src") || "";
      if (s.indexOf("ks-ask.js") !== -1) return s.replace(/ks-ask\.js(?:\?.*)?$/, "");
    }
    return "assets/";
  })();

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/\"/g, "&" + "quot;");
  }

  function formatAnswer(text) {
    var parts = String(text).split(/`([^`]+)`/g);
    var out = "";
    for (var i = 0; i < parts.length; i++) {
      out += i % 2 === 1 ? "<code>" + esc(parts[i]) + "</code>" : esc(parts[i]).replace(/\n/g, "<br/>");
    }
    return out;
  }

  function tokenize(q) {
    return String(q || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s/-]/g, " ")
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 1;
      });
  }

  function scoreEntry(entry, tokens, raw) {
    var score = 0;
    var hay = (entry.keywords || []).concat([entry.title || "", entry.id || ""]).join(" ").toLowerCase();
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (hay.indexOf(t) !== -1) score += t.length > 4 ? 3 : 2;
    }
    // phrase bonuses
    var low = raw.toLowerCase();
    (entry.keywords || []).forEach(function (kw) {
      if (kw.length > 3 && low.indexOf(kw.toLowerCase()) !== -1) score += 5;
    });
    return score;
  }

  function bestMatch(data, question) {
    var tokens = tokenize(question);
    if (!tokens.length) return null;
    var best = null;
    var bestScore = 0;
    (data.entries || []).forEach(function (e) {
      var s = scoreEntry(e, tokens, question);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    });
    if (bestScore < 3) return null;
    return best;
  }

  function mount(data) {
    var root = el("div", "ks-ask-root");
    root.id = ROOT_ID;

    var fab = el("button", "ks-ask-fab");
    fab.type = "button";
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-expanded", "false");
    fab.innerHTML = '<span class="ks-ask-fab-ico" aria-hidden="true">?</span><span>Ask KnoSky</span>';

    var panel = el("div", "ks-ask-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Ask KnoSky FAQ");
    panel.innerHTML =
      '<div class="ks-ask-head">' +
      "<div><h2>Ask KnoSky</h2><p>" +
      esc(data.greeting || "FAQ about install, packs, Mode B, and more.") +
      "</p></div>" +
      '<button type="button" class="ks-ask-x" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="ks-ask-chips" role="list"></div>' +
      '<div class="ks-ask-log" aria-live="polite"></div>' +
      '<form class="ks-ask-form" autocomplete="off">' +
      '<input type="text" name="q" maxlength="280" placeholder="e.g. How do I install?" aria-label="Your question" />' +
      '<button type="submit">Ask</button>' +
      "</form>" +
      '<div class="ks-ask-foot">On-page FAQ · no account · answers from published KnoSky docs</div>';

    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    var log = panel.querySelector(".ks-ask-log");
    var form = panel.querySelector("form");
    var input = panel.querySelector('input[name="q"]');
    var chips = panel.querySelector(".ks-ask-chips");
    var closeBtn = panel.querySelector(".ks-ask-x");

    function setOpen(open) {
      panel.classList.toggle("is-open", open);
      fab.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) setTimeout(function () { input.focus(); }, 20);
    }

    function addMsg(role, html) {
      var m = el("div", "ks-ask-msg " + role);
      m.innerHTML = html;
      log.appendChild(m);
      log.scrollTop = log.scrollHeight;
    }

    function renderEntry(entry) {
      var html = "<strong>" + esc(entry.title || "Answer") + "</strong><br/>" + formatAnswer(entry.answer || "");
      if (entry.links && entry.links.length) {
        html += '<div class="ks-ask-more">';
        entry.links.forEach(function (L, idx) {
          if (idx) html += " · ";
          html += '<a href="' + esc(L.href) + '">' + esc(L.label || L.href) + "</a>";
        });
        html += "</div>";
      }
      addMsg("bot", html);
    }

    function ask(q) {
      q = String(q || "").trim();
      if (!q) return;
      addMsg("user", esc(q));
      var hit = bestMatch(data, q);
      if (hit) renderEntry(hit);
      else addMsg("bot", formatAnswer(data.fallback || "Try install, Mode B, packs, or package."));
    }

    (data.chips || []).forEach(function (c) {
      var b = el("button", "");
      b.type = "button";
      b.textContent = c;
      b.addEventListener("click", function () {
        ask(c);
      });
      chips.appendChild(b);
    });

    // welcome
    addMsg(
      "bot",
      formatAnswer(
        "Hi — ask in plain English. Popular: **what’s in the package**, install, Mode A/B, packs, privacy, L3."
      )
    );

    fab.addEventListener("click", function () {
      setOpen(!panel.classList.contains("is-open"));
    });
    closeBtn.addEventListener("click", function () {
      setOpen(false);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = "";
      ask(v);
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }

  function boot() {
    var url = ASSET_BASE + "ks-faq.json";
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("faq " + r.status);
        return r.json();
      })
      .then(mount)
      .catch(function () {
        // hard-coded minimal fallback if fetch blocked (file://)
        mount({
          greeting: "FAQ unavailable offline — open knosky.com / knosky.wiki.",
          fallback: "See https://knosky.wiki/ and https://github.com/SathiaAI/knosky",
          chips: ["Install", "Docs"],
          entries: [
            {
              id: "install",
              title: "Install",
              keywords: ["install", "npx"],
              answer: "Run `npx knosky@latest .` with Node 20+.",
              links: [{ label: "Install", href: "https://www.knosky.com/install.html" }],
            },
          ],
        });
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
