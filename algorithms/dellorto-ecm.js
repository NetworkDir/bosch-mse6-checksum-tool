/*
 * Dell'Orto ECM (Bajaj RS200 2024).
 *
 * The calibration block at 0x80000 (starts with its "JL" part number) ends with a 16-bit
 * big-endian checksum at 0x921FE: the one's complement of the byte sum of 0x80000-0x921FD.
 */
(function (R) {
  "use strict";

  const SIG = Array.from("DellOrto 32bit Engine Management System", (c) => c.charCodeAt(0));
  const BLOCK = 0x80000;
  const LOC = 0x921FE;

  function recognised(bytes) {
    return bytes.length === 0xC0000 &&
      bytes[BLOCK] === 0x4A && bytes[BLOCK + 1] === 0x4C &&          // "JL"
      R.indexOf(bytes, SIG, 0) >= 0;
  }

  function compute(bytes) {
    let sum = 0;
    for (let i = BLOCK; i < LOC; i++) sum += bytes[i];
    return (~sum) & 0xFFFF;
  }

  R.register({
    id: "dellorto-ecm",
    name: "Dell'Orto ECM",
    status: "confirmed",
    description: "One's complement of the byte sum of the calibration block 0x80000-0x921FD.",
    tested: ["Bajaj RS200 (2024) - JL351458010651, 3 calibrations"],

    verify(bytes) {
      if (!recognised(bytes)) return [];
      const stored = (bytes[LOC] << 8) | bytes[LOC + 1];
      const computed = compute(bytes);
      return [{
        label: "Calibration block @0x80000",
        offset: LOC, start: BLOCK, end: LOC - 1,
        stored: stored, computed: computed, ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      if (!recognised(out)) throw new Error("not a Dell'Orto ECM image");
      const v = compute(out);
      out[LOC] = v >> 8;
      out[LOC + 1] = v & 0xFF;
      return out;
    },
  });
})(self.ChecksumRegistry);
