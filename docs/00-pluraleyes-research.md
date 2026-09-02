# PluralEyes — Complete Feature Inventory for Rebuild (v3 / v3.5 / v4 / v4.1)

*Research compiled September 2026 from Maxon's official manual (help.maxon.net), Maxon/Red Giant knowledge-base articles, ProVideoCoalition, CineD, Creative COW, Adobe Community, Blackmagic Forum, and period reviews. Every claim below is sourced; anything I could not verify is explicitly flagged **[UNVERIFIED]**.*

---

## 0. Company/Product History & Status

| Date | Event |
|---|---|
| 2009 | Bruce Sharpe's Singular Software releases PluralEyes 1.0. Adds Vegas Pro, Premiere Pro, and Final Cut Pro (Classic) support. |
| Oct 2010 | v1.2 for FCP adds "Replace Audio" for dual-system audio and multi-clip support. |
| Jan 2011 | PluralEyes for Avid Media Composer ships, v1.0, launch price **$119** (reg. price implies ~$149). AAF round-trip only; no "Replace Audio," no "Single Output Sequence," no auto group-clip creation; blocked by Unity storage and AMA-linked media; subject to Avid's 24 video/audio track limit. |
| 2011 | Media Composer support broadens. |
| 2012 | **Red Giant Software acquires Singular Software and PluralEyes.** |
| Nov 2012 | PluralEyes 3.0/3.1 ships as a new **standalone application** (previously a plugin only) — new timeline-based UI, "Do It For Me" automation, sync ~20x faster than v2. Pricing: **$199 new / $79 upgrade** from PluralEyes 2 or DualEyes. Adds native MXF and Mac Avid AAF round-trip. |
| ~2014 | PluralEyes 3.5 ships inside **Shooter Suite 12.5**. New: **automatic audio Drift Correction** (fixes in-camera recording-speed mismatch on long clips), expanded AVCHD spanned-clip support, wider Replace-Audio format coverage. Pricing: PluralEyes 3.5 alone **$199 new / $79 upgrade**; Shooter Suite 12.5 **$399 new / $99 upgrade**. |
| Feb 2016 | **PluralEyes 4.0** ships in **Shooter Suite 13.0** — ground-up UI rewrite, Premiere Pro panel, Smart Start, automatic drift correction toggle, color-coded sync status, Offload integration. Pricing: **$399 standalone / $99 upgrade**; bundled in Shooter Suite (Offload, Instant 4K, Frames) for a claimed ~$197 savings over buying separately. **Avid AAF/Media Composer support dropped** ("technically difficult to maintain"). |
| 2020 | **Maxon acquires Red Giant** (and thus PluralEyes). |
| Aug 2020 | PluralEyes **4.1.11** adds **DaVinci Resolve 16+** XML export support. |
| Jun 2022 | PluralEyes 4.1.12 released (bug-fix release under Maxon). |
| Sep 2022 | "PluralEyes 2023.0.0" released Sept 7, 2022 — final feature/compat release. |
| **Jan 31 / Feb 1, 2023** | Maxon announces **"Limited Maintenance Mode"**: no further feature development; critical bug fixes and technical support continue for **one year** (through ~Feb 1, 2024); downloads/licenses remain available for existing customers. Stated reason: audio-based sync is "now standard in most modern editing tools" (Premiere, FCPX, Resolve, Avid). |
| **Feb 1, 2024** | Support window ends — product now fully unsupported/orphaned (still sold/licensed but frozen). One knowledge-base article explicitly states: *"PluralEyes was discontinued as of February 1st, 2024, and official technical support is no longer available."* |

