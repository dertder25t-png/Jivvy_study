#!/usr/bin/env python3
"""Jivvy local card helper: a tiny model on the laptop's Intel NPU that rewrites note passages
into flashcards. Nothing leaves this machine — it listens on 127.0.0.1 only.

Built to stay out of the way of other AI work on the same laptop:
  * the model loads on the first request, not at start-up;
  * it unloads itself after IDLE_MINUTES with no requests, giving the RAM back;
  * it runs on the NPU (low power) and does one request at a time;
  * the compiled NPU blob is cached on disk, so a reload takes seconds, not minutes.

    python server.py            # uses defaults below
    JIVVY_NPU_DEVICE=CPU python server.py   # fall back to CPU if the NPU misbehaves
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOME = Path(os.environ.get("JIVVY_NPU_HOME", Path.home() / ".local/share/jivvy-npu"))
MODEL_DIR = Path(os.environ.get("JIVVY_NPU_MODEL", HOME / "models/qwen3-1.7b-int4-sym"))
DEVICE = os.environ.get("JIVVY_NPU_DEVICE", "NPU")
PORT = int(os.environ.get("JIVVY_NPU_PORT", "8765"))
IDLE_MINUTES = float(os.environ.get("JIVVY_NPU_IDLE_MINUTES", "3"))
MAX_CANDIDATES = 40  # per request; the app only sends new passages anyway
MODEL_NAME = "npu:" + MODEL_DIR.name
PROMPT_VERSION = "npu-v1"
FIND_VERSION = "npu-find-v2"

# Which web pages may call this helper. Anything else is refused by the browser.
ALLOWED_ORIGINS = re.compile(
    r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|https://jivvy-study(-[a-z0-9-]+)?\.vercel\.app)$"
)

SYSTEM = (
    "You turn a student's note into ONE flashcard. Use only facts in the note; never add new ones.\n"
    "Reply with exactly two lines and nothing else:\n"
    "TERM: <the term, 1-6 words>\n"
    "DEF: <one plain sentence, at most 25 words, with ONE idea only (drop side remarks), that explains "
    "the term without using the term itself, without 'it'/'they', and without 'the lecture/professor says'>\n"
    "If the note does not define anything, reply: NONE"
)

FIND_SYSTEM = (
    "You find every term a student's notes define or explain, so each can become a flashcard. "
    "Use only what the notes say; never add facts. Skip to-dos, dates, names of tests and examples. "
    "Write one line per term and nothing else, in the form\n"
    "TERM: <term as written in the notes> | DEF: <one short sentence from the notes, without the term itself>\n"
    "If nothing is defined, write NONE."
)
# One worked example: a 1.7B model follows a shown pattern far better than instructions alone.
FIND_EXAMPLE = [
    {"role": "user", "content": "Notes:\n# Cells\nWe looked at cells under the microscope. The nucleus holds the cell's DNA. "
                                "Ribosomes are where proteins get made. Lab due Monday.\n/no_think"},
    {"role": "assistant", "content": "TERM: Nucleus | DEF: The part of the cell that holds its DNA.\n"
                                     "TERM: Ribosomes | DEF: Where proteins get made in the cell."},
]
MAX_BLOCKS = 20

_lock = threading.Lock()  # one generation at a time (and guards load/unload)
_pipe = None
_last_used = 0.0


def _load():
    global _pipe
    if _pipe is None:
        import openvino_genai as ov_genai  # imported lazily so an idle helper stays small

        cache = HOME / "npu-cache"
        cache.mkdir(parents=True, exist_ok=True)
        cfg = {"CACHE_DIR": str(cache)}
        if DEVICE == "NPU":
            # Short notes in, two short lines out: small static shapes keep NPU memory low.
            # A ~250-word block in, a short list out. Fixed shapes keep NPU memory predictable.
            cfg.update({"MAX_PROMPT_LEN": 512, "MIN_RESPONSE_LEN": 160})
        t = time.time()
        _pipe = ov_genai.LLMPipeline(str(MODEL_DIR), DEVICE, **cfg)
        print(f"[jivvy-npu] model loaded on {DEVICE} in {time.time() - t:.1f}s", flush=True)
    return _pipe


def _unload_when_idle():
    """After IDLE_MINUTES with no requests, restart this process: dropping the model alone still
    leaves ~250 MB of runtime libraries in memory, a fresh process idles at ~20 MB."""
    while True:
        time.sleep(20)
        with _lock:
            if _pipe is not None and time.time() - _last_used > IDLE_MINUTES * 60:
                print("[jivvy-npu] idle — unloading model", flush=True)
                os.execv(sys.executable, [sys.executable, *sys.orig_argv[1:]])


def _parse(text: str):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    if text.upper().startswith("NONE"):
        return None
    term = re.search(r"^\s*TERM:\s*(.+)$", text, re.M | re.I)
    defn = re.search(r"^\s*DEF:\s*(.+)$", text, re.M | re.I)
    if not term or not defn:
        return None
    clean = lambda s: s.strip().strip('"*').strip()
    return clean(term.group(1)), clean(defn.group(1))


def make_cards(candidates: list[dict]) -> list[dict]:
    global _last_used
    import openvino_genai as ov_genai

    out = []
    with _lock:
        pipe = _load()
        gen = ov_genai.GenerationConfig()
        gen.max_new_tokens = 64
        gen.do_sample = False
        for c in candidates[:MAX_CANDIDATES]:
            note = str(c.get("text") or "")[:1200]
            hint = str(c.get("term_hint") or "")[:80]
            user = f"Note:\n{note}\n" + (f"\nLikely term: {hint}\n" if hint else "") + "/no_think"
            chat = ov_genai.ChatHistory([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
            res = pipe.generate(chat, gen)
            reply = res.texts[0] if hasattr(res, "texts") else str(res)
            parsed = _parse(reply)
            if parsed:
                term, definition = parsed
                out.append({
                    "candidate_id": c.get("id"), "term": term, "definition": definition,
                    "card_type": "term_def", "cloze_text": None,
                    # The app's own rules still check every card; this just says "a model wrote it".
                    "confidence": 0.85, "raw": reply,
                })
        _last_used = time.time()
    return out


def _parse_list(text: str) -> list[tuple[str, str]]:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    pairs = []
    for m in re.finditer(r"^\s*(?:[-*\d.]+\s*)?TERM:\s*(.+?)\s*\|\s*DEF:\s*(.+?)\s*$", text, re.M | re.I):
        term, definition = (g.strip().strip('"*').strip() for g in m.groups())
        if term and definition:
            pairs.append((term, definition))
    return pairs


def find_terms(blocks: list[dict]) -> list[dict]:
    """Definitions the model spots in each block. The app checks that every term really is in the note."""
    global _last_used
    import openvino_genai as ov_genai

    out = []
    with _lock:
        pipe = _load()
        gen = ov_genai.GenerationConfig()
        gen.max_new_tokens = 150
        gen.do_sample = False
        for b in blocks[:MAX_BLOCKS]:
            text = str(b.get("text") or "")[:1000]
            chat = ov_genai.ChatHistory([
                {"role": "system", "content": FIND_SYSTEM},
                *FIND_EXAMPLE,
                {"role": "user", "content": f"Notes:\n{text}\n/no_think"},
            ])
            res = pipe.generate(chat, gen)
            reply = res.texts[0] if hasattr(res, "texts") else str(res)
            for term, definition in _parse_list(reply):
                out.append({"block_id": b.get("id"), "term": term, "definition": definition})
        _last_used = time.time()
    return out


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin and ALLOWED_ORIGINS.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": MODEL_NAME, "device": DEVICE, "loaded": _pipe is not None})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/cards", "/find"):
            return self._json(404, {"error": "not found"})
        origin = self.headers.get("Origin", "")
        if origin and not ALLOWED_ORIGINS.match(origin):
            return self._json(403, {"error": "origin not allowed"})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 200_000)
            req = json.loads(self.rfile.read(length) or b"{}")
            t = time.time()
            if self.path == "/find":
                blocks = [b for b in req.get("blocks", []) if isinstance(b, dict)]
                found = find_terms(blocks)
                print(f"[jivvy-npu] {len(blocks)} blocks → {len(found)} terms in {time.time() - t:.1f}s", flush=True)
                return self._json(200, {"found": found, "model": MODEL_NAME, "prompt_version": FIND_VERSION})
            cands = [c for c in req.get("candidates", []) if isinstance(c, dict)]
            cards = make_cards(cands)
            print(f"[jivvy-npu] {len(cands)} passages → {len(cards)} cards in {time.time() - t:.1f}s", flush=True)
            self._json(200, {"cards": cards, "model": MODEL_NAME, "prompt_version": PROMPT_VERSION})
        except Exception as e:  # keep the helper alive; the app falls back to its rules
            print(f"[jivvy-npu] error: {e}", flush=True)
            self._json(500, {"error": str(e)})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    if not (MODEL_DIR / "openvino_model.xml").exists():
        raise SystemExit(f"No model at {MODEL_DIR}. Run scripts/npu-cards/setup.sh first.")
    threading.Thread(target=_unload_when_idle, daemon=True).start()
    print(f"[jivvy-npu] listening on http://127.0.0.1:{PORT} ({DEVICE}, unloads after {IDLE_MINUTES:g} min idle)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
