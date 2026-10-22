/*
 * Italjet Dragstar 200 (Suzuki-type ECU, part number 33950-03K00).
 *
 * The ID area holds AA 55 CC 33 markers. After the marker that precedes the 12-character
 * part number comes a 16-bit little-endian checksum and its complement. The checksum is
 * the byte sum of 0x20000 to the end of the image, checksum and complement included
 * (a value and its complement always add up to 0x1FE, so the sum does not depend on them).
 */
(function (R) {
  "use strict";

  const MARK = [0xAA, 0x55, 0xCC, 0x33];
  const START = 0x20000;

  function findLoc(bytes) {
    let p = R.indexOf(bytes, MARK, 0);
    while (p >= 0) {
      const loc = p + 16;
      let ascii = true;
      for (let i = p + 4; i < loc; i++) if (bytes[i] < 0x20 || bytes[i] > 0x7E) ascii = false;
      if (ascii && loc + 4 <= bytes.length &&
          (bytes[loc] ^ bytes[loc + 2]) === 0xFF && (bytes[loc + 1] ^ bytes[loc + 3]) === 0xFF) return loc;
      p = R.indexOf(bytes, MARK, p + 1);
    }
    return -1;
  }

  function compute(bytes, loc) {
    let sum = 0x1FE;
    for (let i = START; i < bytes.length; i++) if (i < loc || i >= loc + 4) sum += bytes[i];
    return sum & 0xFFFF;
  }

  R.register({
    id: "italjet-suzuki",
    name: "Italjet / Suzuki-type ECU",
    status: "confirmed",
    description: "16-bit byte sum of 0x20000-end, stored little-endian with its complement next to the part number.",
    tested: ["Italjet Dragstar 200 (2023) - 5710BL01 / 33950-03K00"],

    verify(bytes) {
      if (bytes.length !== 0x80000) return [];
      const loc = findLoc(bytes);
      if (loc < START) return [];
      const stored = bytes[loc] | (bytes[loc + 1] << 8);
      const computed = compute(bytes, loc);
      return [{
        label: "Byte sum 0x20000-end",
        offset: loc, start: START, end: bytes.length - 1,
        stored: stored, computed: computed, ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      const loc = bytes.length === 0x80000 ? findLoc(out) : -1;
      if (loc < START) throw new Error("not an Italjet / Suzuki-type image");
      const v = compute(out, loc);
      out[loc] = v & 0xFF;
      out[loc + 1] = v >> 8;
      out[loc + 2] = ~v & 0xFF;
      out[loc + 3] = (~v >> 8) & 0xFF;
      return out;
    },
  });
})(self.ChecksumRegistry);
