/*
 * Bosch MG1 (MG1CA094, Bajaj / KTM / TVS) - same algorithm as bosch_mg1_checksum.py.
 *
 * The image has several blocks (code at 0x40000 and 0xC0000, calibration at 0x80000 on the
 * images seen so far). Each block starts with DE AD BE EF on a 256 KB boundary and ends with
 * a 0x15C-byte 12345678 fill followed by a big-endian CRC:
 *   CRC-32 (reflected, poly 0xEDB88320, init 0xACC08E37, xorout 0xFFFFFFFF) of block start .. fill end.
 * Bosch MSE8.0 uses the same CRC.
 *
 * Repair modes:
 *   update - rewrite the CRC of every block that does not match.
 *   keep   - keep the stored CRC and set the free word just before the block's FA FA .. signature
 *            marker so the CRC still matches (what some flash tools do on the calibration block).
 */
(function (R) {
  "use strict";

  const SEED = 0x533F71C8;            // zlib-style seed for init 0xACC08E37
  const STEP = 0x40000;
  const FILL_LEN = 0x15C;
  const HEAD = [0xDE, 0xAD, 0xBE, 0xEF];
  const FILL = [0x12, 0x34, 0x56, 0x78];
  const FA8 = [0xFA, 0xFA, 0xFA, 0xFA, 0xFA, 0xFA, 0xFA, 0xFA];

  function isFillWord(bytes, i) {
    return bytes[i] === 0x12 && bytes[i + 1] === 0x34 && bytes[i + 2] === 0x56 && bytes[i + 3] === 0x78;
  }

  function findBlocks(bytes) {
    const blocks = [];
    let p = R.indexOf(bytes, FILL, 0);
    while (p >= 0) {
      let e = p;
      while (e + 4 <= bytes.length && isFillWord(bytes, e)) e += 4;
      if (e - p === FILL_LEN && e + 4 <= bytes.length &&
          !(bytes[e] === 0x12 && bytes[e + 1] === 0x34 && bytes[e + 2] === 0x10 && bytes[e + 3] === 0x08)) {
        let s = Math.floor(p / STEP) * STEP;
        while (s >= 0 && !HEAD.every((v, i) => bytes[s + i] === v)) s -= STEP;
        if (s >= 0) blocks.push({ start: s, crc: e });
      }
      p = R.indexOf(bytes, FILL, e > p ? e : p + 1);
    }
    return blocks;
  }

  function compute(bytes, blk) {
    return R.crc32(bytes, blk.start, blk.crc, SEED);
  }

  function slotFor(bytes, blk) {
    const fa = R.indexOf(bytes, FA8, blk.start);
    return fa > blk.start + 4 && fa < blk.crc ? fa - 4 : -1;
  }

  /** Set the 32 bits at `p` so that compute() == target. CRC is affine over GF(2). */
  function compensate(out, blk, p, target) {
    const base = compute(out, blk);
    let need = (base ^ target) >>> 0;
    if (!need) return;
    const basis = new Map();
    for (let bit = 0; bit < 32; bit++) {
      const mask = 0x80 >> (bit % 8);
      out[p + (bit >> 3)] ^= mask;
      let eff = (compute(out, blk) ^ base) >>> 0;
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
    description: "CRC-32 (init 0xACC08E37) at the end of every DEADBEEF block. Bajaj / KTM / TVS.",
    tested: [
      "Bajaj Pulsar NS200 (2018-22) - BAK08IN1606005, device pairs",
      "Bajaj NS125, RS200 / Pulsar, KTM Duke 390 (2017): 10 images, 3 blocks each",
    ],
    notes: "MG1 calibrations also carry a signature: a modified file is only accepted by an ECU your flash tool has patched. This fixes the CRCs, not the signature.",
    options: [
      {
        key: "mode", label: "CRC repair", default: "update",
        choices: [
          ["update", "Rewrite the CRC"],
          ["keep", "Keep the original CRC, compensate before the signature block"],
        ],
      },
    ],

    verify(bytes) {
      return findBlocks(bytes).map((blk) => {
        const stored = R.readU32BE(bytes, blk.crc);
        const computed = compute(bytes, blk);
        return {
          label: "Block @0x" + blk.start.toString(16).toUpperCase(),
          offset: blk.crc,
          start: blk.start,
          end: blk.crc - 1,
          stored: stored,
          computed: computed,
          ok: stored === computed,
        };
      });
    },

    apply(bytes, opts) {
      const out = new Uint8Array(bytes);
      const blocks = findBlocks(out);
      if (!blocks.length) throw new Error("no MG1 block found");
      for (const blk of blocks) {
        const stored = R.readU32BE(out, blk.crc);
        if (compute(out, blk) === stored) continue;
        if ((opts && opts.mode) === "keep") {
          const p = slotFor(out, blk);
          const free = p >= 0 && out[p] === 0 && out[p + 1] === 0 && out[p + 2] === 0 && out[p + 3] === 0;
          if (p < 0 || !(free || blk.crc - blk.start === 0x7F18)) {
            throw new Error("keep mode: no free word before the signature in block @0x" +
              blk.start.toString(16) + "; use update mode");
          }
          compensate(out, blk, p, stored);
        } else {
          R.writeU32BE(out, blk.crc, compute(out, blk));
        }
      }
      return out;
    },
  });
})(self.ChecksumRegistry);
