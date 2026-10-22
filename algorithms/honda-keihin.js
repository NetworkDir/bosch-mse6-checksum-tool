/*
 * Honda X-ADV 750 (Keihin).
 *
 * One checksum byte at end - 8 (surrounded by FF) makes the sum of all bytes of the
 * image 0 modulo 256. Recognised by the MKH software code in the image.
 */
(function (R) {
  "use strict";

  const MKH = [0x4D, 0x4B, 0x48];                                     // "MKH"

  function layout(bytes) {
    const n = bytes.length;
    if (n !== 0x80000) return null;
    for (let i = n - 16; i < n; i++) {
      if (i !== n - 8 && bytes[i] !== 0xFF) return null;
    }
    if (R.indexOf(bytes, MKH, 0) < 0) return null;
    return { loc: n - 8 };
  }

  function compute(bytes, loc) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) if (i !== loc) sum += bytes[i];
    return (-sum) & 0xFF;
  }

  R.register({
    id: "honda-keihin",
    name: "Honda X-ADV 750 (Keihin)",
    status: "confirmed",
    description: "8-bit checksum: the sum of all bytes of the image is 0 modulo 256.",
    tested: ["Honda X-ADV 750 (2019) - MKHF204"],

    verify(bytes) {
      const l = layout(bytes);
      if (!l) return [];
      const stored = bytes[l.loc];
      const computed = compute(bytes, l.loc);
      return [{
        label: "Byte sum = 0 (mod 256)",
        offset: l.loc, start: 0, end: bytes.length - 1,
        stored: stored, computed: computed, ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      const l = layout(out);
      if (!l) throw new Error("not a Honda X-ADV image");
      out[l.loc] = compute(out, l.loc);
      return out;
    },
  });
})(self.ChecksumRegistry);
