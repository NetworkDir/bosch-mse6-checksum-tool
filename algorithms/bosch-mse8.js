/*
 * Bosch MSE8.0 (E186) - same algorithm as bosch_mse8_checksum_beta.py.
 *
 * The 256 KB calibration block is located by a footer signature at block + 0x3FFE0.
 * checksum = CRC-32 (zlib) of block[0 .. 0x3FFF8) XOR 0xA18AFC77, stored big-endian
 * at block + 0x3FFF8.
 */
(function (R) {
  "use strict";

  const BLOCK_SIZE = 0x40000;
  const CRC_REL = 0x3FFF8;
  const FOOTER_REL = 0x3FFE0;
  const FOOTER_SIG = [0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x10, 0x08];
  const K = 0xA18AFC77;

  function findBlock(bytes) {
    let pos = R.indexOf(bytes, FOOTER_SIG, 0);
    while (pos !== -1) {
      const block = pos - FOOTER_REL;
      if (block >= 0 && block + BLOCK_SIZE <= bytes.length) return block;
      pos = R.indexOf(bytes, FOOTER_SIG, pos + 1);
    }
    return null;
  }

  function compute(bytes, block) {
    return (R.crc32(bytes, block, block + CRC_REL) ^ K) >>> 0;
  }

  R.register({
    id: "bosch-mse8",
    name: "Bosch MSE8.0 (E186)",
    status: "beta",
    description: "CRC-32 of the 256 KB calibration block XOR 0xA18AFC77, block found by its footer signature.",
    tested: [],
    notes: "Beta: not yet confirmed against a flashed bike. Compare the result with a known tool before flashing.",

    verify(bytes) {
      const block = findBlock(bytes);
      if (block === null) return [];
      const stored = R.readU32BE(bytes, block + CRC_REL);
      const computed = compute(bytes, block);
      return [{
        label: "Calibration block @0x" + block.toString(16).toUpperCase(),
        offset: block + CRC_REL,
        start: block,
        end: block + CRC_REL - 1,
        stored: stored,
        computed: computed,
        ok: stored === computed,
      }];
    },

    apply(bytes) {
      const out = new Uint8Array(bytes);
      const block = findBlock(out);
      if (block === null) throw new Error("no MSE8 calibration block found");
      R.writeU32BE(out, block + CRC_REL, compute(out, block));
      return out;
    },
  });
})(self.ChecksumRegistry);
