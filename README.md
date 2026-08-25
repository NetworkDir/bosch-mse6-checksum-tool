# bosch-mse6-checksum-tool

Verify and repair the calibration checksums in Bosch MSE6.0 ECU images — no commercial tooling required.

Edit a map in TunerPro/WinOLS, run this, flash. Zero dependencies, single file, Python 3.7+.

```
$ python bosch_mse6_checksum.py tuned.bin -o tuned_fixed.bin
tuned.bin  (1572864 bytes)
  @0x140030  region 0x140000-0x157FFB  stored=0x95D6CCB3  computed=0x94656F72  BAD
  @0x140144  region 0x140000-0x14FFFF  stored=0x55E71061  computed=0x5475B320  BAD
  @0x140154  region 0x150000-0x157FFF  stored=0x3FF159EE  computed=0x3FF159EE  OK

wrote tuned_fixed.bin
  @0x140030  region 0x140000-0x157FFB  stored=0x94656F72  computed=0x94656F72  OK
  @0x140144  region 0x140000-0x14FFFF  stored=0x5475B320  computed=0x5475B320  OK
  @0x140154  region 0x150000-0x157FFF  stored=0x3FF159EE  computed=0x3FF159EE  OK
  all records verified
```

## Install

None. Copy the file.

```bash
git clone https://github.com/<you>/bosch-mse6-checksum-tool
cd bosch-mse6-checksum-tool
python bosch_mse6_checksum.py --help
```

## Usage

Verify only — exit code `0` if every record is valid, `1` if any is wrong, `2` if no records were found:

```bash
python bosch_mse6_checksum.py image.bin
```

Repair. The output is re-verified before the command returns; if the self-check ever fails, the tool says so and exits non-zero rather than leaving you with a file you might flash:

```bash
python bosch_mse6_checksum.py image.bin -o image_fixed.bin
```

As a library:

```python
import bosch_mse6_checksum as mse6

data = open("tuned.bin", "rb").read()

for rec in mse6.verify(data):
    print(hex(rec["start"]), hex(rec["end"]), rec["ok"])

open("tuned_fixed.bin", "wb").write(mse6.apply(data))
```

## The algorithm

Each checksum is a 16-byte big-endian record stored **inside** the calibration area:

```
[start:u32][end:u32][checksum:u32][~checksum:u32]
```

`checksum` is the sum of the region's **16-bit big-endian words**, from `start` to `end` inclusive, truncated to 32 bits. That is the whole algorithm — no seed, no CRC, no polynomial.

The regions are not hardcoded anywhere: the image tells you where they are. On the reference ECU there are three records:

| Record offset | Region | Covers |
| --- | --- | --- |
| `0x140030` | `0x140000`–`0x157FFB` | entire calibration block |
| `0x140144` | `0x140000`–`0x14FFFF` | first half |
| `0x140154` | `0x150000`–`0x157FFF` | second half |

### Why it isn't self-referential

Each record sits inside the region it protects, so writing a checksum ought to invalidate the sum it was just computed from. It doesn't, because the value is stored adjacent to its own one's complement. The four 16-bit words of `[cs][~cs]` are `cs_hi + cs_lo + ~cs_hi + ~cs_lo`, and since `cs_hi + ~cs_hi = 0xFFFF` and `cs_lo + ~cs_lo = 0xFFFF`, the pair contributes exactly `0x1FFFE` **no matter what the checksum is**.

So the sum is invariant under checksum writes, and repair is a single pass — no fixed-point iteration, no ordering constraints between the three records.

That invariant is also what makes records findable without hardcoded offsets: `find_records()` scans the header area for quadruples where `cs ^ ~cs == 0xFFFFFFFF` and `start < end` spans a plausible region.

## Scope

**Confirmed:** CFMoto NK250 (2024), Bosch MSE6.0, software `F01R00DG1Z_X10A04B228`, 1.5 MB (`0x180000`) images.

**Likely, but untested:** other MSE6.0 images. Records are discovered structurally rather than by fixed offset, so a different layout should still be handled — but nobody has verified this on a second model yet. If you try one, run the verify-only mode against a known-good factory image first: if the tool reports every record `OK` on an untouched file, the algorithm matches your ECU.

If the header sits outside `0x140000`–`0x140400`, widen the scan:

```python
mse6.verify(data, scan_start=0x0, scan_end=0x200000)
```

**Out of scope:** cryptographically signed images (RSA/ECDSA) and keyed MACs. Those cannot be recomputed from examples, on any ECU, by anyone without the key.

## Contributing

Samples are more useful than code. If you have a **pre/post checksum pair** for an MSE6.0 variant this doesn't handle, open an issue — the pair alone is usually enough to extend coverage.

Pairs where the two images differ in *different areas of the map* are especially valuable: they're what pin down region boundaries. A pair differing by a single byte is better still.

## Disclaimer

For research, diagnostics, and motorsport use. Flashing an ECU can immobilise or damage a vehicle, and modifying emissions-related calibration is illegal for road use in most jurisdictions. Keep an untouched backup of the original image before writing anything. You are responsible for what you flash.

## License

MIT
