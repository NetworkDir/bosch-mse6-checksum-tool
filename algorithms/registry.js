/*
 * Checksum algorithm registry and shared helpers.
 *
 * Every algorithm lives in its own file under algorithms/ and calls
 * ChecksumRegistry.register({...}). See README.md, "Adding an algorithm".
 */
(function (root) {
  "use strict";

  const algorithms = [];
  let crcTable = null;

  function readU32BE(bytes, off) {
    return ((bytes[off] << 24) >>> 0) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3];
  }

  function writeU32BE(bytes, off, value) {
    bytes[off] = (value >>> 24) & 0xFF;
    bytes[off + 1] = (value >>> 16) & 0xFF;
    bytes[off + 2] = (value >>> 8) & 0xFF;
    bytes[off + 3] = value & 0xFF;
  }

  /** Standard CRC-32 (zlib / IEEE 802.3) over bytes[start, end). */
  function crc32(bytes, start, end) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** Index of the first occurrence of `pattern` in `bytes` at or after `from`, or -1. */
  function indexOf(bytes, pattern, from) {
    const last = bytes.length - pattern.length;
    outer:
    for (let i = from || 0; i <= last; i++) {
      for (let j = 0; j < pattern.length; j++) {
        if (bytes[i + j] !== pattern[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  function register(algo) {
    for (const key of ["id", "name", "verify", "apply"]) {
      if (!algo[key]) throw new Error("checksum algorithm is missing '" + key + "'");
    }
    if (algorithms.some((a) => a.id === algo.id)) throw new Error("duplicate algorithm id " + algo.id);
    algo.status = algo.status || "beta";
    algo.options = algo.options || [];
    algo.tested = algo.tested || [];
    algorithms.push(algo);
  }

  function defaultOptions(algo) {
    const opts = {};
    for (const o of algo.options) opts[o.key] = o.default;
    return opts;
  }

  /** Run every algorithm; return those that recognise the image, with their entries. */
  function detect(bytes, optionsById) {
    const matches = [];
    for (const algo of algorithms) {
      const opts = Object.assign(defaultOptions(algo), (optionsById || {})[algo.id]);
      let entries;
      try {
        entries = algo.verify(bytes, opts);
      } catch (err) {
        entries = null;
      }
      if (entries && entries.length) matches.push({ algo: algo, opts: opts, entries: entries });
    }
    return matches;
  }

  root.ChecksumRegistry = {
    algorithms: algorithms,
    register: register,
    defaultOptions: defaultOptions,
    detect: detect,
    readU32BE: readU32BE,
    writeU32BE: writeU32BE,
    crc32: crc32,
    indexOf: indexOf,
  };
})(self);
