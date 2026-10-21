# bosch-mse6-checksum-tool

Verify and repair the calibration checksums in Bosch MSE6.0 ECU images — no commercial tooling required.

Edit a map in TunerPro/WinOLS, run this, flash. Zero dependencies, single file, Python 3.7+.

**Web version: [networkdir.github.io/bosch-mse6-checksum-tool](https://networkdir.github.io/bosch-mse6-checksum-tool/)**: drop an image, download the fixed file. It runs entirely in your browser, so your file is never uploaded. It detects the algorithm automatically and supports Bosch MSE6.0 and MSE8.0 (E186). See [Web version](#web-version).

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

**Confirmed** (Bosch MSE6.0, 1.5 MB / `0x180000` images):

| Vehicle | Software | How it was confirmed |
| --- | --- | --- |
| CFMoto NK250 (2024) | `F01R00DG1Z_X10A04B228` | Reference ECU the tool was developed on |
| CFMoto 450SR (2023) | `F01R00DKAI_X10G04A120` | Repaired output of a modified image is byte-identical (MD5) to a commercial flash tool's checksum correction of the same image; flashed and running |

The 450SR `X10G04A121` calibration uses the same record layout (checked on a bench read).

> **450SR factory images report `BAD`.** Untouched `X10G04A120` and `X10G04A121` reads fail the two records whose regions include `0x140000`–`0x14FFFF` (the `0x150000`–`0x157FFF` record passes), even though the bike runs on them. The stored values simply don't match the image as read, so the factory-image test below does not work on this model. Use the comparison method instead: correct a modified file with a known tool and with this script, and check that the outputs are identical.

**Likely, but untested:** other MSE6.0 images. Records are discovered structurally rather than by fixed offset, so a different layout should still be handled. If you try one, run the verify-only mode against a known-good factory image first: if the tool reports every record `OK` on an untouched file, the algorithm matches your ECU. If the factory image fails (as on the 450SR), compare against a file corrected by a known tool instead.

**Confirmed, Bosch MSE8.0 / E186** (`bosch_mse8_checksum_beta.py` despite its name, and the web version): CRC-32 of the 256 KB calibration block XOR `0xA18AFC77`, stored big-endian at block + `0x3FFF8`. The block is found by its footer signature at block + `0x3FFE0`.

| Vehicle | Software | How it was confirmed |
| --- | --- | --- |
| RKS RZ125S (2024) | `F01RB0D2G0_XD105A1A25` | Repaired output of a modified image is byte-identical (MD5) to a commercial flash tool's checksum correction of the same image (block at `0x80000`, 4 bytes changed) |

If the MSE6.0 header sits outside `0x140000`–`0x140400`, widen the scan:

```python
mse6.verify(data, scan_start=0x0, scan_end=0x200000)
```

**Out of scope:** cryptographically signed images (RSA/ECDSA) and keyed MACs. Those cannot be recomputed from examples, on any ECU, by anyone without the key.

## Web version

`index.html` is a static page served by GitHub Pages. The algorithms are plain JavaScript ports of the Python scripts and produce byte-identical output:

```
index.html                 page
app.js                     UI: load file, detect, show records, fix, download
algorithms/registry.js     registry + shared helpers (u32 read/write, CRC-32, byte search)
algorithms/bosch-mse6.js   Bosch MSE6.0 (same as bosch_mse6_checksum.py)
algorithms/bosch-mse8.js   Bosch MSE8.0 / E186 (same as bosch_mse8_checksum_beta.py)
```

When a file is loaded, every registered algorithm is tried and the ones that recognise the image are offered. The fixed file is re-verified before it is downloaded; if the self-check fails, nothing is downloaded.

To run it locally, serve the folder with any static server, e.g. `python -m http.server`, and open `http://localhost:8000`.

### Adding an algorithm

1. Create `algorithms/<name>.js`:

   ```js
   (function (R) {
     "use strict";
     R.register({
       id: "vendor-ecu",            // unique
       name: "Vendor ECU",          // shown in the UI
       status: "beta",              // "confirmed" once its output matches a known tool on a real image
       description: "One line about the algorithm.",
       tested: [],                  // e.g. ["Bike (year) - software id"]
       notes: "",                   // optional warning shown with the results
       options: [],                 // optional hex inputs: { key, label, default }

       // Return [] if the image is not recognised, otherwise one entry per checksum:
       // { label, offset, start, end, stored, computed, ok }
       verify(bytes, opts) { return []; },

       // Return a corrected copy (Uint8Array). Never modify `bytes`.
       apply(bytes, opts) { return new Uint8Array(bytes); },
     });
   })(self.ChecksumRegistry);
   ```

2. Add `<script src="algorithms/<name>.js"></script>` to `index.html`, next to the others.

Helpers available on `R`: `readU32BE`, `writeU32BE`, `crc32(bytes, start, end)`, `indexOf(bytes, pattern, from)`.

## Contributing

Samples are more useful than code. If you have a **pre/post checksum pair** for an MSE6.0 variant this doesn't handle, open an issue — the pair alone is usually enough to extend coverage.

Pairs where the two images differ in *different areas of the map* are especially valuable: they're what pin down region boundaries. A pair differing by a single byte is better still.

## Disclaimer

For research, diagnostics, and motorsport use. Flashing an ECU can immobilise or damage a vehicle, and modifying emissions-related calibration is illegal for road use in most jurisdictions. Keep an untouched backup of the original image before writing anything. You are responsible for what you flash.

## License

MIT
