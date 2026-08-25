#!/usr/bin/env python3
import argparse
import os
import struct
import sys
import zlib

BLOCK_SIZE = 0x40000
CRC_REL = 0x3FFF8            # checksum offset within the block
FOOTER_REL = 0x3FFE0         # footer signature offset within the block
FOOTER_SIG = bytes.fromhex("1234567812341008")
K = 0xA18AFC77


def find_block(data):
    """Return the absolute offset of the calibration block, or None."""
    pos = data.find(FOOTER_SIG)
    while pos != -1:
        block = pos - FOOTER_REL
        if block >= 0 and block + BLOCK_SIZE <= len(data):
            return block
        pos = data.find(FOOTER_SIG, pos + 1)
    return None


def compute(data, block):
    return (zlib.crc32(data[block:block + CRC_REL]) ^ K) & 0xFFFFFFFF


def stored(data, block):
    return struct.unpack_from(">I", data, block + CRC_REL)[0]


def verify(data):
    block = find_block(data)
    if block is None:
        return None
    return {
        "block": block,
        "offset": block + CRC_REL,
        "stored": stored(data, block),
        "computed": compute(data, block),
        "ok": stored(data, block) == compute(data, block),
    }


def apply(data):
    """Return a copy of `data` with the checksum corrected."""
    block = find_block(data)
    if block is None:
        raise ValueError("no MSE8 calibration block found")
    buf = bytearray(data)
    struct.pack_into(">I", buf, block + CRC_REL, compute(buf, block))
    return bytes(buf)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verify or repair a Bosch MSE8.0 (E186) checksum.")
    ap.add_argument("file")
    ap.add_argument("-o", "--out", help="write the corrected image here (default: verify only)")
    args = ap.parse_args(argv)

    data = open(args.file, "rb").read()
    print(f"{os.path.basename(args.file)}  ({len(data)} bytes)")

    r = verify(data)
    if r is None:
        print("  calibration block signature not found — not an MSE8 image, refusing to guess")
        return 2
    print(f"  block @0x{r['block']:06X}  crc @0x{r['offset']:06X}  "
          f"stored=0x{r['stored']:08X}  computed=0x{r['computed']:08X}  {'OK' if r['ok'] else 'BAD'}")

    if not args.out:
        return 0 if r["ok"] else 1

    fixed = apply(data)
    with open(args.out, "wb") as fh:
        fh.write(fixed)
    rc = verify(fixed)
    print(f"\nwrote {args.out}")
    print("  " + ("verified" if rc["ok"] else "SELF-CHECK FAILED — do not flash this file"))
    return 0 if rc["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
