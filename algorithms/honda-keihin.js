/*
 * Honda (Keihin): X-ADV 750, ADV350.
 *
 * One checksum byte at end - 8 (surrounded by FF) makes the byte sum of the summed area
 * 0 modulo 256:
 *   X-ADV 750 (512 KB, MKH software code): the whole image.
 *   ADV350    (768 KB, KN6xxxxx ID at end - 0x80): 0x10000 to the end (calibration + code).
 */
(function (R) {
  "use strict";

  const MKH = [0x4D, 0x4B, 0x48];                                     // "MKH"

  function isKnId(bytes, off) {
    if (!(bytes[off] === 0x4B && bytes[off + 1] === 0x4E && bytes[off + 2] === 0x36)) return false;  // "KN6"
    for (let i = 3; i < 8; i++) {
      const c = bytes[off + i];
      if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A))) return false;
    }
    return true;
  }

  const MODELS = [
    { name: "X-ADV 750", size: 0x80000, start: 0, match: (b) => R.indexOf(b, MKH, 0) >= 0 },
    { name: "ADV350", size: 0xC0000, start: 0x10000, match: (b) => isKnId(b, b.length - 0x80) },
  ];

  function layout(bytes) {
    const n = bytes.length;
    const model = MODELS.find((m) => m.size === n);
    if (!model) return null;
    for (let i = n - 16; i < n; i++) {
      if (i !== n - 8 && bytes[i] !== 0xFF) return null;
    }
    if (!model.match(bytes)) return null;
    return { loc: n - 8, start: model.start, name: model.name };
  }

  function compute(bytes, l) {
    let sum = 0;
    for (let i = l.start; i < bytes.length; i++) if (i !== l.loc) sum += bytes[i];
    return (-sum) & 0xFF;
  }

  R.register({
    id: "honda-keihin",
    name: "Honda (Keihin)",
    status: "confirmed",
    description: "8-bit checksum at end - 8: the byte sum of the image (X-ADV) or of 0x10000-end (ADV350) is 0 modulo 256.",
    tested: [
      "Honda X-ADV 750 (2019) - MKHF204",
      "Honda ADV350 (2024) - KN62804B",
    ],

    verify(bytes) {
      const l = layout(bytes);
      if (!l) return [];
      const stored = bytes[l.loc];
      const computed = compute(bytes, l);
      return [{
        label: l.name + ": byte sum = 0 (mod 256)",
        offset: l.loc, start: l.start, end: bytes.length - 1,
        stored: stored, computed: computed, ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      const l = layout(out);
      if (!l) throw new Error("not a Honda Keihin image");
      out[l.loc] = compute(out, l);
      return out;
    },
  });
})(self.ChecksumRegistry);
