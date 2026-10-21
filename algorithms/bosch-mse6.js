/*
 * Bosch MSE6.0 - same algorithm as bosch_mse6_checksum.py.
 *
 * Record layout (big-endian, 16 bytes): [start:u32][end:u32][checksum:u32][~checksum:u32]
 * checksum = sum of 16-bit big-endian words from start to end inclusive, mod 2^32.
 * Records are found by structure (cs ^ ~cs == 0xFFFFFFFF), not by fixed offset.
 */
(function (R) {
  "use strict";

  const MASK = 0xFFFFFFFF;
  const MIN_SPAN = 0x1000;

  function sum16be(bytes, start, end) {
    let total = 0;
    for (let off = start; off < end; off += 2) total += (bytes[off] << 8) | bytes[off + 1];
    return total % 4294967296;
  }

  function findRecords(bytes, scanStart, scanEnd) {
    const records = [];
    const limit = Math.min(scanEnd, bytes.length - 16);
    for (let off = scanStart; off <= limit; off += 4) {
      const start = R.readU32BE(bytes, off);
      const end = R.readU32BE(bytes, off + 4);
      const cs = R.readU32BE(bytes, off + 8);
      const ncs = R.readU32BE(bytes, off + 12);
      if (((cs ^ ncs) >>> 0) !== MASK) continue;
      if (!(start < end && end < bytes.length)) continue;
      if (end - start < MIN_SPAN) continue;
      records.push({ offset: off, start: start, end: end, stored: cs });
    }
    return records;
  }

  R.register({
    id: "bosch-mse6",
    name: "Bosch MSE6.0",
    status: "confirmed",
    description: "16-bit word sum stored next to its one's complement, several records in the calibration header.",
    tested: [
      "CFMoto NK250 (2024) - F01R00DG1Z_X10A04B228",
      "CFMoto 450SR (2023) - F01R00DKAI_X10G04A120",
    ],
    notes: "CFMoto 450SR factory images report BAD even when untouched; the bike runs on them anyway.",
    options: [
      { key: "scanStart", label: "Record scan start", default: 0x140000 },
      { key: "scanEnd", label: "Record scan end", default: 0x140400 },
    ],

    verify(bytes, opts) {
      return findRecords(bytes, opts.scanStart, opts.scanEnd).map((rec) => {
        const computed = sum16be(bytes, rec.start, rec.end);
        return {
          label: "Record @0x" + rec.offset.toString(16).toUpperCase(),
          offset: rec.offset + 8,
          start: rec.start,
          end: rec.end,
          stored: rec.stored,
          computed: computed,
          ok: computed === rec.stored,
        };
      });
    },

    apply(bytes, opts) {
      const out = new Uint8Array(bytes);
      for (const rec of findRecords(out, opts.scanStart, opts.scanEnd)) {
        const computed = sum16be(out, rec.start, rec.end);
        R.writeU32BE(out, rec.offset + 8, computed);
        R.writeU32BE(out, rec.offset + 12, (computed ^ MASK) >>> 0);
      }
      return out;
    },
  });
})(self.ChecksumRegistry);
