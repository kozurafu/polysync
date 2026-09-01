# The sync engine

Implemented in `packages/sync-core`, with no dependencies. This document explains what it does and why, so the next person to touch it — or the model doing so — does not undo a decision that was made for a reason.

---

## 1. The problem, stated precisely

Given N audio signals recorded by independent devices at a shared event, find each signal's position on a common timeline, and say honestly which ones you could not place.

What makes it hard is not the correlation. It is that the signals being correlated are barely the same signal:

- A camera's on-board mic is 20–30 dB down, band-limited to roughly 250 Hz – 5 kHz, and smeared by room reflections that arrive at a different delay for every camera position.
- A boom into a field recorder is full-band, close, and clean.
- Their spectra overlap in maybe two octaves. Raw waveform correlation between them is close to worthless.
- Devices start and stop independently, so two clips may overlap by 4 seconds or not at all.
- Clocks disagree, so a single offset is not even the right model for a long clip.

## 2. Sign convention

Used everywhere, and worth stating once because getting it backwards is the classic bug:

> `offset` is the position of **b's first sample** on a timeline whose origin is **a's first sample**, in seconds.
> Positive means b started later.

That is exactly the number an NLE needs. Formally we maximise `r[τ] = Σ a[t]·b[t−τ]`, which peaks at `τ = i_a − i_b` for a shared event at index `i_a` in a and `i_b` in b — i.e. at the offset as defined. Tested directly in `test/gccphat.test.ts`.

## 3. Why GCC-PHAT

Plain cross-correlation weights every frequency by how much energy it carries, which means a loud low-frequency rumble present in both recordings dominates the result and produces a broad, ambiguous peak.

**Phase transform** weighting divides the cross-spectrum by its own magnitude before the inverse transform:

```
R(f) = A(f) · conj(B(f)) / |A(f) · conj(B(f))|
```

Every frequency now contributes equally, carrying only its *phase* relationship. Two consequences, both of which matter here:

1. **Level and EQ invariance.** Since magnitude is discarded, a 26 dB level difference and a completely different frequency response cost nothing. This is the single property that makes camera-scratch-to-boom matching work.
2. **A needle-sharp peak.** A true match becomes a single spike rather than a broad hill, which makes the *confidence measure* meaningful — see §6.

The cost is noise sensitivity: PHAT amplifies frequency bins that contain nothing but noise, since it normalises them up to full weight. That is handled by decimating first (§4), which discards the high-frequency bins where the two recordings share the least.

The exponent is tunable (`phat: 0..1` in `CorrelateOptions`). 1 is full PHAT and the default; 0.6–0.75 is worth trying on very noisy material where some magnitude weighting helps.

## 4. Coarse-to-fine

Correlating two hours of 48 kHz audio directly means a 2²⁶-point FFT: tens of seconds of compute per pair, and pointless, because sync accuracy is bounded by what the peak-picking can resolve, not by the sample rate.

So:

**Coarse pass** — decimate to ~2 kHz (anti-aliased: Blackman-windowed sinc FIR, then decimate; skipping the filter aliases transients and destroys exactly the structure we correlate on). Correlate the full length. Resolution 0.5 ms — already about 1/80 of a frame at 25 fps. This finds the right peak among all possible offsets.

**Fine pass** — take a 15 s segment from the middle of the overlap at native rate, and correlate it against a ±250 ms window of the other clip. Small transform, sample-accurate result.

**Parabolic interpolation** on the three samples around the peak gives sub-sample resolution. At 48 kHz that is well under 20 µs — two orders of magnitude finer than a frame, and far finer than anyone can perceive.

The refinement is only accepted if it does not make the match *worse* on the quality metric. A refinement that lands on a different peak is a refinement that found the wrong one.

## 5. Three candidate generators, one scorer

`alignPair` produces up to three candidate offsets and scores them identically:

1. **Timecode** — where both clips carry embedded TC, the difference *is* the offset, accurate to a frame. Not a guess: jam-synced timecode is authoritative. We still verify it by correlation, because a mis-set TC generator is a real thing.
2. **Waveform GCC-PHAT** on the 2 kHz decimation. The workhorse.
3. **Log-energy envelope** correlation. The fallback that rescues sources so dissimilar that their waveform phase never lines up — a room mic 20 m back versus a lav. Their loudness *contours* still line up exactly, because loudness contour is a property of the event, not of the microphone.

All three are scored by the same measure, the winner is refined, and only then is acceptance decided. Scoring candidates cheaply on the envelope before paying for native-rate refinement is roughly a 3× saving per pair.

## 6. Confidence: two numbers, deliberately

A sync tool that places a clip confidently and wrongly is worse than one that says "I don't know". So there are two independent measures and a match must satisfy both.

**Peak-to-sidelobe ratio (PSR)** — the correlation peak divided by the RMS of the rest of the correlation surface. Under PHAT weighting a true match produces one spike and a flat floor, giving a large PSR; a spurious match produces a low, broad, noisy surface. This measures *unambiguity*: is there one answer, or several plausible ones?

