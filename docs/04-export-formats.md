# Export formats

Every export is a small text file that **references** the original media. Nothing is re-encoded, nothing is duplicated on disk. That was PluralEyes' model and it is the right one.

The timeline being described is trivially simple — a set of clips with in/out points and per-clip offsets, no effects, no nesting — so all four text formats are easier to write by hand than to adopt a library for. The existing libraries are built for richer timelines and will fight you.

---

## 1. FCP7 XML / XMEML v5 — the workhorse

**Consumed by:** Premiere Pro, DaVinci Resolve, Vegas Pro, Lightworks, Media Composer (partially), and almost everything else.

Deprecated for over a decade and still the most reliable interchange in the industry. Adobe publishes no specification; the community works from the legacy FCP7 DTD and from round-tripping real exports.

Shape:

```xml
<xmeml version="5">
  <sequence>
    <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video><track><clipitem>…</clipitem></track></video>
      <audio><track><clipitem>…</clipitem></track></audio>
    </media>
  </sequence>
</xmeml>
```

Rules that matter:

- **Integer frame numbers only** for `<start>`, `<end>`, `<in>`, `<out>`. Sub-frame offsets are rounded here — this is the one place sample accuracy is lost, and it is a property of the format, not of us. FCPXML and OTIO keep sub-frame precision; note the difference in the UI.
- `<rate>` on the sequence *and* on every file. NTSC rates are `<timebase>30</timebase><ntsc>TRUE</ntsc>`, meaning 30000/1001.
- `<file>` needs `<pathurl>file:///…</pathurl>`, properly percent-encoded. Every `<file>` gets an `id` and is referenced by `<file id="…"/>` thereafter; repeating the full definition bloats the file and confuses Premiere.
- One track per device, matching the review timeline.
- `<labels><label2>` carries the clip colour — this is how unsynced clips are marked red on import.

**Two sequences**, matching PluralEyes: `<project>_synced` with original camera audio, and `<project>_replaced` with the external audio substituted and trimmed to picture length.

**Documented gotchas to avoid inheriting.** PluralEyes only used the topmost overlapping audio-only track on Premiere export, silently dropping additional recorders — we map all of them. And Premiere's *Project Settings → General → "Display the project item name and label color for all instances"* silently overrides label colours, defeating the unsynced marking; say so in the UI rather than letting the user wonder.

## 2. CMX3600 EDL

**Consumed by:** everything, including EDIUS and Lightworks, which is why PluralEyes' lack of it was a real gap.

Fixed-column ASCII, ~80 lines of writer:

```
TITLE: SHOOT_DAY_01
FCM: NON-DROP FRAME

001  CAM_A    AA/V  C        00:00:12:11 00:01:44:03 00:00:00:00 00:01:31:17
```

Constraints: reel names ≤ 8 characters (so device names must be sanitised and a mapping table emitted as comments), `FCM:` header declares drop/non-drop, and one EDL per track since CMX3600 is single-track by design. Offsets land as record-in timecode.

Lossy — no clip names beyond the reel, no colours — but universal.

## 3. FCPXML

**Consumed by:** Final Cut Pro.

Target **1.9 or 1.10**. Apple's live developer documentation still only states "FCPXML 1.9 requires Final Cut Pro 10.4.9 or later"; newer DTDs ship inside the app bundle rather than on the web. Older FCPXML imports into newer Final Cut fine; the reverse does not. Do not chase the newest version number.

Key differences from FCP7 XML:

- **Rational time**, e.g. `"1001/30000s"`. Use exact fractions and never floating point — this is where sub-frame precision survives.
- A `<resources>` block declares every `<asset>` and `<format>` once; the timeline references them by id.
- Three files, matching PluralEyes: the base sequence, a `_replaced` variant using compound clips for substituted audio, and a `_multicam` variant building an FCPX multicam clip in an event named `<project> mc`.

**Validate against the DTD before writing.** PluralEyes' most notorious bug was emitting FCPXML that failed Final Cut's DTD validation on import — usually after a round trip from Final Cut where audio filters, keywords or in/out points had been applied. Refusing to write an invalid file is a better product than emitting one and letting Final Cut reject it with a useless message.

## 4. OpenTimelineIO

Typed JSON, simple enough to emit directly. Costs almost nothing, future-proofs the round trip, and is the only format on this list that carries the full offset precision *and* arbitrary metadata — so it is where drift measurements and match-quality scores can live without being invented into a format that has no slot for them.

## 5. AAF — not doing it

Binary Microsoft Structured Storage plus the AAF object model with SMPTE UL keys, a class dictionary, and the MOB/slot graph. **No JavaScript or TypeScript AAF library exists.** The only real implementations are the C++ AAF SDK and Python's `pyaaf2`. Media Composer's importer is unforgiving, so the test cycle is brutal.

Weeks of work for a format PluralEyes itself dropped in version 4 as "technically difficult to maintain". Picture edit takes XML. If a real customer needs AAF, do it as a separate server-side conversion with `pyaaf2` rather than in the browser.

## 6. New media files — Phase 4

PluralEyes could write trimmed audio files, or video files with the camera audio replaced. Useful for NLEs with no XML path at all. Needs an *encoder*, which is a materially larger dependency than a decoder — `mediabunny` can write MP4/WAV, and WebCodecs has encoders for AAC and Opus but none for PCM. Real, but not the core, and every export path above is more valuable per hour spent.

## 7. Round-trip *in*

Parsing FCP7 XML and FCPXML on import lets a user sync material already conformed into an NLE, which is how a lot of people actually work. Phase 3, and it shares all the format knowledge above.
