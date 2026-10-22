/*
 * Bosch MG1 (MG1CA094, Bajaj / KTM / TVS) - same algorithm as bosch_mg1_checksum.py.
 *
 * The 32 KB calibration block starts with DE AD BE EF and has a 12345678 fill in front of the CRC.
 * CRC = CRC-32 (zlib) of block[0 .. 0x7F18) XOR 0xC7E11B11, stored big-endian at block + 0x7F18.
 *
 * The word at block + 0x79FC is free and lies inside the CRC range. Flash tools either rewrite
 * the CRC ("update") or keep the original CRC and set that word so the CRC still matches ("keep").
 * Both are supported; both reproduce a commercial tool's output byte for byte.
 */
(function (R) {
  "use strict";

  const ALIGN = 0x8000;
  const CRC_REL = 0x7F18;
  const COMP_REL = 0x79FC;
  const K = 0xC7E11B11;
  const HEAD = [0xDE, 0xAD, 0xBE, 0xEF];
  const FILL = [0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78];

  function findBlocks(bytes) {
    const blocks = [];
    for (let off = 0; off + CRC_REL + 4 <= bytes.length; off += ALIGN) {
      if (HEAD.every((v, i) => bytes[off + i] === v) &&
          FILL.every((v, i) => bytes[off + CRC_REL - 8 + i] === v)) blocks.push(off);
    }
    return blocks;
  }

  function compute(bytes, block) {
    return (R.crc32(bytes, block, block + CRC_REL) ^ K) >>> 0;
  }

  /** Set the 32 bits at block + COMP_REL so that compute() == target. CRC is affine over GF(2). */
  function compensate(out, block, target) {
    const p = block + COMP_REL;
    const base = compute(out, block);
    let need = (base ^ target) >>> 0;
    if (!need) return;
    const basis = new Map();               // highest bit -> [effect, combination]
    for (let bit = 0; bit < 32; bit++) {
      const mask = 0x80 >> (bit % 8);
      out[p + (bit >> 3)] ^= mask;
      let eff = (compute(out, block) ^ base) >>> 0;
      out[p + (bit >> 3)] ^= mask;
      let comb = (1 << bit) >>> 0;
      for (const [hb, [e, c]] of [...basis].sort((x, y) => y[0] - x[0])) {
        if ((eff >>> hb) & 1) { eff = (eff ^ e) >>> 0; comb = (comb ^ c) >>> 0; }
      }
      if (eff) basis.set(31 - Math.clz32(eff), [eff, comb]);
    }
    let x = 0;
    for (const [hb, [e, c]] of [...basis].sort((a, b) => b[0] - a[0])) {
      if ((need >>> hb) & 1) { need = (need ^ e) >>> 0; x = (x ^ c) >>> 0; }
    }
    if (need) throw new Error("cannot compensate CRC at 0x" + p.toString(16));
    for (let bit = 0; bit < 32; bit++) {
      if ((x >>> bit) & 1) out[p + (bit >> 3)] ^= 0x80 >> (bit % 8);
    }
  }

  R.register({
    id: "bosch-mg1",
    name: "Bosch MG1 (MG1CA094)",
    status: "confirmed",
    description: "CRC-32 of the 32 KB calibration block XOR 0xC7E11B11. Bajaj / KTM / TVS.",
    tested: [
      "Bajaj Pulsar NS200 (2018-22) - BAK08IN1606005",
    ],
    notes: "MG1 calibrations also carry a signature: a modified file is only accepted by an ECU your flash tool has patched. This fixes the CRC, not the signature.",
    options: [
      {
        key: "mode", label: "CRC repair", default: "update",
        choices: [
          ["update", "Rewrite the CRC"],
          ["keep", "Keep the original CRC, compensate at block + 0x79FC"],
        ],
      },
    ],

    verify(bytes) {
      return findBlocks(bytes).map((block) => {
        const stored = R.readU32BE(bytes, block + CRC_REL);
        const computed = compute(bytes, block);
        return {
          label: "Calibration block @0x" + block.toString(16).toUpperCase(),
          offset: block + CRC_REL,
          start: block,
          end: block + CRC_REL - 1,
          stored: stored,
          computed: computed,
          ok: stored === computed,
        };
      });
    },

    apply(bytes, opts) {
      const out = new Uint8Array(bytes);
      const blocks = findBlocks(out);
      if (!blocks.length) throw new Error("no MG1 calibration block found");
      for (const block of blocks) {
        if ((opts && opts.mode) === "keep") {
          compensate(out, block, R.readU32BE(out, block + CRC_REL));
        } else {
          R.writeU32BE(out, block + CRC_REL, compute(out, block));
        }
      }
      return out;
    },
  });
})(self.ChecksumRegistry);
