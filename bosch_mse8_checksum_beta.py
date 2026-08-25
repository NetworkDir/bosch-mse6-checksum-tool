#!/usr/bin/env python3
import argparse
import os
import struct
import sys
import zlib

CRC_OFFSET = 0x0BFFF8
REGION_START = 0x00000000
REGION_END = 0x0BFFF8
K = 0x4B93688D
FOOTER_MAGIC = 0x12345678
FOOTER_OFFSET = 0x0BFFE0


def compute(data, start=REGION_START, end=REGION_END, k=K):
    """CRC-32 over [start, end), offset by the empirical constant K."""
    return (zlib.crc32(data[start:end]) ^ k) & 0xFFFFFFFF


def stored(data, offset=CRC_OFFSET):
    return struct.unpack_from(">I", data, offset)[0]


def looks_supported(data):
    """Cheap sanity check: the footer magic must be where we expect it."""
    if len(data) < REGION_END + 8:
        return False
    return struct.unpack_from(">I", data, FOOTER_OFFSET)[0] == FOOTER_MAGIC


def verify(data):
    return {
        "offset": CRC_OFFSET,
        "start": REGION_START,
        "end": REGION_END,
        "stored": stored(data),
        "computed": compute(data),
        "ok": stored(data) == compute(data),
    }


def apply(data):
    """Return a copy of `data` with the checksum corrected."""
    buf = bytearray(data)
    struct.pack_into(">I", buf, CRC_OFFSET, compute(buf))
    return bytes(buf)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verify or repair a Bosch MSE8 calibration checksum.")
    ap.add_argument("file")
    ap.add_argument("-o", "--out", help="write the corrected image here (default: verify only)")
    args = ap.parse_args(argv)

    data = open(args.file, "rb").read()
    print(f"{os.path.basename(args.file)}  ({len(data)} bytes)")

    if not looks_supported(data):
        print(f"  footer magic 0x{FOOTER_MAGIC:08X} not found at 0x{FOOTER_OFFSET:06X}")
        print("  this does not look like an MSE8 image — refusing to guess")
        return 2

    r = verify(data)
    print(f"  @0x{r['offset']:06X}  region 0x{r['start']:06X}-0x{r['end']:06X}  "
          f"stored=0x{r['stored']:08X}  computed=0x{r['computed']:08X}  {'OK' if r['ok'] else 'BAD'}")

    if not args.out:
        return 0 if r["ok"] else 1

    fixed = apply(data)
    with open(args.out, "wb") as fh:
        fh.write(fixed)
    rc = verify(fixed)
    print(f"\nwrote {args.out}")
    print(f"  computed=0x{rc['computed']:08X}  "
          + ("verified" if rc["ok"] else "SELF-CHECK FAILED — do not flash this file"))
    return 0 if rc["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
