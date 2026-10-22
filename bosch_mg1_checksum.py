#!/usr/bin/env python3
"""Bosch MG1 (MG1CA094, Bajaj / KTM / TVS) block CRCs - verify and repair.

The image has several blocks (code at 0x40000 and 0xC0000, calibration at 0x80000 on the
images seen so far). Each block starts with DE AD BE EF on a 256 KB boundary and ends with a
0x15C-byte 12345678 fill followed by a big-endian CRC:

    CRC-32 (reflected, poly 0xEDB88320, init 0xACC08E37, xorout 0xFFFFFFFF)
    of block start .. fill end  ==  zlib.crc32(block, 0x533F71C8)

Bosch MSE8.0 uses the same CRC.

Repair modes:
    update  rewrite the CRC of every block that does not match (default)
    keep    keep the stored CRC and set the free word just before the block's FA FA ..
            signature marker so the CRC still matches
"""
import argparse
import os
import struct
import sys
import zlib

SEED = 0x533F71C8
STEP = 0x40000
FILL_LEN = 0x15C
HEAD = bytes.fromhex("DEADBEEF")
FILL = bytes.fromhex("12345678")
MSE8_FOOTER = bytes.fromhex("12341008")
FA8 = b"\xfa" * 8


def find_blocks(data):
    blocks = []
    p = data.find(FILL)
    while p != -1:
        e = p
        while data[e:e + 4] == FILL:
            e += 4
        if e - p == FILL_LEN and e + 4 <= len(data) and data[e:e + 4] != MSE8_FOOTER:
            s = p // STEP * STEP
            while s >= 0 and data[s:s + 4] != HEAD:
                s -= STEP
            if s >= 0:
                blocks.append((s, e))
        p = data.find(FILL, max(e, p + 1))
    return blocks


def compute(data, block):
    s, e = block
    return zlib.crc32(bytes(data[s:e]), SEED)


def stored(data, block):
    return struct.unpack_from(">I", data, block[1])[0]


def slot_for(data, block):
    s, e = block
    fa = bytes(data).find(FA8, s, e)
    return fa - 4 if fa > s + 4 else -1


def compensate(buf, block, p, target):
    """Set the 32 bits at p so compute() == target (CRC is affine over GF(2))."""
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
    return [{"block": b[0], "offset": b[1], "stored": stored(data, b),
             "computed": compute(data, b), "ok": stored(data, b) == compute(data, b)}
            for b in find_blocks(data)]


def apply(data, mode="update"):
    """Return a corrected copy of `data`."""
    buf = bytearray(data)
    blocks = find_blocks(buf)
    if not blocks:
        raise ValueError("no MG1 block found")
    for b in blocks:
        if compute(buf, b) == stored(buf, b):
            continue
        if mode == "keep":
            p = slot_for(buf, b)
            if p < 0 or not (buf[p:p + 4] == b"\0\0\0\0" or b[1] - b[0] == 0x7F18):
                raise ValueError("keep mode: no free word before the signature in block @0x%X; "
                                 "use update mode" % b[0])
            compensate(buf, b, p, stored(buf, b))
        else:
            struct.pack_into(">I", buf, b[1], compute(buf, b))
    return bytes(buf)


def _print(results):
    for r in results:
        print(f"  block @0x{r['block']:06X}  crc @0x{r['offset']:06X}  "
              f"stored=0x{r['stored']:08X}  computed=0x{r['computed']:08X}  {'OK' if r['ok'] else 'BAD'}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verify or repair Bosch MG1 (MG1CA094) block CRCs.")
    ap.add_argument("file")
    ap.add_argument("-o", "--out", help="write the corrected image here (default: verify only)")
    ap.add_argument("--mode", choices=("update", "keep"), default="update",
                    help="update: rewrite the CRC; keep: keep the original CRC and compensate "
                         "before the signature block")
    args = ap.parse_args(argv)

    data = open(args.file, "rb").read()
    print(f"{os.path.basename(args.file)}  ({len(data)} bytes)")
    results = verify(data)
    if not results:
        print("  no MG1 block found - not an MG1 image, refusing to guess")
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
