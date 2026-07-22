/**
 * Ask KnoSky — client-side NL FAQ (no LLM / no egress).
 * Plain-English first; optional technical detail on request.
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
    var hay = (entry.keywords || [])
      .concat([entry.title || "", entry.id || "", entry.simple || "", entry.answer || ""])
      .join(" ")
      .toLowerCase();
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (hay.indexOf(t) !== -1) score += t.length > 4 ? 3 : 2;
    }
    var low = raw.toLowerCase();
    (entry.keywords || []).forEach(function (kw) {
      if (kw.length > 3 && low.indexOf(String(kw).toLowerCase()) !== -1) score += 5;
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

  function wantsMoreDetail(q) {
    var low = String(q || "").toLowerCase();
    return (
      /\b(more detail|more technical|technical detail|go deeper|dig deeper|yes more|yes,? please|show tech|internals|under the hood|advanced)\b/.test(
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
      // Never fall back to technical blob for first answer
      if (entry.simple) return entry.simple;
      if (entry.answer) return entry.answer;
      return "I have a short answer for that topic, but it’s missing from this FAQ file. Try Install or Docs.";
    }

    function techBody(entry) {
      return entry.technical || "";
    }

    function bannedInSimple(text) {
      var t = String(text || "");
      // Rough guardrails — simple tier must not sound like eng security notes
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
      'logo-mark.png" width="22" height="22" alt="" />' +
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
      '<input type="text" name="q" maxlength="280" placeholder="e.g. What is L3 swarm?" aria-label="Your question" />' +
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
      var html =
        "<strong>A bit more technical</strong><br/>" +
        formatAnswer(tech) +
        renderLinks(entry);
      addMsg("bot", html);
    }

    function renderSimple(entry) {
          lastEntry = entry;
          detailShownFor = null;
          var body = plainBody(entry);
          if (bannedInSimple(body) && entry.simple) {
            // Prefer incomplete plain over shipping internal jargon in tier-1 UI
            body = entry.simple;
          }
          var html =
            "<strong>" +
            esc(entry.title || "Answer") +
            "</strong><br/>" +
            formatAnswer(body);

          if (entry.links && entry.links.length) {
            html += renderLinks(entry);
          }

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
              yes && (yes.disabled = true);
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

      // Follow-up: more detail on last topic
      if (lastEntry && wantsMoreDetail(q)) {
        if (detailShownFor === lastEntry.id) {
          addMsg(
            "bot",
            formatAnswer(
              "I already shared the technical note for that. Try another question, or open the links under the answer."
            ) + renderLinks(lastEntry)
          );
          return;
        }
        showTechnical(lastEntry);
        return;
      }

      var hit = bestMatch(data, q);
      if (hit) renderSimple(hit);
      else
        addMsg(
          "bot",
          formatAnswer(
            data.fallback ||
              "Try: install, what is KnoSky, package, privacy, or L3 swarm."
          )
        );
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
    var url = ASSET_BASE + "ks-faq.json";
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("faq " + r.status);
        return r.json();
      })
      .then(mount)
      .catch(function () {
        mount({
          greeting: "FAQ unavailable offline — open knosky.com / knosky.wiki.",
          fallback: "See https://knosky.wiki/ and https://github.com/SathiaAI/knosky",
          more_detail_prompt: "Want a bit more technical detail?",
          chips: ["Install", "What is KnoSky?"],
          entries: [
            {
              id: "install",
              title: "Install",
              keywords: ["install", "npx"],
              simple:
                "In your project folder run `npx knosky@latest .` (Node 20+). Builds a local map from your code.",
              technical:
                "CLI from npm latest; writes local `.knosky` artifacts and can print MCP connect snippets.",
              links: [
                {
                  label: "Install",
                  href: "https://www.knosky.com/install.html",
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
