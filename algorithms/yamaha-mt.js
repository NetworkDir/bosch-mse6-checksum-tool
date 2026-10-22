/*
 * Yamaha MT series (MT-25, MT-07, MT-09).
 *
 * The sum of all 16-bit big-endian words of the image, checksum included, must equal a
 * target. The checksum is the word at end - 8, right after an 8-character software ID,
 * and followed by 64 02.
 * Target 0x5AA5 for 1 MB images; 0xE81F for the 896 KB MT-07 (2020) image.
 */
(function (R) {
  "use strict";

  const TARGET = { 0x100000: 0x5AA5, 0xE0000: 0xE81F };

  function isId(bytes, off) {
    for (let i = 0; i < 8; i++) {
      const c = bytes[off + i];
      if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A))) return false;
    }
    return bytes[off + 4] === 0x59;                                   // "Y"
  }

  function layout(bytes) {
    const n = bytes.length;
    if (!(n in TARGET)) return null;
    if (!isId(bytes, n - 16) || bytes[n - 6] !== 0x64 || bytes[n - 5] !== 0x02) return null;
    return { loc: n - 8, target: TARGET[n] };
  }

  function compute(bytes, loc, target) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 2) {
      if (i !== loc) sum += (bytes[i] << 8) | bytes[i + 1];
    }
    return (target - sum) & 0xFFFF;
  }

  R.register({
    id: "yamaha-mt",
    name: "Yamaha MT series",
    status: "confirmed",
    description: "16-bit word sum of the whole image must equal 0x5AA5 (1 MB) or 0xE81F (896 KB).",
    tested: [
      "Yamaha MT-25 (2019) - BS81_128C8000",
      "Yamaha MT-07 (2014-16) - MT07A04E",
      "Yamaha MT-07 (2020, 896 KB) - B342_120C4580",
      "Yamaha MT-07 (2021) - BAT1_12464001",
      "Yamaha MT-09 SP (2019) - MT09045A",
    ],
    notes: "The 896 KB target (0xE81F) is confirmed on the MT-07 2020 image only.",

    verify(bytes) {
      const l = layout(bytes);
      if (!l) return [];
      const stored = (bytes[l.loc] << 8) | bytes[l.loc + 1];
      const computed = compute(bytes, l.loc, l.target);
      return [{
        label: "Word sum = 0x" + l.target.toString(16).toUpperCase(),
        offset: l.loc, start: 0, end: bytes.length - 1,
        stored: stored, computed: computed, ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      const l = layout(out);
      if (!l) throw new Error("not a Yamaha MT image");
      const v = compute(out, l.loc, l.target);
      out[l.loc] = v >> 8;
      out[l.loc + 1] = v & 0xFF;
      return out;
    },
  });
})(self.ChecksumRegistry);
