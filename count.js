/* Visit counter: Cloudflare Web Analytics, no cookie. Counts page views and a few fixed "step" words
   (out-<word> for a click to another site, out-mail for an e-mail link). No full address, no typed value, no ID. */
(function () {
  "use strict";
  if (!/(^|\.)kepthold\.com$/.test(location.hostname)) return;   // live host only
  var OUT = {};
  var STEPS = { "out-mail": 1 };
  Object.keys(OUT).forEach(function (k) { STEPS[OUT[k]] = 1; });
  var counted = Object.create(null);
  function countStep(name) {
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(STEPS, name) || counted[name] === 1) return;
    if (location.pathname.charAt(1) === "/") return;
    counted[name] = 1;
    var back = location.href, st = null;
    try { st = history.state; history.replaceState(st, "", "/step/" + name); } catch (e) {}
    finally { try { history.replaceState(st, "", back); } catch (e2) { if (location.href !== back) location.replace(back); } }
  }
  window.countStep = countStep;
  var s = document.createElement("script");
  s.type = "module"; s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", '{"token": "a9d9f04f4c324978a44a4cb039ed7c0f"}');
  document.head.appendChild(s);
  function onLink(ev) {
    if (!ev.isTrusted) return;
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (/^mailto:/i.test(h)) { countStep("out-mail"); return; }
    if (!/^https?:\/\//i.test(a.href) || a.hostname === location.hostname) return;
    var host = a.hostname.toLowerCase().replace(/^www\./, "");
    Object.keys(OUT).forEach(function (k) { if (host === k || host.slice(-k.length - 1) === "." + k) countStep(OUT[k]); });
  }
  document.addEventListener("pointerdown", onLink, true);
  document.addEventListener("click", onLink, true);
})();
