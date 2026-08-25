#!/usr/bin/env python3
"""Bosch MSE6.0 ECU calibration checksum — verify and repair.

Checksum record layout (big-endian, 16 bytes)::

    [start:u32][end:u32][checksum:u32][~checksum:u32]

``checksum`` is the sum of the region's 16-bit big-endian words, from ``start``
to ``end`` inclusive, truncated to 32 bits.

The records live inside the very regions they protect, which would normally make
them self-referential. It works because each value is stored next to its own
one's complement: those four 16-bit words always sum to 0x1FFFE regardless of
the checksum value, so writing a new checksum never perturbs the sum being
computed. Neat trick, and it means repair needs no fixed-point iteration.

Records are located by structural scan rather than hardcoded offsets, so this
may work on related MSE6.0 images with a different layout — see README.
"""
import argparse
import os
import struct
import sys

MASK = 0xFFFFFFFF
SCAN_START = 0x140000
SCAN_END = 0x140400
MIN_SPAN = 0x1000


def sum16be(buf, start, end):
    """Sum of 16-bit big-endian words over [start, end] inclusive, mod 2**32."""
    total = 0
    for off in range(start, end, 2):
        total += (buf[off] << 8) | buf[off + 1]
    return total & MASK


def find_records(buf, scan_start=SCAN_START, scan_end=SCAN_END):
    """Locate [start][end][cs][~cs] records by their structural invariants."""
    records = []
    limit = min(scan_end, len(buf) - 16)
    for off in range(scan_start, limit + 1, 4):
        start, end, cs, ncs = struct.unpack_from(">IIII", buf, off)
        if (cs ^ ncs) != MASK:
            continue
        if not (0 <= start < end < len(buf)):
            continue
        if (end - start) < MIN_SPAN:
            continue
        records.append({"offset": off, "start": start, "end": end, "stored": cs})
    return records


def verify(data, **kw):
    """Return one result dict per record: offset, start, end, stored, computed, ok."""
    results = []
    for rec in find_records(data, **kw):
        computed = sum16be(data, rec["start"], rec["end"])
        results.append({**rec, "computed": computed, "ok": computed == rec["stored"]})
    return results


def apply(data, **kw):
    """Return a copy of `data` with every checksum record corrected."""
    buf = bytearray(data)
    for rec in find_records(buf, **kw):
        computed = sum16be(buf, rec["start"], rec["end"])
        struct.pack_into(">II", buf, rec["offset"] + 8, computed, computed ^ MASK)
    return bytes(buf)


def _print_records(results):
    for r in results:
        status = "OK" if r["ok"] else "BAD"
        print(f"  @0x{r['offset']:06X}  region 0x{r['start']:06X}-0x{r['end']:06X}  "
              f"stored=0x{r['stored']:08X}  computed=0x{r['computed']:08X}  {status}")


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Verify or repair Bosch MSE6.0 calibration checksums.")
    ap.add_argument("file", help="ECU image (.bin/.dtf/.MOD)")
    ap.add_argument("-o", "--out", help="write the corrected image here (default: verify only)")
    args = ap.parse_args(argv)

    data = open(args.file, "rb").read()
    print(f"{os.path.basename(args.file)}  ({len(data)} bytes)")

    results = verify(data)
    if not results:
        print("  no checksum records found — is this an MSE6.0 image?")
        return 2
    _print_records(results)

    if not args.out:
        return 0 if all(r["ok"] for r in results) else 1

    fixed = apply(data)
    with open(args.out, "wb") as fh:
        fh.write(fixed)
    recheck = verify(fixed)
    ok = all(r["ok"] for r in recheck)
    print(f"\nwrote {args.out}")
    _print_records(recheck)
    print("  all records verified" if ok else "  SELF-CHECK FAILED — do not flash this file")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
