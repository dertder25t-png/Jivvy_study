# Local card helper (Intel NPU)

A small model (Qwen3 1.7B, 4-bit) running on the laptop's NPU that turns note passages into
flashcards. Notes never leave the machine: the helper only listens on `127.0.0.1:8765`.

## Use it

```bash
scripts/npu-cards/setup.sh   # once: own Python env + model in ~/.local/share/jivvy-npu (~1.6 GB disk)
scripts/npu-cards/start.sh   # leave running while you take notes
```

Then in Jivvy: **Settings → Local AI → Write cards with this laptop's NPU**. With "Make cards
while I write" on, a few seconds after you stop typing, new definitions show up in the note's
Flashcards panel under "Waiting for your OK".

## Staying light

| State | RAM | Notes |
|---|---|---|
| Helper idle | ~20 MB | the model isn't loaded |
| Making cards | ~650–900 MB | runs on the NPU; a few seconds per pause once warm |
| 3 min with no requests | back to ~20 MB | the helper restarts itself to free memory |

Waking up takes ~3 s (the compiled NPU model is cached in `npu-cache/`; the very first run
compiles for ~30 s). It runs at low CPU priority (`nice`), handles one request at a time, only
gets passages it hasn't seen in that note before, and does nothing while the tab is in the background.

Settings: `JIVVY_NPU_IDLE_MINUTES` (default 3), `JIVVY_NPU_PORT` (8765), `JIVVY_NPU_DEVICE`
(`NPU`; `CPU` as a fallback).

## How it fits

The model does two jobs; Jivvy's own rules still check every card (stage 3) and nothing enters
the deck until you approve it:

1. **Rewrite** (stage 2): passages the pattern rules found (`**Term** — meaning`, `Term: meaning`…)
   get a cleaner card. If the model's card fails the checks, the rule-based card is used instead.
2. **Find** (stage 1b, `src/core/flashcards/modelFind.ts`): the model reads the note a section at a
   time for terms explained in plain sentences ("osmosis is when water moves…"), which the rules
   miss. A small model can make things up, so each suggestion is kept only if the term really is
   in that part of the note and most of the definition's words come from it. Labels like "Exam"
   and terms the rules already found are skipped. The app remembers which sections the model has
   read (per device), so it only reads sections that are new or changed.

If the helper isn't running, cards are made the usual way.

Why the model is converted locally: the NPU compiler needs *symmetric* 4-bit weights, and the
ready-made `OpenVINO/Qwen3-1.7B-int4-ov` upload is asymmetric (it fails to compile on the NPU).
`convert.py` builds an NPU-ready copy from the fp16 upload.