**Envelope correlation (`quality`)** — Pearson correlation of the two log-energy envelopes over the overlap, at the solved offset. Bounded to [−1, 1], directly interpretable, and this is the number shown to the user. It measures *agreement*: do these two recordings actually contain the same event?

They fail differently, which is the point. Two takes of the same song give high envelope correlation at several offsets and a poor PSR — ambiguous, so refuse. Two unrelated recordings that happen to share a rhythmic structure give a sharp PSR at one offset and poor envelope correlation — wrong, so refuse.

Plus a hard floor on **overlap length**. PluralEyes needed 5–10 seconds of usable audio; we default to a 3 s minimum and reject below it regardless of how good the correlation looks, because a 1 s overlap can correlate beautifully by accident.

## 7. Drift

Two devices never share a clock. A recorder running 20 ppm fast slips 72 ms across an hour — perfect at the head, an obvious lip-sync error at the tail. A single offset is the wrong model.

`estimateDrift` splits the overlap into ~12 windows, correlates each locally within a narrow search around the global offset, and fits a line through the local offsets by ordinary least squares. The slope is the clock ratio error; the intercept is a refined start offset.

Reported as a **rate correction in ppm** — the amount b must be sped up to hold sync — with an **R²**. Below R² 0.8 the estimate is not reported at all: a poor fit means the local measurements are noise, and reporting a drift figure derived from noise would be worse than reporting nothing.

This is deliberately *measure and report*, not *silently retime*. PluralEyes corrected drift by writing a retimed derivative audio file, which is opaque and irreversible. Showing "recorder is 18 ppm slow, 65 ms across this clip" lets the editor decide: ignore it, apply the correction on export, or go and fix the recorder.

## 8. Whole-project solve

Pairwise alignment gives edges. Turning them into a timeline:

1. Align every pair. Accept edges passing quality, PSR and overlap thresholds.
2. Sort accepted edges by a composite score — quality dominates, with overlap length and PSR breaking ties, both compressed logarithmically so a very long weak match cannot outrank a short unambiguous one.
3. Build a **maximum-confidence spanning forest** with union-find.
4. Breadth-first from each root to assign absolute positions.

Why a forest rather than pairwise placement: **transitivity**. Camera C never overlaps the recorder, but does overlap camera B, which overlaps the recorder. C lands correctly through B. A pairwise tool leaves C unsynced. Tested in `test/graph.test.ts`.

**Components with one member are the unsynced clips.** They are laid out after the main group, in order, with a gap — which is where an editor expects to find material that did not sync, and what PluralEyes' Resolve export did as a special case.

## 9. Consistency checking

Every accepted edge *not* in the spanning tree is an independent measurement of a distance the tree already fixed. Where the two disagree by more than 20 ms, at least one is wrong.

We report those pairs by name. This is the feature PluralEyes most conspicuously lacked: it could place a clip confidently and wrongly, and the first you knew was watching lips go out of sync in the edit.

## 10. Complexity, and how it stays usable

The solve is `O(n²)` in clip count. At 200 clips that is 19,900 alignments. Fine for the 50-clip projects PluralEyes recommended; not fine for a full shoot day.

The gates, applied in order:

1. **Timecode** — both clips have TC, so the pair costs a verification, not a search.
2. **Recording time** — file mtimes bracket which clips could overlap at all. Windows that do not intersect within an hour of slop cannot match.
3. **Envelope prefilter** — a full hour of envelope is 360,000 samples; correlating two takes milliseconds. Only survivors get the expensive passes.
4. **Fingerprint index** (Phase 3) — constellation hashing over envelope peak structure makes pair discovery a hash lookup, taking discovery to roughly `O(n)`.

The real bottleneck throughout is **decode, not correlation**. Extracting audio from an hour of 4K H.264 means the demuxer walking the whole file. Hence the OPFS analysis cache in [`02-architecture.md`](02-architecture.md) — decode each file exactly once, ever.

## 11. Known limits

- **Near-identical takes.** Multiple takes of the same song correlate with each other as well as with the reference. Detectable (several peaks of similar height) but not resolvable from audio alone. Fall back to recording time or filename grouping, and say so.
- **No overlap, no sync.** If only one device was rolling, there is nothing to correlate. Not a bug; a property of the method. Timecode is the only answer, which is why we read it.
- **Discontinuous clips.** A clip with an internal recording gap is two clips pretending to be one. PluralEyes required "one continuous stretch" too. We should detect long silences and offer to split.
- **Sub-3-second clips.** Rejected on principle. A 1 s overlap can correlate perfectly by chance.
- **Pure tone / silence.** Nothing to lock onto. Reported as unsynced rather than placed at zero.
- **The FFT is plain JavaScript.** Fast enough at these transform sizes — V8 is genuinely good at this, and published benchmarks have pure-JS `fft.js` beating WASM builds on Chrome. If profiling ever says otherwise, replace `fft.ts` behind its existing interface; nothing else changes.
