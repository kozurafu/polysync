# Risks and open questions

Ordered by how likely each is to actually sink the project.

---

## 1. Codec coverage in the browser · **high likelihood, medium impact**

Some professional formats cannot be decoded in a browser. R3D, ARRIRAW and DNxHD/HR have no path at all; MXF depends on `mxf.js`, a v0.1.0 package from a single author with no public repository listed on npm, Chromium-only and untested elsewhere.

**Why it is survivable:** we only need the *audio* track, which is a far easier problem than playing the picture — and for most shoots the reference track is a sound recorder writing plain PCM, which needs no codec support whatsoever. PluralEyes itself listed MXF and R3D as "syncs but no video preview".

**Mitigation:** the fallback ladder in [`02-architecture.md`](02-architecture.md), ending in a generated one-line ffmpeg command that extracts sidecar WAVs. Audit `mxf.js` before depending on it, and be prepared to fork it. Never let an unsupported format fail silently — name the file and say what to do.

## 2. Test corpus · **high likelihood, high impact**

The engine is proven against synthetic material that models the right degradations. It is not yet proven against a Sony camera that writes something unexpected into a `udta` atom, or a Zoom recorder whose `bext` chunk disagrees with its iXML.

**Why it matters more than it looks:** this is the difference between a demo and a tool. Every real sync tool's reliability comes from having been broken by real files.

**Mitigation:** start collecting sample media before writing Phase 1 ingest code. Minimum viable corpus: Canon C-series MOV, Sony XAVC MXF, Panasonic AVCHD MTS, iPhone HEVC, Zoom H-series WAV, Sound Devices poly-WAV with iXML, Tascam BWF, plus one genuinely awful handheld recording. Build a regression harness that runs the whole corpus and asserts known offsets.

## 3. File System Access is Chromium-only · **certain, low impact**

Firefox's standards position on FSA is "harmful"; Safari does not implement it and shows no sign of doing so. Global coverage is around 27%.

**Why it is low impact:** `File.slice()` is a lazy range read everywhere, so large-file *reading* works identically on all browsers. What Safari and Firefox lose is persistent handles — the folder must be re-dropped each session. Project state lives in OPFS, which works everywhere, so a re-drop relinks rather than re-analyses. That is the same "relink media" flow every NLE already has.

**Mitigation:** ship `browser-fs-access`, be explicit in the UI about what Chrome gives you, and offer the Electron build to anyone who wants a real library.

## 4. Sync failure modes the algorithm cannot fix · **certain, medium impact**

Near-identical takes, clips with no overlap at all, discontinuous recordings, sub-3-second clips, near-silence. These are properties of audio correlation, not bugs.

**Mitigation:** detect each, refuse to guess, and say precisely why. The consistency checker catches the dangerous case — a confident, wrong placement — which is the one PluralEyes could not catch. Being trusted matters more than a higher headline match rate.

## 5. Performance at scale · **medium likelihood, medium impact**

The solve is `O(n²)` in clip count. 200 clips is nearly 20,000 alignments.

**Why it is manageable:** the gates (timecode, recording-time bracketing, envelope prefilter, then fingerprint indexing) cut the practical count by orders of magnitude, and the real bottleneck is decode, which the OPFS cache makes a once-ever cost. But this is untested at scale and the estimates in [`06-browser-platform.md`](06-browser-platform.md) are extrapolations, not browser benchmarks.

**Mitigation:** benchmark on real material at Phase 1, not Phase 4. If the gates are not enough, the fingerprint index moves from Phase 4 to Phase 2.

## 6. Nobody wants it · **the honest one**

PluralEyes was discontinued because Maxon judged that every NLE now does waveform sync well enough. They were partly right: for a two-source interview, Premiere is fine and free.

The counter-evidence is real — an Adobe feature request titled *"Editors need a multicam/multilayer audio sync feature since plural eyes has stopped working"* is still open, and paid alternatives (Syncaila at $249, CamHeard at $129) exist and sell. But the addressable market is "people whose shoots break built-in sync", which is smaller than "people who shoot multicam".

**What follows from that:** the differentiators must be the ones the built-in tools genuinely lack — whole-day solving, drift measurement, honest failure reporting, restored user control — not "syncs audio", which is table stakes. And the local-first, no-upload, no-account property is worth real money to people handling client material under NDA.

## 7. Open questions

- **Current FCPXML DTD version.** Apple's public docs still reference 1.9; newer DTDs ship inside the Final Cut app bundle. Targeting 1.9/1.10 is the safe call, but confirm against a current Final Cut install before shipping the FCPXML exporter.
- **Firefox AAC in WebCodecs.** MDN says unsupported; Firefox *does* decode AAC in `<audio>` via platform decoders, so the WebCodecs-specific gap may be narrower than documented. Probe with `AudioDecoder.isConfigSupported()` rather than trusting either source.
- **Electron and persistent FSA permissions.** An open Electron issue from the Chrome 122 rollout; status in Electron 44 unconfirmed. Moot if the Electron build uses Node `fs` directly, which it probably should.
- **Naming.** "Polysync" is a working title and the name is in use elsewhere in unrelated fields. Worth a trademark check before any public launch.
- **Licence and business model.** Currently MIT. Open-source with a paid desktop build, fully commercial, or fully free are all live options and the decision affects nothing technical yet — but it does affect whether the AAF and Premiere-panel decisions stay "no".
