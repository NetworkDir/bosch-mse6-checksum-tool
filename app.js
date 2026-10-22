/* Web UI for the checksum fixer. Everything runs locally; files are never uploaded. */
(function () {
  "use strict";

  const R = self.ChecksumRegistry;
  const $ = (id) => document.getElementById(id);
  const state = { name: null, bytes: null, selected: null, options: {} };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) {
      if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
    }
    return node;
  }

  const hex = (n, w) => "0x" + n.toString(16).toUpperCase().padStart(w || 8, "0");

  function fixedName(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) + "_fixed" + name.slice(dot) : name + "_fixed";
  }

  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function entryTable(entries) {
    return el("table", {}, [
      el("thead", {}, el("tr", {}, ["Checksum", "Region", "Stored at", "Stored", "Computed", "Status"].map((h) => el("th", {}, h)))),
      el("tbody", {}, entries.map((e) => el("tr", {}, [
        el("td", {}, e.label),
        el("td", { class: "mono" }, hex(e.start, 6) + " - " + hex(e.end, 6)),
        el("td", { class: "mono" }, hex(e.offset, 6)),
        el("td", { class: "mono" }, hex(e.stored)),
        el("td", { class: "mono" }, hex(e.computed)),
        el("td", {}, el("span", { class: e.ok ? "pill ok" : "pill bad" }, e.ok ? "OK" : "BAD")),
      ]))),
    ]);
  }

  function statusBadge(algo) {
    return el("span", { class: "pill " + (algo.status === "confirmed" ? "ok" : "warn") }, algo.status);
  }

  function render() {
    const out = $("result");
    out.replaceChildren();
    if (!state.bytes) return;

    out.append(el("p", { class: "file" }, [
      el("strong", {}, state.name), "  " + state.bytes.length.toLocaleString() + " bytes (" + hex(state.bytes.length, 6) + ")",
    ]));

    const matches = R.detect(state.bytes, state.options);
    if (!matches.length) {
      out.append(el("div", { class: "card error" }, [
        el("strong", {}, "No supported checksum layout found."),
        el("p", {}, "This image does not match any algorithm below. If it is an MSE6.0 image with its header elsewhere, widen the scan range under Advanced."),
      ]));
      return;
    }

    let match = matches.find((m) => m.algo.id === state.selected) || matches[0];
    state.selected = match.algo.id;

    if (matches.length > 1) {
      const sel = el("select", { onchange: (ev) => { state.selected = ev.target.value; render(); } },
        matches.map((m) => {
          const o = el("option", { value: m.algo.id }, m.algo.name);
          if (m.algo.id === state.selected) o.selected = true;
          return o;
        }));
      out.append(el("p", {}, ["Several algorithms match this image: ", sel]));
    }

    const bad = match.entries.filter((e) => !e.ok).length;
    const card = el("div", { class: "card" }, [
      el("h2", {}, [match.algo.name + " ", statusBadge(match.algo)]),
      el("p", { class: "muted" }, match.algo.description || ""),
      match.algo.notes ? el("p", { class: "note" }, match.algo.notes) : null,
      entryTable(match.entries),
      el("p", { class: bad ? "summary bad-text" : "summary ok-text" },
        bad ? bad + " of " + match.entries.length + " checksum(s) do not match." : "All checksums are valid. Nothing to fix."),
    ]);

    const btn = el("button", {
      onclick: () => fix(match),
    }, "Fix checksums and download");
    if (!bad) btn.disabled = true;
    card.append(btn);
    out.append(card);
    out.append(el("div", { id: "after" }));
  }

  function fix(match) {
    const after = $("after");
    after.replaceChildren();
    let fixed;
    try {
      fixed = match.algo.apply(state.bytes, match.opts);
    } catch (err) {
      after.append(el("div", { class: "card error" }, "Repair failed: " + err.message));
      return;
    }
    const recheck = match.algo.verify(fixed, match.opts);
    const ok = recheck.length > 0 && recheck.every((e) => e.ok);
    const changed = fixed.reduce((n, b, i) => n + (b !== state.bytes[i] ? 1 : 0), 0);
    if (!ok) {
      after.append(el("div", { class: "card error" }, [
        el("strong", {}, "Self-check failed. Do not flash this file."), entryTable(recheck),
      ]));
      return;
    }
    const name = fixedName(state.name);
    download(fixed, name);
    after.append(el("div", { class: "card done" }, [
      el("h2", {}, "Fixed file verified"),
      el("p", {}, ["Downloaded ", el("strong", {}, name), " - " + changed + " byte(s) changed, checksum fields only."]),
      entryTable(recheck),
      el("p", { class: "muted" }, "Keep an untouched backup of the original image before flashing."),
    ]));
  }

  async function loadFile(file) {
    state.name = file.name;
    state.bytes = new Uint8Array(await file.arrayBuffer());
    state.selected = null;
    render();
  }

  function renderAlgorithms() {
    $("algos").replaceChildren(...R.algorithms.map((a) => el("li", {}, [
      el("strong", {}, a.name), " ", statusBadge(a),
      a.tested.length ? el("div", { class: "muted" }, "Tested: " + a.tested.join("; ")) : el("div", { class: "muted" }, "Not yet confirmed on a vehicle."),
    ])));
  }

  function renderOptions() {
    const box = $("options");
    box.replaceChildren();
    for (const algo of R.algorithms) {
      if (!algo.options.length) continue;
      state.options[algo.id] = R.defaultOptions(algo);
      box.append(el("fieldset", {}, [el("legend", {}, algo.name)].concat(algo.options.map((o) => {
        if (o.choices) {
          const sel = el("select", {
            onchange: (ev) => { state.options[algo.id][o.key] = ev.target.value; render(); },
          }, o.choices.map(([value, text]) => {
            const opt = el("option", { value: value }, text);
            if (value === o.default) opt.selected = true;
            return opt;
          }));
          return el("label", {}, [o.label + " ", sel]);
        }
        return el("label", {}, [o.label + " ", el("input", {
          class: "mono", value: hex(o.default, 6), spellcheck: "false",
          onchange: (ev) => {
            const v = parseInt(ev.target.value, 16);
            if (Number.isNaN(v) || v < 0) { ev.target.value = hex(state.options[algo.id][o.key], 6); return; }
            state.options[algo.id][o.key] = v;
            render();
          },
        })]);
      }))));
    }
  }

  const drop = $("drop");
  const input = $("file");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { if (input.files[0]) loadFile(input.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (ev) => { if (ev.dataTransfer.files[0]) loadFile(ev.dataTransfer.files[0]); });

  renderAlgorithms();
  renderOptions();
  self.ChecksumApp = { loadFile: loadFile };
})();