**Sources:** [Maxon: PluralEyes to Enter Limited Maintenance Mode](https://www.maxon.net/en/article/pluraleyes-to-enter-limited-maintenance-mode), [Maxon KB: PluralEyes Limited Maintenance Mode](https://support.maxon.net/hc/en-us/articles/7389361453340-PluralEyes-Limited-Maintenance-Mode), [Toolfarm KB](https://www.toolfarm.com/knowledge-base/maxon-red-giant-redshift-specific/pluraleyes-to-enter-limited-maintenance-mode/), [Maxon KB: could not prepare media error](https://support.maxon.net/hc/en-us/articles/360043389574-Error-PluralEyes-could-not-prepare-media-to-synchronize), [CineD discontinuation piece](https://www.cined.com/pluraleyes-discontinued-pioneer-in-syncing-videos-based-on-waveforms/), [ProVideoCoalition: Fare-thee-well PluralEyes](https://www.provideocoalition.com/fare-thee-well-pluraleyes-you-were-truly-revolutionary/), [4RFV: PluralEyes 3.1 pricing](https://www.4rfv.co.uk/industrynews/154732/red_giant_ships_pluraleyes_upgrade), [PVC: PluralEyes 3.5/Shooter Suite 12.5](https://www.provideocoalition.com/new-pluraleyes-3-5-released-as-part-of-shooter-suite-12-5-update/), [AWN: PluralEyes 4/Shooter Suite 13.0](https://www.awn.com/news/red-giant-announces-major-update-pluraleyes-shooter-suite-130-release), [Newsshooter: 4.1.11 adds Resolve](https://www.newsshooter.com/2020/08/04/pluraleyes-4-1-11-update-adds-davinci-resolve-support/), [PVC: PluralEyes for Avid ships](https://www.provideocoalition.com/pluraleyes_for_avid_media_composer_ships_and_syncs_for_you/), [PVC: PluralEyes for Avid review](https://www.provideocoalition.com/pluraleyes_for_avid/).

---

## 1. Feature Inventory: v3/v3.5 vs v4/v4.1, with removals flagged

### 1.1 Core engine (present in all versions)
- Audio-content-based matching — compares waveform content, **no timecode, clapperboard, or genlock required**.
- Handles: multi-camera coverage, scripted multi-angle, double-system sound (camera + external recorder), live-music/stage sync to pre-recorded tracks.
- Non-destructive: original media untouched; PluralEyes only computes offsets and (optionally) writes new derivative media on export.
- Spanned-clip awareness (AVCHD/MTS, XDCAM BPAV, P2 Contents folder) — treats multi-file card spans as one continuous clip provided folder structure is preserved.

### 1.2 Sync configuration options (v3/v3.5 — per Red Giant docs, Dan McComb review, Paul Joy review, Steve Hullfish/PVC)

| Setting | Behavior | Status in v4 |
|---|---|---|
| **Allow Sync to Change Clip Order** | Lets the sync engine reorder clips on the timeline if that produces a better match (vs. forcing recorded/import order). McComb recommends **disabling** it, "most of the time your clips are recorded sequentially… you WANT them in order." | **Removed as user-facing toggle in v4** — v4's simplified engine reorders automatically with no way to lock order, which is exactly the top user complaint post-v4 (see §6). |
| **Correct Audio Drift** | Detects and compensates when a recorder runs at a slightly different clock speed than the camera, causing the two to slip out of sync over a long clip; works by subtly stretching/re-timing the derivative audio file. Called out by McComb as a "killer feature." Added in v3.5. | **Kept and automated** in v4 as "Automatic Drift Correction," toggleable, and v4 additionally lets you A/B "compare the corrected sync against the original." |
| **Level Audio** ("normalize"/boost reference track) | Boosts the levels of quiet reference tracks before matching to improve match confidence on low-gain scratch audio. Red Giant's own guidance was to leave it off initially and enable only if sync failed; McComb preferred enabling proactively. | **Removed as an exposed toggle in v4** — menu was simplified away per the ProVideoCoalition v4 review ("simplified menus removed options like 'Allow Sync to Change Clip Order' and 'Level Audio'"). |
| **Try Really Hard** | An intensive/slow matching mode for difficult material (weak audio correlation, short clips) — trades processing time for match success. Present since early plugin-era PluralEyes (Paul Joy's 2010 review already lists it) through v3.5, generally recommended left **on**. | **Removed as a distinct mode in v4** — v4's "automatic" engine folds accuracy/effort decisions into a single opaque pass with no manual escalation option (see §6, ProVideoCoalition v4 review). |
| **Use Clip Locators / marker-based hints** | (Avid-specific and general) Users could drop markers/locators on clips to hint the sync engine where to look on especially difficult material. | Not carried forward as an exposed feature in v4's simplified UI. |
| **Takes** | A mode aimed at music-video/performance workflows with many identical or near-identical takes of the same song — helped the engine avoid mismatching separate takes of the same audio against each other. | **Removed in v4.** Post-v4 forum threads (Creative COW: "PluralEyes/Premiere workflow for one cam multi-take music video") document users having to manually segregate takes into separate sync passes/projects since v4 has no Takes concept. |

### 1.3 v4/v4.1 additions not present in v3
- **Entirely new UI** — three-tab guided workflow: **Add Media → Synchronize → Export Timeline** (replaces v3's multi-bin timeline-editor-style interface).
- **Smart Start** — drag a whole shoot folder in; PluralEyes auto-detects each recording device and auto-assigns its files to a dedicated track/"camera" — no manual bin creation.
- **Premiere Pro Panel extension** (Window > Extensions > PluralEyes) — sync without leaving Premiere.
- **Automatic Drift Correction** (on by default, toggleable) with pre/post comparison.
- **Enhanced color-coded sync-status indicators**, including a distinct highlight for clips that fail to sync when exported into Premiere.
- **Vertical waveform scaling** (increase/decrease waveform height via `[` / `]`).
- **Premiere-matching keyboard shortcuts** for editors already fluent in Premiere.
- **Red Giant Offload integration** — direct pipeline from card-offload app into PluralEyes.
- **DaVinci Resolve XML export** (added in 4.1.11, Aug 2020 — did not exist in v3/v4.0).
- Reported speed: **90 minutes of multi-camera interview footage synced in ~18 seconds** (ProVideoCoalition benchmark), notably faster than v3 and than contemporary NLE-native sync.

### 1.4 Features removed going v3→v4 (summary table)
| Feature | v3/v3.5 | v4/v4.1 |
|---|---|---|
| Avid AAF round-trip / Media Composer support | Yes (native, both directions) | **Removed** — cited as "technically difficult to maintain" |
| "Allow Sync to Change Clip Order" toggle | Yes | Removed |
| "Level Audio" toggle | Yes | Removed |
| "Try Really Hard" mode | Yes | Removed (folded into black-box "automatic" sync) |
| "Takes" feature (music-video multi-take handling) | Yes | Removed |
| Clip locators / marker hints | Yes (esp. Avid version) | Removed |
| EDL export | **Never supported** in v3 either — a 2013 RedShark review explicitly notes "EDL is not supported" | N/A |

**Sources (this whole section):** [ProVideoCoalition: Review of PluralEyes 4](https://www.provideocoalition.com/review-red-giant-pluraleyes-4/), [Dan McComb: PluralEyes 3.5 review](https://www.danmccomb.com/pluraleyes-3-5-takes-the-work-out-of-syncing-sound-with-picture/), [Paul Joy: PluralEyes for FCP (2010)](https://www.pauljoy.com/2010/03/pluraleyes-for-final-cut-pro/), [RedShark News: Plural Eyes 3 review](https://www.redsharknews.com/post-vfx/item/237-plural-eyes-3-slick-sound-syncing), [PVC: PluralEyes for Avid](https://www.provideocoalition.com/pluraleyes_for_avid/), [PVC: PluralEyes 3 beta](https://www.provideocoalition.com/pluraleyes_3_is_ready_for_your_beta_testing_and_audio_syncing/), [Creative COW: multi-take music video thread](https://creativecow.net/forums/thread/pluraleyespremiere-workflow-for-one-cam-multi-take-music-video/), [Grass Valley forum thread](https://forum.grassvalley.com/forum/editors/editing-with-edius/45099-audio-sync-review-and-pluraleyes-comparison), [AWN: Shooter Suite 13](https://www.awn.com/news/red-giant-announces-major-update-pluraleyes-shooter-suite-130-release), [Visualsproducer review of Shooter Suite 13/PE4](https://visualsproducer.wordpress.com/2016/02/29/red-giant-shooter-suite-13-with-pluraleyes-4-review/).

---

## 2. UI/UX — Panes, Timeline, Grouping, Color, Waveform, Player

*Primary source: official Maxon manual (help.maxon.net/rg — TOC discovered at [Overview](https://help.maxon.net/rg/en-us/Content/html/OVERVIEW.html)) plus [Su-Laine Yeo Brodsky's PluralEyes 3 UX case study](http://www.sulainebrodsky.com/pluraleyes3_case_study/) (v3-era, could not be fetched in full — flag as **[PARTIALLY VERIFIED]**, referenced by title only) and reviews.

### 2.1 v4 main window (per official manual, [The Main Interface](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-the-main-interface.html))
Three top tabs drive a linear workflow, each disabled until its prerequisite stage completes:
1. **Add Media** — active by default on launch; drag-and-drop folders/files anywhere onto the window.
2. **Synchronize** — enabled once media is added; single button kicks off the automatic sync pass.
3. **Export Timeline** — enabled once sync completes; presents the export-format picker.

### 2.2 Track/clip model (per [Working with Media Clips](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-working-with-media-clips.html))
- **One track per recognized device** — video clips stay bundled with their own audio (no separate video/audio track split as in a standard NLE timeline).
- Camera/device grouping happens automatically at import based on device metadata/folder origin (Smart Start in v4; manual bin assignment in v3).
- **Mute/Unmute** per track via a button on the track header; **Solo** via **right-click on the Mute button** (isolates that track for monitoring).
- **Volume slider** beneath the mute button — monitoring-only, does **not** affect exported audio levels.
- **Waveform vertical scale** adjustable with `[` (decrease) / `]` (increase) — visual only, does not change actual playback volume.

### 2.3 v3-era interface (pre-rewrite, per RedShark, PVC beta review, Dan McComb)
- Layout described as **"bins in the left columns, a central preview window, and a waveform/timeline at the bottom"** — closer to a dedicated NLE-style tool than v4's linear wizard.
- Users create **bins as tabs**, one per camera/recorder/shoot-date/location, and drag files in manually.
- **2-Up View**: a side-by-side comparison viewer for checking two clips' alignment directly.
- **"Snap to Sync"** quality-control tool (v3.1 release notes).
- Real-time visual feedback as clips are repositioned during the sync pass (Sharpe's own demo: 90 min of 2-camera + 1-recorder footage synced in <10 seconds, with clips visibly sliding into place).

### 2.4 Color coding / sync-quality indication
- **Core scheme (confirmed for v3, carried through v4): green = synced, red = unsynced** — shown both on the timeline waveform and in the clip/bin list. (Bruce Sharpe, quoted in PVC's v3 beta piece: *"green means it synced, red means it didn't sync."*)
- v4 adds a **dedicated highlight color specifically for clips that fail to sync on export into Premiere Pro** (distinct from the general red/unsynced marker) — per the AWN Shooter Suite 13 announcement and PVC's v4 review.
- **On export to Premiere**, PluralEyes writes Premiere **label colors** onto clip items to preserve the synced/unsynced distinction inside the Premiere project panel. This is fragile: Maxon's own KB article "[(Premiere) Why aren't my unsynced clips colored?](https://support.maxon.net/hc/en-us/articles/232058347--Premiere-Why-aren-t-my-unsynced-clips-colored)" documents that Premiere's **Project Settings > General > "Display the project item name and label color for all instances"** option overrides/conflicts with PluralEyes' color write, silently defeating the visual cue — a known, user-reported failure mode.

### 2.5 Unsynced-clip handling
- Per the manual's [Adjust the Sync Results](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-adjust-the-sync-results.html) page: *"An 'unsynced clip' is a clip for which a matching clip could exist, but for which no match has been found."* Two sub-cases: (a) genuinely no matching audio exists anywhere in the project, or (b) a match exists but wasn't detected.
- PluralEyes provides **no in-app manual re-sync/nudge tool** in v4 — the documentation explicitly punts to the NLE: *"It's often easiest to make fine tuned adjustments in your NLE editor,"* and *"Even if some clips did not sync optimally in PluralEyes, you can sync them manually later in your NLE."*
- Verification method suggested by the manual itself: **play two-plus tracks simultaneously and listen for drift** — there is no automated confidence score exposed to the user.
- Resolve export has one dedicated convenience option: automatically **push all unsynchronized clips to the end of the timeline** after sync, to keep the usable portion clean.

### 2.6 Player/monitor
- **Show Player** toggleable (View menu / `P` key).
- Standard transport: play/pause (space), frame-step (arrows), 5-frame jog (Shift+arrows), jump to clip start/end (down/up arrow).
- **Shift+Down / Shift+Up** jump specifically to the **next/previous unsynced clip** — a dedicated navigation aid for QC'ing failures.
- **Shift+hover over a clip** shows a thumbnail preview.

### 2.7 Full Keyboard Shortcut List (v4, per manual)
| Action | Mac | Windows |
|---|---|---|
| Preferences | ⌘, | Ctrl+K |
| Hide PluralEyes | ⌘H | — |
| Hide Others | ⌥⌘H | — |
| Quit | ⌘Q | Alt+F4 |
| New Project | ⌘N | Ctrl+N |
| Open Project | ⌘O | Ctrl+O |
| Add Media | ⌘F | Ctrl+F |
| Save Project | ⌘S | Ctrl+S |
| Save Project As | ⇧⌘S | Ctrl+Shift+S |
| Close Project | ⌘W | Ctrl+W |
| Close & Delete Temp Sync Files | ⇧⌘W | Ctrl+Shift+W |
| Export Timeline | ⌘E | Ctrl+E |
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Shift+Z |
| Cut/Copy/Paste | ⌘X/C/V | Ctrl+X/C/V |
| Show Player | P | P |
| Timeline Fit | \ | \ |
| Zoom In / Out | = / − | = / − |
| Synchronize | ⌘R | Ctrl+R |
| Cancel Sync | ⌘. | Ctrl+. |
| Reset All Clips | ⇧⌘R | Ctrl+Shift+R |
| Minimize | ⌘M | Ctrl+M |
| Delete Clip | Delete (confirms) | Delete (confirms) |
| Show Thumbnail | Shift+hover | Shift+hover |
| Play/Pause | Space | Space |
| Next/Prev Frame | →/← | →/← |
| Skip 5 Frames | Shift+→/← | Shift+→/← |
| Clip End/Start | ↑/↓ | ↑/↓ |
| Next/Prev Unsynced Clip | Shift+↓ / Shift+↑ | Shift+↓ / Shift+↑ |
| Waveform size | [ / ] | [ / ] |

**Sources:** [The Main Interface](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-the-main-interface.html), [The Menu Items](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-the-menu-items.html), [Keyboard Shortcuts](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-keyboard-shortcuts.html), [Working with Media Clips](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-working-with-media-clips.html), [Adjust the Sync Results](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-adjust-the-sync-results.html), [Export to Resolve](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-resolve.html), [Maxon KB: unsynced clip coloring](https://support.maxon.net/hc/en-us/articles/232058347--Premiere-Why-aren-t-my-unsynced-clips-colored), [PVC: PluralEyes 3 beta](https://www.provideocoalition.com/pluraleyes_3_is_ready_for_your_beta_testing_and_audio_syncing/), [RedShark News v3 review](https://www.redsharknews.com/post-vfx/item/237-plural-eyes-3-slick-sound-syncing), Su-Laine Yeo Brodsky UX case study title reference (content not retrievable — **unverified in detail**).

---

## 3. Import Path

### 3.1 Supported media formats (v4, per [Supported Media Formats](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-supported-media-formats.html))

**Video containers — Mac:** MOV, MP4, MPEG, MPG, M2T, M2TS, MTS, MXF*, R3D*
**Video containers — Windows:** WMV, 3GPP, 3GPP2, AVI, MXF, MP4, MOV, QT, M2T, MTS, M2TS, R3D*

**Video codecs — Mac:** H.264, ProRes, DV, HDV, AVCHD, DVCPRO HD*, Motion JPEG (MJPEG)*, AIC*, REDCODE RAW
**Video codecs — Windows:** AVCHD, DV, H.264, HDV, MJPEG, ProRes, WMV, XDCAM EX/HD/HD422, REDCODE RAW

*(`*` = syncs fine but **no video preview available** for that format — MXF, R3D, DVCPRO HD, MJPEG, AIC.)*

**Audio — Mac:** AIFF, MP3, WAV, M4A
**Audio — Windows:** AAC, AC-3, AIFF, M4A, MP3, WAV, WMA

**Camera-card format recognition:** AVCHD, P2, XDCAM, DCIM (consumer camera folder layout), CanonXF — PluralEyes recognizes the native card folder structures directly.

Notably: **accurate device clock/time-of-day settings help but are not required**, and **timecode recording is unnecessary** — the whole design point is that sync works from audio content alone.

### 3.2 Folder-structure / camera grouping on import (per [Import Media](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-import-media.html) and [Prepare Files for the Sync](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-prepare-files-for-the-sync.html))
- Drag the whole shoot folder in; PluralEyes auto-detects device/source and **auto-creates one track per device**, auto-populating clips onto it.
- You can drop the raw camera-card project folder (e.g., a whole `PRIVATE/AVCHD/...` structure) directly; the top-level folder can be freely renamed.
- Guidance for project scoping: keep a single project to **≤ ~30 minutes of footage and ≤ 50 clips (ideally ≤ 30)** — larger projects should be split, both for speed and reliability.
- **Sync as early as possible**, before any editorial marks/effects/titles are applied — PluralEyes wants to freely reposition and fully analyze raw clips.

### 3.3 Spanned clips (per [Work with Spanned Clips](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-work-with-spanned-clips.html))
- Requires **preserving the original card directory structure and support files** so the multi-file span is recognized as one logical clip.
- **MTS/MXF**: copy the whole file structure; both Premiere's Media Browser and PluralEyes recognize it as unified.
- **XDCAM**: copy starting from the `BPAV` folder; supports spanning across multiple cards if named consistently (e.g., `Camera1→card1→BPAV`, `Camera1→card2→BPAV`).
- **P2**: the **entire `Contents` directory** must be copied for automatic audio/video linking to work; naming conventions must stay consistent across cards.

### 3.4 Dual-system sound / scratch audio / multiple recorders
- Dual-system sound (camera + independent recorder) is a first-class use case, called out explicitly in the "What is PluralEyes" overview.
- **Scratch/poor-quality audio** (on-camera mic) is explicitly supported as the sync reference even when quality is bad — this was one of PluralEyes' signature strengths versus NLE-native tools, repeatedly cited in comparisons (e.g., the CineD/PVC retrospective: PluralEyes "could handle poor-quality scratch audio that challenged built-in NLE tools").
- **Multiple audio recorders**: each recorder is treated as its own track/device; the sync engine looks for the best audio match across *all* tracks in the project simultaneously — troubleshooting guidance (§4) notes matching requires each clip to be one continuous recording stretch and that "at least 5–10 seconds of good quality audio content" is generally required per clip.
- No timecode jam-sync input path is modeled at all — PluralEyes deliberately competes on **not** needing timecode gear, unlike Sync-N-Link X (§8).

### 3.5 Import from an NLE project (round-trip start) — per [Import Project from NLE](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-import-project-from-nle.html)
- **Final Cut Pro X** (10.1.2+): build a project with each source (camera/recorder) on its own lane/track → `File > Export XML` → in PluralEyes, `File > New Project from Final Cut Pro X` → pick the XML.
- **Premiere Pro**: build a sequence with each source on its own track → `File > Export > Final Cut Pro XML` → in PluralEyes, `File > New Project from Premiere Pro` → pick the XML and the specific sequence. (Alternative: use the **PluralEyes Panel** inside Premiere directly — `Window > Extensions > PluralEyes` — with a one-click "Open in PluralEyes" that auto-loads the active sequence.)
- **DaVinci Resolve** (16+): build a project, fix any framerate mismatch, put each source on its own track, export via `File > Export AAF, XML` using **FCP 7 XML v5** format, then `File > Import from DaVinci Resolve` in PluralEyes.
- **Vegas Pro**: uniquely **bidirectional and Vegas-anchored** — you must originate the sequence in Vegas Pro (clips per-track by source), launch PluralEyes via `Tools > Extensions > PluralEyes` inside Vegas, sync, then the Export Timeline step **closes PluralEyes and hands the synced sequence straight back into Vegas** — there is no independent PluralEyes-standalone Vegas workflow.

---

## 4. Sync Settings & Preferences (Complete)

| Setting | Where documented | Detail |
|---|---|---|
| **Automatic sync (single "Synchronize" action)** | Sync menu, `⌘R`/`Ctrl+R` | v4 default flow — no manual mode selection exposed. |
| **Cancel Sync** | Sync menu, `⌘.`/`Ctrl+.` | Aborts an in-progress pass. |
| **Reset All Clips / "Restore All Tracks"** | View + Sync menus, `⇧⌘R` | Reverts all clips to pre-sync positions. |
| **Automatic Audio Drift Correction** | Sync menu toggle | On by default in v4; corrects recorder-vs-camera clock-speed mismatch over long clips by re-timing a derivative audio file; v4 lets you compare corrected vs. original. Introduced (as a paid-for headline feature) in **v3.5**. |
| **Allow Sync to Change Clip Order** *(v3 only — removed in v4)* | v3 sync preferences | Controls whether the engine may reorder clips vs. respecting import/recorded order. |
| **Level Audio** *(v3 only — removed in v4)* | v3 sync preferences | Boosts quiet reference-track gain pre-match. |
| **Try Really Hard** *(v3 only — removed in v4)* | v3 sync preferences | Slower, more exhaustive matching pass for difficult material. |
| **Clip locators/markers as sync hints** *(v3/Avid — removed in v4)* | v3-era, esp. Avid version | User-set hints for hard-to-match clips. |
| **Preferences panel** | `⌘,`/`Ctrl+K` | Includes temp-file location (redirectable to a different drive — used as a fix for "could not prepare media" errors, see §6). |
| **Handling of overlapping/non-overlapping clips** | [Troubleshoot the Sync](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-troubleshoot-the-sync.html) | Requires actual audio-content overlap between clips being matched; a clip period where "only one device was recording" cannot be automatically synced — engine needs shared audio to correlate against. |
| **Continuity requirement** | Same page | "Each clip must correspond to one continuous stretch of recording" — clips with internal audio gaps/dropouts break matching and must be repaired externally before re-import. |
| **Minimum audio requirement** | Same page | Roughly **5–10 seconds of good-quality audio** needed per clip; clips under ~3 seconds, or with long indistinct stretches, routinely fail. |
| **"Sync Mode" via project origin** | Import behavior | Not an explicit named "mode" per se in v4 documentation — the closest analogue is *how* a project is created (fresh media import vs. NLE-project import), which determines what round-trip export paths are later available. |

**Sources:** [Pluraleyes-the-menu-items](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-the-menu-items.html), [Pluraleyes-troubleshoot-the-sync](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-troubleshoot-the-sync.html), [Pluraleyes-adjust-the-sync-results](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-adjust-the-sync-results.html), Dan McComb's PluralEyes 3.5 review, RedShark News v3 review, Steve Hullfish/PVC Avid review.

---

## 5. Export / Round-Trip Paths — Full Detail

All exports funnel through the **Export Timeline** tab → format dropdown. General mechanics (per [Overview of Exporting](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-overview-of-exporting.html)): exports run **in the background** (PluralEyes stays usable), taking "one second to several hours" depending on size/format; XML-based exports are **small text files that reference source media** (no re-encoding, no duplication of source media on disk) unless a "replaced audio"/new-media option is explicitly chosen.

### 5.1 New Media Files ([manual page](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-as-media-files.html))
- Purpose: universal fallback for any NLE PluralEyes doesn't directly support (cited examples: EDIUS 7, Final Cut Express, iMovie).
- Two sub-options, exported **separately** (two passes needed for both):
  - **Audio Files** — writes new audio files trimmed to exactly match the length of their synced video counterpart.
  - **Video Files** — writes new video files with the camera's onboard audio **replaced** by the external/"good" audio.
- Constraint: **1-to-1 match only** — one audio track can be baked into only one camera clip per export; **cannot** synthesize a true multi-camera sequence this way.
- **Not supported for MXF or R3D** — those must be transcoded to MOV first.
- Exported files are reachable via `Window > Show Export History` (also used to locate/clear recent exports across all format types).

### 5.2 Final Cut Pro X — FCPXML ([manual page](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-final-cut-pro-x.html))
- Up to **three separate `.fcpxml` files** written to `~/Documents/PluralEyes/Exports`, named `<project>_FCPX.fcpxml`, `<project>_FCPX_replaced.fcpxml` (only if audio-replace chosen), `<project>_FCPX_multicam.fcpxml` (only if multicam option enabled).
- **Base file**: a synchronized project/sequence referencing original media, offsets/positions baked into clip placement — no new media.
- **Audio-replacement option**: builds **compound clips** with the external audio substituted in — no extra disk space consumed, original media untouched.
- **Multicam option**: groups synced angle clips into an FCPX **multicam clip**, delivered inside a dedicated Event named `"<project name> mc"`, ready for multi-angle cutting in FCPX.
- **Auto-import**: if FCPX is already running at export time, the XML is imported automatically.
- **Known failure mode**: **"DTD Validation Failed"** error on import into FCPX (see §6 for full detail).

### 5.3 Premiere Pro — XML ([manual page](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-premiere-pro.html))
- Exports the standard small XML referencing source media; drag into Project Panel or `File > Import`.
- **"Create sequence with replaced audio"** option, when checked, produces **two sequences** in the resulting Premiere project: one suffixed `"_synced"` (original camera audio preserved) and one suffixed `"_replaced"` (external audio substituted, trimmed to picture length). No extra disk space used.
- **Only the topmost overlapping audio-only track is used** when multiple audio tracks overlap in time — a real limitation for scenes with several simultaneous audio recorders (see §6).
- Import mechanics differ by Premiere version: pre–CC 2015 dumps duplicate media references into a `_synced` bin/folder; CC 2015+ places them alongside the sequence instead. Either way, **source-clip references get duplicated visually** in the Project panel (cosmetic clutter, not actual duplicated media) — both PluralEyes and its successor Syncaila share this quirk.
- A **manual XML workflow** is documented as an alternative specifically to avoid the reference-duplication clutter.

### 5.4 PluralEyes 4 Panel (Premiere Pro extension) ([manual page](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-via-pluraleyes-4-panel.html))
- Installs automatically with PluralEyes setup once a Premiere Pro version is selected; requires **Premiere Pro CC 2014+**.
- Workflow: build a sequence with unsynced clips one-source-per-track → `Window > Extensions > PluralEyes` → choose **sync directly in-panel** or **"Open the sequence in PluralEyes"** (hands off to the standalone app) → result auto-lands back in the active Premiere project.
- **Cannot process** already-edited media, clips with effects/transitions applied, or modified in/out points.
- Certain formats slow the panel down noticeably during media prep.
- Maxon's own guidance for persistent panel problems: **fall back to the manual Export-XML workflow** instead.

### 5.5 Vegas Pro ([manual page](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-vegas-pro.html))
- The **only bidirectional, Vegas-anchored** workflow: originate the sequence in Vegas (one source per track) → `Tools > Extensions > PluralEyes` inside Vegas → Synchronize → **Export Timeline closes the PluralEyes window and returns you straight to Vegas** with the synced sequence already in place. No standalone-first path exists for Vegas.

### 5.6 DaVinci Resolve ([manual page](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-resolve.html))
- Standard small-XML export; import in Resolve via `File > Import Timeline > Import AAF, EDL, XML`.
- **v4.1.11+ only** (added Aug 2020) — v3 and early v4 had **no Resolve support** at all.
- Unique convenience option: automatically **move all unsynchronized clips to the end of the timeline** post-sync for editorial clarity.

### 5.7 Avid AAF — **v3/v3.5 only, removed in v4**
- v3.1 (Nov 2012) added native **AAF round-trip with Avid Media Composer** (Mac): export AAF from Media Composer → sync in PluralEyes → import synced AAF back into Media Composer.
- The dedicated **PluralEyes for Avid** plugin/version (2011, $119 launch) predates the v3 standalone and used the same AAF-export/AAF-reimport loop, plus Avid-specific **locators** as sync hints and a **"Level Audio"** checkbox for uneven source levels.
- Avid-version limitations even at its best: incompatible with Unity-based shared storage, could not process AMA-linked media (native MXF required), bound by Media Composer's 24 video/audio track ceiling, lacked FCP-version conveniences ("Replace Audio," "Single Output Sequence"), and did **not** auto-build Avid group clips.
- **v4 dropped AAF/Avid entirely** — Red Giant's stated reason: "technically difficult to maintain." This is corroborated independently by a Blackmagic Forum thread ("Resolve 18.1 Breaks AAF Support For Plural Eyes 3.5") showing v3.5's AAF export was *still* being used years later as an unofficial Resolve-compatible path, and broke when Resolve changed its AAF parser — evidence AAF was the most fragile of PluralEyes' export formats even before v4 removed it.

### 5.8 EDL — never supported
- A contemporaneous (2013) RedShark News review of v3 explicitly states: *"export the results to XML or a media file. (EDL is not supported.)"* No EDL export existed in v3 or v4 at any point per the official manual's export-format list (Media Files, FCPX, Premiere, Panel, Vegas, Resolve — no EDL entry).

**Sources:** [Overview of Exporting](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-overview-of-exporting.html), [Export as Media Files](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-as-media-files.html), [Export to Final Cut Pro X](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-final-cut-pro-x.html), [Export to Premiere Pro](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-premiere-pro.html), [Export via PluralEyes 4 Panel](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-via-pluraleyes-4-panel.html), [Export to Vegas Pro](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-vegas-pro.html), [Export to Resolve](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-resolve.html), [RedShark News v3 review](https://www.redsharknews.com/post-vfx/item/237-plural-eyes-3-slick-sound-syncing), [Blackmagic Forum: Resolve 18.1 breaks AAF](https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=171978), [ProVideoCoalition: PluralEyes for Avid](https://www.provideocoalition.com/pluraleyes_for_avid/), [PVC: PluralEyes for Avid Media Composer ships](https://www.provideocoalition.com/pluraleyes_for_avid_media_composer_ships_and_syncs_for_you/).

---

## 6. Known Limitations, Failure Modes, Complaints

### 6.1 "70% reliable" / general reliability complaints
Direct "70% reliability" phrasing was **not located verbatim in any retrievable source — mark as unverified/possibly apocryphal or from a source not indexed**. However, extensive, well-documented reliability complaints exist in its place:
- Adobe Community threads (e.g. ["why is premiere pro's audio sync still so unreliable compared to pluraleyes"](https://community.adobe.com/t5/premiere-pro-ideas/why-is-premiere-pro-s-audio-sync-still-so-unreliable-compared-to-pluraleyes/idi-p/15241767)) are used by editors specifically to argue PluralEyes was *more* reliable than native tools — implying its baseline was "good, not perfect."
- The [ProVideoCoalition Syncaila-vs-PluralEyes shootout](https://www.provideocoalition.com/sync-shootout-pluraleyes-vs-syncaila/) documents PluralEyes **outright failing** on certain camera start/stop segment scenarios that Syncaila handled successfully.
- Grass Valley forum ["Audio Sync Review and PluralEyes Comparison"](https://forum.grassvalley.com/forum/editors/editing-with-edius/45099-audio-sync-review-and-pluraleyes-comparison) (403 on fetch — content unverified but title indicates a comparative reliability review).

### 6.2 Sequence/clip reordering complaints (major, well-documented)
- [Creative COW: "How to stop pluraleyes re-ordering shots in a timeline?"](https://creativecow.net/forums/thread/how-to-stop-pluraleyes-re-ordering-shots-in-a-time/) — user Jay Moss reports v4.1.4 returning footage with shots reordered despite the source being laid out in strict shoot order, with **no control to prevent it**. Community member H. Paul Moon calls it *"really infuriating that they removed a feature that we could use to force the oftentimes flawed synchronization process,"* directly attributing this to the removal of the v3 **"Allow Sync to Change Clip Order"** toggle as part of what he calls the "dumbing down of the application, removing customizable features for the lowest-level users." The only workaround discussed was manually rebuilding a correctly ordered sequence from merged/synced clips after the fact — no in-app fix existed.
- A 2020 YouTube tutorial title itself documents the issue as endemic: "HOW TO SOLVE PLURAL_EYES_4 SEQUENCE CLIPS DISORDER AND TRACK SPLITTING (2020)."

### 6.3 FCPXML "DTD Validation Failed" (well-documented, common)
- Maxon's own KB article ["(FCP X) Error: DTD Validation Failed"](https://support.maxon.net/hc/en-us/articles/4408558715538--FCP-X-Error-DTD-Validation-Failed) confirms this is a recognized, recurring error and attributes it to **incompatible data in the XML received from FCPX** (i.e., round-tripping *from* FCPX into PluralEyes and back can poison the file), sometimes tied to an out-of-date PluralEyes version.
- Creative COW community diagnosis (multiple threads, e.g. [PluralEyes to FCPX DTD validation failed](https://creativecow.net/forums/thread/pluraleyes-to-fcpx-dtd-validation-failed/)) attributes root causes to how media was **originally imported into FCPX**: applied audio enhancements (e.g., a loudness filter), added metadata/keywords/tags, or any FCPX-side effects/markers/in-out-point edits made *before* the round trip — these get serialized into the XML in a form PluralEyes' export doesn't reproduce validly. Fixes discussed: re-import media cleanly with no FCPX-side modifications; remove audio enhancement filters before syncing; or start the process in PluralEyes rather than FCPX.

### 6.4 Long-clip drift
- Root cause (per multiple sources): independent recording devices (camera vs. external recorder) run on **slightly different internal clocks**, so a long continuous clip (concerts, stage shows, 1–2 hour recordings) will slip audio/video sync progressively over time even though the start point matched perfectly.
- PluralEyes' answer was **Correct/Automatic Drift Correction** (added v3.5, automated in v4) — a differentiator repeatedly cited by users even years after discontinuation as unmatched: a [DVXuser forum thread](https://www.dvxuser.com/threads/audio-drift.5710831/) discussing 1–2 hour stage-performance drift explicitly states *"Pluraleyes still seems the most accurate with its very good 'drift correction' process,"* comparing favorably to Resolve's "Elastic Waveform" alternative and noting Adobe Audition has a similar but separate tool. Manual workarounds discussed for tools lacking drift correction: incrementally speed-adjusting audio across the timeline, or cutting at natural pause points to re-sync in segments — both markedly inferior to PluralEyes' automated correction.

### 6.5 "Could not prepare media to synchronize" error (documented, mechanical)
Per [Maxon KB](https://support.maxon.net/hc/en-us/articles/360043389574-Error-PluralEyes-could-not-prepare-media-to-synchronize), three root causes:
1. **Insufficient disk space** — PluralEyes needs temp-file space roughly equal to the full project size (a 10GB timeline needs ~10GB free).
2. **Read/write permission issues**, especially on network or external drives — fix by moving media local and/or redirecting the temp-file location (Preferences) to a local, writable path.
3. **Unmapped/unnamed network drives** — PluralEyes needs a fully resolvable path; unmapped shares break it.

### 6.6 Other documented failure conditions (from [Troubleshoot the Sync](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-troubleshoot-the-sync.html))
- Clips shorter than ~3 seconds, or with fewer than ~5–10 seconds of usable/distinct audio, routinely fail to match.
- Clips that don't actually represent the same recorded moment (only one device rolling) cannot sync — not a bug, an inherent constraint of audio-correlation matching.
- Internal audio dropouts/gaps within a single clip break the "one continuous stretch" requirement and must be manually repaired before re-import.
- Low audio quality generally — recommended external cleanup (e.g. in Adobe Audition) before re-import.

### 6.7 Premiere-export-specific gotchas
- **Only the topmost overlapping audio-only track is honored** when multiple simultaneous audio tracks overlap — a real limitation for multi-recorder shoots (§5.3), silently dropping additional audio sources from the sync-result playback path.
- Unsynced-clip **color coding can silently fail to appear** in Premiere due to a conflicting Project Settings option (§2.4) — a genuinely confusing failure mode since the fix lives in Premiere, not PluralEyes.
- Reference-clip **duplication clutter** in the Premiere Project panel on XML import (cosmetic but confusing, present in every version, and inherited by successor tools like Syncaila too).

### 6.8 Panel-specific limitation
- The PluralEyes 4 Premiere panel **cannot handle already-edited clips** — any effects, transitions, or modified in/out points on a sequence clip block the panel's sync path entirely, forcing a return to raw/unedited media (§5.4).

**Sources:** all URLs cited inline above, plus [PVC Syncaila shootout](https://www.provideocoalition.com/sync-shootout-pluraleyes-vs-syncaila/), [Creative COW reorder thread](https://creativecow.net/forums/thread/how-to-stop-pluraleyes-re-ordering-shots-in-a-time/), [Maxon DTD KB](https://support.maxon.net/hc/en-us/articles/4408558715538--FCP-X-Error-DTD-Validation-Failed), [Creative COW DTD thread](https://creativecow.net/forums/thread/pluraleyes-to-fcpx-dtd-validation-failed/), [Maxon "could not prepare media" KB](https://support.maxon.net/hc/en-us/articles/360043389574-Error-PluralEyes-could-not-prepare-media-to-synchronize), [DVXuser drift thread](https://www.dvxuser.com/threads/audio-drift.5710831/), [Blackmagic Forum AAF-break thread](https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=171978).

---

## 7. System Requirements, Pricing History, Discontinuation Status

### 7.1 System requirements (v4, per [official manual](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-system-requirements.html))
- **macOS**: 10.11+; ~300MB install footprint + temp space equal to project size; supported NLEs: Premiere Pro CC 2017+, Final Cut Pro X 10.2.3+, or any NLE via the media-file export path.
- **Windows**: Windows 10, **64-bit only**; ~300MB install + same temp-space rule; supported NLEs: Premiere Pro CC 2017+, Magix Vegas Pro 14+, or any NLE via media-file export.
- No RAM figure is published in the manual.
- Temp storage rule of thumb: needs disk space roughly equal to the full size of the sequence's media (a 4GB sequence needs ~4GB temp space).

### 7.2 Pricing history
| Version / bundle | New price | Upgrade price | Notes |
|---|---|---|---|
| PluralEyes for Avid Media Composer 1.0 (2011) | $119 launch (implying ~$149 regular) | — | Standalone Avid-only product |
| PluralEyes 3.0/3.1 (2012) | **$199** | **$79** (from v2/DualEyes) | First standalone cross-NLE app |
| PluralEyes 3.5 (2014, part of Shooter Suite 12.5) | **$199** alone / **$399** as Shooter Suite | **$79** alone / **$99** suite upgrade | Adds Drift Correction |
| PluralEyes 4.0 (2016, Shooter Suite 13.0) | **$399** standalone | **$99** | Suite (w/ Offload, Instant 4K, Frames) claimed ~$197 cheaper than à la carte |
| PluralEyes 4.1 (post-2018, under Red Giant/early Maxon) | reported ~**€365** suite / **€90.55** upgrade in one EU review — **[approximate, currency/region-specific, treat as indicative not authoritative]** | — | Periodic promotions seen, e.g. a "24-Hour Flash Sale – 25% Off Shooter Suite 13 and PluralEyes 4.1" |

### 7.3 Discontinuation status (see also §0 timeline)
- **Jan 31/Feb 1, 2023**: Maxon publicly announces **Limited Maintenance Mode** — no further feature work; critical bug fixes and support continue through **~Feb 1, 2024**; downloads remain available to existing customers for at least that year. Official reasoning: sync capability PluralEyes pioneered is "now standard in most modern video editing tools" (naming Premiere Pro, FCPX, Resolve, Avid Media Composer as having caught up).
- **Feb 1, 2024**: effective end of official support per a Maxon KB article's own dating.
- As of the current product page (maxon.net), PluralEyes is still listed for sale/licensing but carries a prominent "limited maintenance mode" banner pointing to an FAQ — it has **not** been pulled from sale, only frozen.

**Sources:** [System Requirements](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-system-requirements.html), [4RFV: v3.1 pricing](https://www.4rfv.co.uk/industrynews/154732/red_giant_ships_pluraleyes_upgrade), [PVC: v3.5/Shooter Suite 12.5 pricing](https://www.provideocoalition.com/new-pluraleyes-3-5-released-as-part-of-shooter-suite-12-5-update/), [AWN: v4.0/Shooter Suite 13.0 pricing](https://www.awn.com/news/red-giant-announces-major-update-pluraleyes-shooter-suite-130-release), [Visualsproducer EU pricing review](https://visualsproducer.wordpress.com/2016/02/29/red-giant-shooter-suite-13-with-pluraleyes-4-review/), [ProductionHUB flash sale](https://www.productionhub.com/press/60636/red-giant-24-hour-flash-sale-25-off-shooter-suite-13-and-pluraleyes-41), [Maxon: Limited Maintenance Mode announcement](https://www.maxon.net/en/article/pluraleyes-to-enter-limited-maintenance-mode), [Maxon KB: Limited Maintenance Mode](https://support.maxon.net/hc/en-us/articles/7389361453340-PluralEyes-Limited-Maintenance-Mode), [Maxon KB: discontinuation dating](https://support.maxon.net/hc/en-us/articles/360043389574-Error-PluralEyes-could-not-prepare-media-to-synchronize), [current product page](https://www.maxon.net/en/product-detail/red-giant/pluraleyes).

---

## 8. Current Competitors & Where They're Weaker Than PluralEyes

### 8.1 Syncaila — closest direct successor
Standalone app, actively maintained, positioned explicitly as the PluralEyes replacement.
- **Sync method**: waveform matching (same principle), plus a fallback **"sync by recording time"** mode (device timestamps, ~1-second accuracy) for cases where audio matching fails outright — a mode PluralEyes never had.
- **4 accuracy levels**: Fast / Advanced / Optimal / Utmost — trades speed for thoroughness, functionally replacing PluralEyes' lost "Try Really Hard."
- **Chronology control**: 4 explicit modes (Smart automatic / As-is-in-XML / By date-time / By filename) — a **direct, more granular replacement** for PluralEyes' removed "Allow Sync to Change Clip Order" toggle; this is arguably an improvement over what PluralEyes ever offered.
- **Match Threshold** slider — user-adjustable false-positive/false-negative tradeoff, again more exposed control than PluralEyes v4 gave.
- **Groups-not-pairs matching** — tries to sync clusters of clips together rather than pairwise, intended to raise match rates on marginal audio.
- **Export**: FCP7 XML and FCPX XML only (**no native Premiere project export, no Resolve-native export, no AAF**) — narrower NLE reach than PluralEyes had at its peak (PluralEyes supported Premiere, FCPX, FCP7-era via XML, Vegas, Resolve, and briefly Avid).
- **Where it's weaker than PluralEyes**: per the direct [ProVideoCoalition shootout](https://www.provideocoalition.com/sync-shootout-pluraleyes-vs-syncaila/), Syncaila was **slower overall** (6:11 vs. PluralEyes' 4:24 in their test) and **stripped more metadata** through the XML round-trip than PluralEyes did (PluralEyes "maintained some" metadata, cause unexplained). It requires an external, out-of-NLE app step for every job (no native Premiere-panel-equivalent found in this research — **unverified whether one exists**). Pricing: **$249 full / $125 limited license**, i.e. costs money where built-in NLE tools are free, without PluralEyes' historical brand trust.
- **Sources**: [Syncaila help/user guide](https://syncaila.com/help), [ProVideoCoalition shootout](https://www.provideocoalition.com/sync-shootout-pluraleyes-vs-syncaila/), [CamHeard alternatives comparison](https://camheard.com/pluraleyes-alternative).

### 8.2 Sync-N-Link X (Intelligent Assistance) — FCPX-only, timecode-based, different category entirely
- **Sync method**: **jam-synced SMPTE/EBU timecode**, not audio-content matching — fundamentally the opposite approach from PluralEyes.
- Operates on **already-imported, unsynchronized FCPX clips**, converting audio-track info into FCPX component names and **Roles** tags automatically; positioned as a **batch dailies-prep** tool ("hours to minutes").
- **Where it's weaker than PluralEyes**: it is **FCPX-only** (no Premiere, Resolve, Avid, or Vegas support at all) and it **requires timecode-generating gear on set** (jam-sync boxes, timecode-capable recorders/cameras) — exactly the hardware dependency PluralEyes was built to eliminate. It cannot help a shoot that used mismatched/no-timecode devices, which was PluralEyes' core selling point.
- **Sources**: [Intelligent Assistance product page](https://www.intelligentassistance.com/sync-n-link-x/), [ProVideoCoalition review](https://www.provideocoalition.com/sync-n-link-x-for-final-cut-pro-x/).

### 8.3 Built-in NLE sync tools

**Adobe Premiere Pro (Merge Clips / multicam "Synchronize")**
- Waveform-based, but per extensive, repeated Adobe Community complaints (multiple threads through 2024–2025):
  - **"Picky about waveform amplitude"** — needs not just matching shape but similar *level* between sources, unlike PluralEyes which tolerated mismatched gain/scratch audio well.
  - Frequently produces **staggered/partially-offset timelines** rather than a clean full sync, especially on documentaries/multi-hour, multi-camera, multi-mic shoots.
  - **Fragments the sync**: creates multiple separate multicam sequences with only 2–4 tracks synced at a time instead of one unified result, when cameras start/stop intermittently (per a detailed Adobe Community bug report: 3-camera shoot produced 30+ fragmented tracks).
  - **Cannot auto-match unlabeled/orphaned audio files** to their source video the way PluralEyes' engine did project-wide — requires more manual pre-labeling of camera metadata before multicam creation.
  - No drift correction at all for long single-continuous-clip recordings (a stage-show/concert scenario PluralEyes handled natively).
  - There is an **active, still-open feature request** (posted Jan 31, 2025, viewed 547 times as of research) titled *"Editors need a multicam/multilayer audio sync feature since plural eyes has stopped working"* — direct evidence the community does not consider Premiere's native tool a full replacement even years post-discontinuation.
- **Sources**: [Adobe Community: unreliable vs PluralEyes](https://community.adobe.com/t5/premiere-pro-ideas/why-is-premiere-pro-s-audio-sync-still-so-unreliable-compared-to-pluraleyes/idi-p/15241767), [Adobe Community: multicam sync "kinda sucks"](https://community.adobe.com/t5/premiere-pro-discussions/premiere-pro-multicam-synchronization-kinda-sucks/td-p/14136064), [Adobe feature-request thread](https://community.adobe.com/feature-requests-730/editors-need-a-multicam-multilayer-audio-sync-feature-since-plural-eyes-has-stopped-working-1328276).

**DaVinci Resolve (Sync Bin / clip "Auto Sync Audio")**
- Native waveform sync exists (right-click clips in the Media Pool → "Auto Sync Audio" → append to timeline / new timeline modes), plus "Elastic Waveform" for stretching audio to correct drift on long contiguous clips (praised as comparably good to PluralEyes' drift correction, per the DVXuser thread in §6.4).
- **Where it's weaker than PluralEyes**: per the [CamHeard alternatives comparison](https://camheard.com/pluraleyes-alternative), Resolve "**silently piles clips into 'no match' with no explanation**" — poor diagnostic/QC feedback compared to PluralEyes' explicit red/green color coding and unsynced-clip navigation shortcuts (Shift+Up/Down). No project-wide "sync everything at once, across a full shoot day" workflow equivalent to PluralEyes' single-pass, multi-camera-plus-multi-recorder handling — Resolve's tool is more clip-pair-oriented.

**Final Cut Pro X (Synchronize Clips)**
- Native since FCPX's early releases; select 2+ clips → right-click → "Synchronize Clips" → creates a synchronized clip.
- **Where it's weaker than PluralEyes**: per the CamHeard comparison, **Apple's own documentation openly warns some recordings are "not suited" for its audio sync** — a direct admission of narrower reliability than PluralEyes claimed. It's also fundamentally a manual, pairwise/small-batch operation rather than PluralEyes' whole-project automatic pass across dozens of clips and multiple device types simultaneously, and it has no equivalent of automatic drift correction for long single clips.

### 8.4 Adobe's audio-based sync generally
Covered under Premiere above — no separate distinct "Adobe audio-sync engine" outside the Merge Clips/multicam-synchronize path was found as a distinct product; it is the same underlying feature discussed in §8.3.

### 8.5 Newer entrant: CamHeard
Found during competitor research, not in the original brief but relevant context: a simplified one-button ("drop files → Sync → Export") standalone tool explicitly created in response to PluralEyes' gap, priced **$129 one-time or $14.99/month**, works fully offline and processes a full shooting day in one pass. **[Its actual sync accuracy/reliability versus PluralEyes was not independently verified in this research — treat as a vendor-reviewed claim, not confirmed.]**

### 8.6 Newer entrant: WaveXML — *added September 2026*
Launched as a public beta around **16 August 2026**, after the original research pass. **Free, full-featured, Mac and Windows.** NLE-anchored rather than card-anchored: export FCP7 XML or FCPXML from Resolve, Premiere or Final Cut, match the recorder tracks to the cameras in WaveXML, export XML back, keep cutting. Explicitly targets Zoom and Sound Devices recorders.

**Why it matters to this project:** it is the first *free* cross-platform PluralEyes-shaped tool, which removes most of the pricing headroom the $129–$249 incumbents left. **[No pricing after beta has been announced; single-author project; sync accuracy not independently verified — treat as an announcement, not a benchmark.]**

**Where it does not overlap:** starting from an exported sequence is the round-trip workflow, not the drop-a-card-folder-in workflow, and nothing in the available material describes transitive whole-project solving, exposed confidence, or drift measurement.

**Sources:** [Newsshooter, 16 Aug 2026](https://www.newsshooter.com/2026/08/16/wavexml-auto-sync-for-cameras-audio/), [wavexml.com](https://wavexml.com/).

---

## 9. What Could Not Be Verified

- The specific **"70% reliability"** figure/quote from the brief — not located in any retrievable source; likely either a specific forum post not indexed by search, or a paraphrase. **Flag as unconfirmed.**
- Full verbatim content of the **PluralEyes 3 UX case study** by Su-Laine Yeo Brodsky (sulainebrodsky.com) — page exists and is titled correctly but content could not be extracted through the fetch tool (redirect/format issue). Only referenced by title.
- Exact **RAM requirements** for PluralEyes 4 — not published in the official manual; likely no hard minimum was ever specified.
- Whether **Syncaila has a Premiere-panel-equivalent** to PluralEyes' in-app extension — not found in available Syncaila documentation; may not exist, treat as unconfirmed rather than assumed absent.
- Precise **audio-channel-mapping behavior** on AAF export (v3, pre-removal) — sources describe the AAF round-trip mechanically but no source detailed how multi-channel audio tracks were specifically mapped into Avid's audio patchbay/channel structure; **not verified in this research**.
- CineD's discontinuation article and the Grass Valley forum comparison thread both returned 403/navigation-only content on fetch — cited by title/URL only, not independently content-verified beyond what search snippets showed.
- Exact wording/existence of a distinct "sync accuracy mode" selector in the v4 UI beyond drift-correction toggle and the (removed) v3 Try-Really-Hard — the manual's "Sync menu" description lists only Synchronize/Cancel/Reset/Drift-toggle, suggesting v4 genuinely had **no** further accuracy-mode selector, but this is inferred from omission rather than an explicit statement that none exists.

---

## Sources (All URLs Used)

**Official Maxon manual (help.maxon.net):**
- [Overview / manual TOC](https://help.maxon.net/rg/en-us/Content/html/OVERVIEW.html)
- [What is PluralEyes?](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-what-is-pluraleyes-4.html)
- [How PluralEyes Works](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-how-pluraleyes-works.html)
- [The Main Interface](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-the-main-interface.html)
- [The Menu Items](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-the-menu-items.html)
- [Keyboard Shortcuts](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-keyboard-shortcuts.html)
- [Using a PluralEyes Project](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-using-a-pluraleyes-project.html)
- [Working with Tracks and Media Clips](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-working-with-media-clips.html)
- [Prepare Files for the Sync](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-prepare-files-for-the-sync.html)
- [Import Media](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-import-media.html)
- [Import Project from NLE](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-import-project-from-nle.html)
- [Work with Spanned Clips](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-work-with-spanned-clips.html)
- [Adjust the Sync Results](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-adjust-the-sync-results.html)
- [Troubleshoot the Sync](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-troubleshoot-the-sync.html)
- [Overview of Exporting](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-overview-of-exporting.html)
- [Export as Media Files](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-as-media-files.html)
- [Export to Final Cut Pro X](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-final-cut-pro-x.html)
- [Export to Premiere Pro](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-premiere-pro.html)
- [Export via PluralEyes 4 Panel](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-via-pluraleyes-4-panel.html)
- [Export to Vegas Pro](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-vegas-pro.html)
- [Export to Resolve](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-export-to-resolve.html)
- [System Requirements](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-system-requirements.html)
- [Supported Media Formats](https://help.maxon.net/rg/en-us/Content/html/Pluraleyes-supported-media-formats.html)

**Maxon/Red Giant knowledge base & product pages:**
- [PluralEyes: Limited Maintenance Mode (KB)](https://support.maxon.net/hc/en-us/articles/7389361453340-PluralEyes-Limited-Maintenance-Mode)
- [Maxon: PluralEyes to Enter Limited Maintenance Mode (article)](https://www.maxon.net/en/article/pluraleyes-to-enter-limited-maintenance-mode)
- [Toolfarm mirror of the above](https://www.toolfarm.com/knowledge-base/maxon-red-giant-redshift-specific/pluraleyes-to-enter-limited-maintenance-mode/)
- [Error: PluralEyes could not prepare media to synchronize (KB)](https://support.maxon.net/hc/en-us/articles/360043389574-Error-PluralEyes-could-not-prepare-media-to-synchronize)
- [(FCP X) Error: DTD Validation Failed (KB)](https://support.maxon.net/hc/en-us/articles/4408558715538--FCP-X-Error-DTD-Validation-Failed)
- [(Premiere) Why aren't my unsynced clips colored? (KB)](https://support.maxon.net/hc/en-us/articles/232058347--Premiere-Why-aren-t-my-unsynced-clips-colored)
- [PluralEyes product page (maxon.net)](https://www.maxon.net/en/product-detail/red-giant/pluraleyes)

**Press / reviews:**
- [ProVideoCoalition: Fare-thee-well PluralEyes](https://www.provideocoalition.com/fare-thee-well-pluraleyes-you-were-truly-revolutionary/)
- [ProVideoCoalition: Review of Red Giant PluralEyes 4](https://www.provideocoalition.com/review-red-giant-pluraleyes-4/)
- [ProVideoCoalition: Audio Waveform Sync Shootout — PluralEyes vs Syncaila](https://www.provideocoalition.com/sync-shootout-pluraleyes-vs-syncaila/)
- [ProVideoCoalition: PluralEyes 3 beta testing](https://www.provideocoalition.com/pluraleyes_3_is_ready_for_your_beta_testing_and_audio_syncing/)
- [ProVideoCoalition: New PluralEyes 3.5 / Shooter Suite 12.5](https://www.provideocoalition.com/new-pluraleyes-3-5-released-as-part-of-shooter-suite-12-5-update/)
- [ProVideoCoalition: PluralEyes for Avid (Steve Hullfish)](https://www.provideocoalition.com/pluraleyes_for_avid/)
- [ProVideoCoalition: PluralEyes for Avid Media Composer ships](https://www.provideocoalition.com/pluraleyes_for_avid_media_composer_ships_and_syncs_for_you/)
- [ProVideoCoalition: Sync-N-Link X for FCPX](https://www.provideocoalition.com/sync-n-link-x-for-final-cut-pro-x/)
- [CineD: PluralEyes Discontinued](https://www.cined.com/pluraleyes-discontinued-pioneer-in-syncing-videos-based-on-waveforms/)
- [RedShark News: Plural Eyes 3 review](https://www.redsharknews.com/post-vfx/item/237-plural-eyes-3-slick-sound-syncing)
- [Dan McComb: PluralEyes 3.5 review](https://www.danmccomb.com/pluraleyes-3-5-takes-the-work-out-of-syncing-sound-with-picture/)
- [Paul Joy: PluralEyes for Final Cut Pro (2010)](https://www.pauljoy.com/2010/03/pluraleyes-for-final-cut-pro/)
- [AWN: Red Giant Announces Major Update to PluralEyes in Shooter Suite 13.0](https://www.awn.com/news/red-giant-announces-major-update-pluraleyes-shooter-suite-130-release)
- [Newsshooter: PluralEyes 4.1.11 adds DaVinci Resolve Support](https://www.newsshooter.com/2020/08/04/pluraleyes-4-1-11-update-adds-davinci-resolve-support/)
- [Visualsproducer: Red Giant Shooter Suite 13 with PluralEyes 4 review](https://visualsproducer.wordpress.com/2016/02/29/red-giant-shooter-suite-13-with-pluraleyes-4-review/)
- [Streaming Media Producer: Tutorial — Syncing Multicam Footage With PluralEyes 3](https://www.streamingmedia.com/Producer/Articles/Editorial/Featured-Articles/Tutorial-Syncing-Multicam-Footage-With-PluralEyes-3-90758.aspx)
- [digitalfilms wordpress: PluralEyes 3](https://digitalfilms.wordpress.com/2013/02/15/pluraleyes-3/)
- [4RFV: Red Giant Ships PluralEyes Upgrade](https://www.4rfv.co.uk/industrynews/154732/red_giant_ships_pluraleyes_upgrade)
- [ProductionHUB: Red Giant 24-Hour Flash Sale](https://www.productionhub.com/press/60636/red-giant-24-hour-flash-sale-25-off-shooter-suite-13-and-pluraleyes-41)

**Forums / community:**
- [Creative COW: PluralEyes to FCPX DTD validation failed](https://creativecow.net/forums/thread/pluraleyes-to-fcpx-dtd-validation-failed/)
- [Creative COW: How to stop pluraleyes re-ordering shots in a timeline?](https://creativecow.net/forums/thread/how-to-stop-pluraleyes-re-ordering-shots-in-a-time/)
- [Blackmagic Forum: Resolve 18.1 Breaks AAF Support For Plural Eyes 3.5](https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=171978)
- [DVXuser: Audio Drift](https://www.dvxuser.com/threads/audio-drift.5710831/)
- [Adobe Community: Why is Premiere Pro's audio sync still so unreliable compared to PluralEyes](https://community.adobe.com/t5/premiere-pro-ideas/why-is-premiere-pro-s-audio-sync-still-so-unreliable-compared-to-pluraleyes/idi-p/15241767)
- [Adobe Community: Premiere Pro multicam synchronization kinda sucks](https://community.adobe.com/t5/premiere-pro-discussions/premiere-pro-multicam-synchronization-kinda-sucks/td-p/14136064)
- [Adobe Community feature request: Editors need a multicam/multilayer audio sync feature since PluralEyes stopped working](https://community.adobe.com/feature-requests-730/editors-need-a-multicam-multilayer-audio-sync-feature-since-plural-eyes-has-stopped-working-1328276)

**Competitor sources:**
- [Syncaila: User guide 3.x](https://syncaila.com/help)
- [Intelligent Assistance: Sync-N-Link X](https://www.intelligentassistance.com/sync-n-link-x/)
- [CamHeard: PluralEyes Alternative comparison](https://camheard.com/pluraleyes-alternative)

**Referenced but not content-verified (flagged in §9):**
- [Su-Laine Yeo Brodsky: Designing the PluralEyes 3 User Experience](http://www.sulainebrodsky.com/pluraleyes3_case_study/) (content not retrievable)
- [Grass Valley Forum: Audio Sync Review and PluralEyes Comparison](https://forum.grassvalley.com/forum/editors/editing-with-edius/45099-audio-sync-review-and-pluraleyes-comparison) (403 on fetch)