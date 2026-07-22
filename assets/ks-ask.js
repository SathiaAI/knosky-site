/**
 * Ask KnoSky — client-side NL FAQ (no LLM / no egress).
 * Plain-English first; optional more detail; resilient matching + graceful OOS.
 */
(function () {
  "use strict";

  var ROOT_ID = "ks-ask-root";
  if (document.getElementById(ROOT_ID)) return;

  var ASSET_BASE = (function () {
    if (location.hostname.indexOf("knosky.wiki") !== -1) return "/assets/";
    if (location.hostname.indexOf("knosky.com") !== -1) return "/assets/";
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i].getAttribute("src") || "";
      if (s.indexOf("ks-ask.js") !== -1) return s.replace(/ks-ask\.js(?:\?.*)?$/, "");
    }
    return "assets/";
  })();

  // Cache-bust FAQ JSON when we ship content changes
  var FAQ_URL = ASSET_BASE + "ks-faq.json?v=5";

  var STOP = {
    a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, were: 1, be: 1, been: 1, being: 1,
    what: 1, whats: 1, who: 1, whom: 1, which: 1, where: 1, when: 1, why: 1, how: 1,
    do: 1, does: 1, did: 1, can: 1, could: 1, should: 1, would: 1, will: 1,
    to: 1, of: 1, in: 1, on: 1, for: 1, and: 1, or: 1, with: 1, about: 1,
    please: 1, tell: 1, me: 1, my: 1, your: 1, you: 1, i: 1, it: 1, its: 1,
    this: 1, that: 1, from: 1, into: 1, than: 1, then: 1
  };

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
    var parts = String(text || "").split(/`([^`]+)`/g);
    var out = "";
    for (var i = 0; i < parts.length; i++) {
      out +=
        i % 2 === 1
          ? "<code>" + esc(parts[i]) + "</code>"
          : esc(parts[i]).replace(/\n/g, "<br/>");
    }
    return out;
  }

  function normalize(q) {
    return String(q || "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9+#.\s/-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(q) {
    return normalize(q)
      .split(" ")
      .filter(function (t) {
        return t.length > 1 && !STOP[t];
      });
  }

  function scoreEntry(entry, tokens, rawNorm) {
    var score = 0;
    var title = String(entry.title || "").toLowerCase();
    var id = String(entry.id || "").toLowerCase();
    var kws = entry.keywords || [];
    var hay =
      kws.join(" ").toLowerCase() +
      " " +
      title +
      " " +
      id +
      " " +
      String(entry.simple || entry.answer || "")
        .toLowerCase()
        .slice(0, 280);

    // Strong: multi-word keyword / title phrase fully present
    kws.forEach(function (kw) {
      var k = String(kw || "")
        .toLowerCase()
        .replace(/[’']/g, "");
      if (k.length < 3) return;
      if (rawNorm.indexOf(k) !== -1) {
        // multi-word phrases score hard
        score += k.indexOf(" ") !== -1 ? 24 : 14;
      }
    });

    if (title && rawNorm.indexOf(title.replace(/[’']/g, "")) !== -1) score += 18;

    // Token overlap — contentful tokens only
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (id === t) score += 20;
      else if (title.indexOf(t) !== -1) score += 10;
      else if (hay.indexOf(t) !== -1) score += t.length > 5 ? 6 : 4;
    }

    // Prefer dedicated topic ids when distinctive token hits
    if (tokens.indexOf("swarm") !== -1 && (id === "l3" || /swarm/.test(title) || /swarm/.test(kws.join(" "))))
      score += 30;
    if (tokens.indexOf("l3") !== -1 && id === "l3") score += 30;
    if ((tokens.indexOf("install") !== -1 || tokens.indexOf("npx") !== -1) && id === "install")
      score += 18;
    if (tokens.indexOf("privacy") !== -1 || tokens.indexOf("uploaded") !== -1 || tokens.indexOf("upload") !== -1) {
      if (id === "privacy") score += 18;
    }

    // Soft penalty for ultra-generic "what" page unless query is really about product identity
    if (id === "what") {
      var identity =
        /\b(knosky|product|this tool|the tool|gps for)\b/.test(rawNorm) ||
        rawNorm === "what is it" ||
        rawNorm === "what is this";
      if (!identity) score -= 8;
    }

    return score;
  }

  function bestMatch(data, question) {
    var rawNorm = normalize(question);
    var tokens = tokenize(question);
    if (!tokens.length && !rawNorm) return { entry: null, score: 0, second: 0 };

    var best = null;
    var bestScore = -999;
    var second = -999;

    (data.entries || []).forEach(function (e) {
      var s = scoreEntry(e, tokens, rawNorm);
      if (s > bestScore) {
        second = bestScore;
        bestScore = s;
        best = e;
      } else if (s > second) {
        second = s;
      }
    });

    return { entry: best, score: bestScore, second: second };
  }

  function isConfident(match) {
    if (!match || !match.entry) return false;
    // Need solid absolute score and enough separation from runner-up
    if (match.score < 12) return false;
    if (match.second > 0 && match.score - match.second < 4 && match.score < 20)
      return false;
    return true;
  }

  function wantsMoreDetail(q) {
    var low = normalize(q);
    return (
      /\b(more detail|more technical|technical detail|go deeper|dig deeper|yes more|yes please|show tech|internals|under the hood|advanced)\b/.test(
        low
      ) ||
      low === "yes" ||
      low === "y" ||
      low === "more" ||
      low === "details" ||
      low === "detail" ||
      low === "tech" ||
      low === "technical"
    );
  }

  function plainBody(entry) {
    if (entry.simple) return entry.simple;
    if (entry.answer) return entry.answer;
    return "I have a short answer for that topic, but it’s missing from this FAQ file. Try Install or Docs.";
  }

  function techBody(entry) {
    return entry.technical || "";
  }

  function bannedInSimple(text) {
    var t = String(text || "");
    return /single-operator|dual quorum|throwaway domain|FOUNDATION|swarm-safe fleet|ADVISORY_UNAUTH|leaseId|assertOperator|SECURITY\.md/i.test(
      t
    );
  }

  function renderLinks(entry) {
    if (!entry.links || !entry.links.length) return "";
    var html = '<div class="ks-ask-more">';
    entry.links.forEach(function (L, idx) {
      if (idx) html += " · ";
      html += '<a href="' + esc(L.href) + '">' + esc(L.label || L.href) + "</a>";
    });
    html += "</div>";
    return html;
  }

  function oosMessage(data, question) {
    var chips = (data.chips || []).slice(0, 5).join(" · ");
    return (
      "I’m not sure I have a solid answer for **“" +
      question +
      "”** in this fellowship FAQ.\n\n" +
      "I’m best at KnoSky topics like: install, what KnoSky is, what’s in the package, privacy, which tools work, Mode A vs B, and **what a swarm means here**.\n\n" +
      (chips ? "Try a chip: " + chips + "\n\n" : "") +
      "Or browse docs: https://knosky.wiki/ · https://www.knosky.com/install.html"
    );
  }

  function mount(data) {
    var root = el("div", "ks-ask-root");
    root.id = ROOT_ID;

    var lastEntry = null;
    var detailShownFor = null;

    var fab = el("button", "ks-ask-fab");
    fab.type = "button";
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-expanded", "false");
    fab.innerHTML =
      '<span class="ks-ask-fab-ico" aria-hidden="true">' +
      '<img src="' +
      ASSET_BASE +
      'ks-ask-mark.svg?v=5" width="24" height="24" alt="" />' +
      "</span><span>Ask KnoSky</span>";

    var panel = el("div", "ks-ask-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Ask KnoSky FAQ");
    panel.innerHTML =
      '<div class="ks-ask-head">' +
      "<div><h2>Ask KnoSky</h2><p>" +
      esc(
        data.greeting ||
          "Plain English first. You can ask for more detail anytime."
      ) +
      "</p></div>" +
      '<button type="button" class="ks-ask-x" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="ks-ask-chips" role="list"></div>' +
      '<div class="ks-ask-log" aria-live="polite"></div>' +
      '<form class="ks-ask-form" autocomplete="off">' +
      '<input type="text" name="q" maxlength="280" placeholder="e.g. What is a swarm?" aria-label="Your question" />' +
      '<button type="submit">Ask</button>' +
      "</form>" +
      '<div class="ks-ask-foot">Plain answers first · optional detail · no cloud chat</div>';

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
      return m;
    }

    function showTechnical(entry) {
      if (!entry) return;
      var tech = techBody(entry);
      if (!tech) {
        addMsg(
          "bot",
          formatAnswer(
            "That’s already the full plain answer. These links go deeper if you want:"
          ) + renderLinks(entry)
        );
        return;
      }
      detailShownFor = entry.id;
      addMsg(
        "bot",
        "<strong>A bit more detail</strong><br/>" +
          formatAnswer(tech) +
          renderLinks(entry)
      );
    }

    function renderSimple(entry) {
      lastEntry = entry;
      detailShownFor = null;
      var body = plainBody(entry);
      if (bannedInSimple(body) && entry.simple) body = entry.simple;

      var html =
        "<strong>" +
        esc(entry.title || "Answer") +
        "</strong><br/>" +
        formatAnswer(body);

      if (entry.links && entry.links.length) html += renderLinks(entry);

      if (techBody(entry)) {
        var prompt = data.more_detail_prompt || "Want a bit more detail?";
        html +=
          '<div class="ks-ask-detail-ask">' +
          "<span>" +
          esc(prompt) +
          "</span>" +
          '<div class="ks-ask-detail-btns">' +
          '<button type="button" class="ks-ask-yes-detail">Yes, more detail</button>' +
          '<button type="button" class="ks-ask-no-detail">No thanks</button>' +
          "</div></div>";
      }

      var node = addMsg("bot", html);
      var yes = node.querySelector(".ks-ask-yes-detail");
      var no = node.querySelector(".ks-ask-no-detail");
      if (yes) {
        yes.addEventListener("click", function () {
          yes.disabled = true;
          if (no) no.disabled = true;
          addMsg("user", esc("Yes, more detail"));
          showTechnical(entry);
        });
      }
      if (no) {
        no.addEventListener("click", function () {
          if (yes) yes.disabled = true;
          no.disabled = true;
          addMsg(
            "bot",
            formatAnswer("OK — ask anything else whenever you’re ready.")
          );
        });
      }
    }

    function ask(q) {
      q = String(q || "").trim();
      if (!q) return;
      addMsg("user", esc(q));

      if (lastEntry && wantsMoreDetail(q)) {
        if (detailShownFor === lastEntry.id) {
          addMsg(
            "bot",
            formatAnswer(
              "I already shared the extra detail for that. Try another question, or open the links under the answer."
            ) + renderLinks(lastEntry)
          );
          return;
        }
        showTechnical(lastEntry);
        return;
      }

      var match = bestMatch(data, q);
      if (isConfident(match)) {
        renderSimple(match.entry);
        return;
      }

      // Soft near-miss: if one topic clearly leads but under threshold, still take it when score is decent and separation exists
      if (
        match.entry &&
        match.score >= 10 &&
        match.score - Math.max(match.second, 0) >= 6
      ) {
        renderSimple(match.entry);
        return;
      }

      addMsg("bot", formatAnswer(oosMessage(data, q)));
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

    addMsg(
      "bot",
      formatAnswer(
        "Hi — answers stay **simple first**. If you want depth, tap **Yes, more detail** or type **more detail**.\n\nPopular: install, what is KnoSky, what’s in the package, privacy, or **what is a swarm?**"
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
    fetch(FAQ_URL, { credentials: "same-origin", cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("faq " + r.status);
        return r.json();
      })
      .then(mount)
      .catch(function () {
        mount({
          greeting: "FAQ unavailable offline — open knosky.com / knosky.wiki.",
          fallback:
            "See https://knosky.wiki/ and https://www.knosky.com/install.html",
          more_detail_prompt: "Want a bit more detail?",
          chips: ["How do I install?", "What is a swarm?"],
          entries: [
            {
              id: "install",
              title: "Install",
              keywords: ["install", "npx"],
              simple:
                "In your project folder run `npx knosky@latest .` (Node 20+). Builds a local map from your code.",
              technical:
                "Uses the published npm package and writes local map files under `.knosky/`.",
              links: [
                {
                  label: "Install",
                  href: "https://www.knosky.com/install.html",
                },
              ],
            },
            {
              id: "l3",
              title: "What is a swarm? (L3)",
              keywords: ["swarm", "l3", "multiple agents"],
              simple:
                "A swarm here means more than one AI helper on the same project. L3 is early traffic help so they collide less—not a finished multi-AI factory.",
              technical:
                "Optional multi-agent coordinator foundation on your machine. Not required for basic map + routing.",
              links: [
                {
                  label: "Levels wiki",
                  href: "https://knosky.wiki/wiki/govern/ladder.html",
                },
              ],
            },
          ],
        });
      });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
