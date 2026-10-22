#!/usr/bin/env python3
"""Bosch MG1 (MG1CA094, Bajaj / KTM / TVS) calibration CRC - verify and repair.

The 32 KB calibration block starts with DE AD BE EF and has a 12345678 fill in front
of the CRC. CRC = CRC-32 (zlib) of block[0 .. 0x7F18) XOR 0xC7E11B11, stored big-endian
at block + 0x7F18.

The word at block + 0x79FC is free and lies inside the CRC range. Flash tools either
rewrite the CRC (--mode update) or keep the original CRC and set that word so the CRC
still matches (--mode keep).
"""
import argparse
import os
import struct
import sys
import zlib

ALIGN = 0x8000
CRC_REL = 0x7F18
COMP_REL = 0x79FC
K = 0xC7E11B11
HEAD = bytes.fromhex("DEADBEEF")
FILL = bytes.fromhex("1234567812345678")


def find_blocks(data):
    return [off for off in range(0, len(data) - CRC_REL - 3, ALIGN)
            if data[off:off + 4] == HEAD and data[off + CRC_REL - 8:off + CRC_REL] == FILL]


def compute(data, block):
    return (zlib.crc32(bytes(data[block:block + CRC_REL])) ^ K) & 0xFFFFFFFF


def stored(data, block):
    return struct.unpack_from(">I", data, block + CRC_REL)[0]


def compensate(buf, block, target):
    """Set the 32 bits at block + COMP_REL so compute() == target (CRC is affine over GF(2))."""
    p = block + COMP_REL
    base = compute(buf, block)
    need = base ^ target
    basis = {}
    for bit in range(32):
        buf[p + bit // 8] ^= 0x80 >> (bit % 8)
        eff = compute(buf, block) ^ base
        buf[p + bit // 8] ^= 0x80 >> (bit % 8)
        comb = 1 << bit
        for hb in sorted(basis, reverse=True):
            if eff >> hb & 1:
                eff ^= basis[hb][0]
                comb ^= basis[hb][1]
        if eff:
            basis[eff.bit_length() - 1] = (eff, comb)
    x = 0
    for hb in sorted(basis, reverse=True):
        if need >> hb & 1:
            need ^= basis[hb][0]
            x ^= basis[hb][1]
    if need:
        raise ValueError("cannot compensate CRC")
    for bit in range(32):
        if x >> bit & 1:
            buf[p + bit // 8] ^= 0x80 >> (bit % 8)


def verify(data):
    return [{"block": b, "offset": b + CRC_REL, "stored": stored(data, b),
             "computed": compute(data, b), "ok": stored(data, b) == compute(data, b)}
            for b in find_blocks(data)]


def apply(data, mode="update"):
    """Return a corrected copy of `data`."""
    buf = bytearray(data)
    blocks = find_blocks(buf)
    if not blocks:
        raise ValueError("no MG1 calibration block found")
    for b in blocks:
        if mode == "keep":
            compensate(buf, b, stored(buf, b))
        else:
            struct.pack_into(">I", buf, b + CRC_REL, compute(buf, b))
    return bytes(buf)


def _print(results):
    for r in results:
        print(f"  block @0x{r['block']:06X}  crc @0x{r['offset']:06X}  "
              f"stored=0x{r['stored']:08X}  computed=0x{r['computed']:08X}  {'OK' if r['ok'] else 'BAD'}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verify or repair a Bosch MG1 (MG1CA094) calibration CRC.")
    ap.add_argument("file")
    ap.add_argument("-o", "--out", help="write the corrected image here (default: verify only)")
    ap.add_argument("--mode", choices=("update", "keep"), default="update",
                    help="update: rewrite the CRC; keep: keep the original CRC and compensate at block + 0x79FC")
    args = ap.parse_args(argv)

    data = open(args.file, "rb").read()
    print(f"{os.path.basename(args.file)}  ({len(data)} bytes)")
    results = verify(data)
    if not results:
        print("  calibration block not found - not an MG1 image, refusing to guess")
        return 2
    _print(results)
    if not args.out:
        return 0 if all(r["ok"] for r in results) else 1

    fixed = apply(data, args.mode)
    with open(args.out, "wb") as fh:
        fh.write(fixed)
    recheck = verify(fixed)
    print(f"\nwrote {args.out}")
    _print(recheck)
    ok = all(r["ok"] for r in recheck)
    print("  verified" if ok else "  SELF-CHECK FAILED - do not flash this file")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
