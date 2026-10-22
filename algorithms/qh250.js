/*
 * QH250 (software E2400-05).
 *
 * The 32 KB data block at 0x0000 (starts with AA AA, ends with 55 54 AA 45) carries a
 * 16-bit checksum at 0x7FEE: the sum of the big-endian words 0x0000-0x7FEF, checksum
 * included, is 0.
 */
(function (R) {
  "use strict";

  const LOC = 0x7FEE;
  const END = 0x7FF0;

  function recognised(bytes) {
    return bytes.length === 0x140000 &&
      bytes[0] === 0xAA && bytes[1] === 0xAA &&
      bytes[0x7FFC] === 0x55 && bytes[0x7FFD] === 0x54 && bytes[0x7FFE] === 0xAA && bytes[0x7FFF] === 0x45;
  }

  function compute(bytes) {
    let sum = 0;
    for (let i = 0; i < END; i += 2) if (i !== LOC) sum += (bytes[i] << 8) | bytes[i + 1];
    return (-sum) & 0xFFFF;
  }

  R.register({
    id: "qh250",
    name: "QH250 (E2400)",
    status: "confirmed",
    description: "16-bit word sum of the 32 KB data block at 0x0000 is 0, checksum at 0x7FEE.",
    tested: ["QH250 - E2400-05"],

    verify(bytes) {
      if (!recognised(bytes)) return [];
      const stored = (bytes[LOC] << 8) | bytes[LOC + 1];
      const computed = compute(bytes);
      return [{
        label: "Data block word sum = 0",
        offset: LOC, start: 0, end: END - 1,
        stored: stored, computed: computed, ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      if (!recognised(out)) throw new Error("not a QH250 image");
      const v = compute(out);
      out[LOC] = v >> 8;
      out[LOC + 1] = v & 0xFF;
      return out;
    },
  });
})(self.ChecksumRegistry);
