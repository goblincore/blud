#!/usr/bin/env python3
"""Ask a vision model about a local image, from the shell.

WHY THIS EXISTS
---------------
Several models used for character-authoring tasks here (glm-5.x, kimi-k3)
have NO native vision on the `pi` dispatch harness — `Read` on a PNG does not
show them the picture. That has silently wrecked three character runs: the
model works from prose, and the result misses its reference badly.

Z.AI ship a Vision MCP server for exactly this, but `pi` has no MCP support
at all (dispatch-ui's exec.go: "Pi doesn't have MCP, so we prepend it").
The MCP is only glm-5.x calling glm-4.6v, though — so this script does that
call directly over plain HTTP, which any agent with Bash can use.

ENDPOINT, AND THE TWO THAT DO NOT WORK
--------------------------------------
Use the CODING-PLAN OpenAI-compatible endpoint. Measured 2026-08-22:

  https://api.z.ai/api/coding/paas/v4   OK    correct description
  https://api.z.ai/api/anthropic        NO    accepts the request and returns
                                              an answer, but the image is not
                                              really carried: a 700x700 image
                                              adds only ~115 input tokens and
                                              the reply is no better than the
                                              same prompt with NO image at all
                                              (both hallucinate). Silent, and
                                              the reason this file names an
                                              endpoint instead of a provider.
  https://open.bigmodel.cn/api/paas/v4  NO    "insufficient balance" (that is
                                              pay-as-you-go, not the plan)

WHAT IT IS GOOD FOR, AND WHAT IT IS NOT
---------------------------------------
Measured against a known reference and a known-bad render, 2026-08-22:

  GOOD: describing a clean reference image. On the mouse reference it
        correctly returned "a mouse, wearing a red shirt, blue shorts, and
        sunglasses, with yellow skin" and "the ears are wide round plates,
        one ear roughly half the head width". That is the real win — it
        replaces guessing from prose.

  BAD:  judging your OWN render. Shown a render whose ears are plainly TALL
        NARROW COLUMNS it answered "wide round plates", and when asked
        neutrally for width-vs-height it said width was 1.3x height — the
        wrong way round. It did get "not wearing any clothes" right, so it
        reads presence/absence and colour fine; it is the SHAPE and
        PROPORTION judgement that is unreliable, and it tends to agree with
        what it thinks the thing is meant to be.

So: use this to read the REFERENCE. To check your own render, threshold the
render and measure the bounding boxes yourself — your render is a clean
subject on a dark ground, so pixel measurement is exact and this model's
impression is not.

Usage:
    python3 scripts/vision-ask.py <image> "<question>"
    VISION_BACKEND=kimi python3 scripts/vision-ask.py <image> "<question>"

Backends are tried in order (kimi, then zai) and the first that answers wins;
set VISION_BACKEND to pin one. Keys come from KIMI_API_KEY / ZAI_API_KEY, or
are borrowed from ~/.pi/agent/models.json if those are unset (note the stored
zai key there is stale — prefer the env var).

The two are on SEPARATE quotas, which is the point of having both: Z.AI's
coding plan has a rolling 5-hour limit that has already halted a work session
mid-flight, and when it trips every call 429s until the window rolls.
    python3 scripts/vision-ask.py render.png "Do the ears read as wide round
                                              plates, or as tall columns?"

Needs ZAI_API_KEY in the environment.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

# TWO BACKENDS, tried in order. Kimi is first because it is on a SEPARATE
# quota from Z.AI and gave the better answer in testing: on the mouse profile
# it volunteered "a cartoon-style character with a long snout", which is the
# exact feature two authoring runs had missed, while glm-4.6v needed leading.
#
# NOTE pi's own model registry (~/.pi/agent/models.json) declares kimi k3 as
# `input: ["text"]`. That is WRONG — the API accepts images fine (a 700 px
# image bills ~527 input tokens and comes back described correctly). The
# registry entry is why the dispatch harness will not hand k3 an image itself,
# and therefore why this script exists rather than just using Read.
BACKENDS = [
    {
        "name": "kimi",
        "url": "https://api.kimi.com/coding/v1/messages",
        "model": "k3",
        "api": "anthropic",
        "key_env": "KIMI_API_KEY",
        "pi_provider": "kimi",
    },
    {
        "name": "zai",
        "url": "https://api.z.ai/api/coding/paas/v4/chat/completions",
        "model": "glm-4.6v",
        "api": "openai",
        "key_env": "ZAI_API_KEY",
        "pi_provider": "zai",
    },
]
# A full-size render is several MB and the payload is base64, so it inflates by
# 4/3. 900 px is comfortably enough to judge a silhouette and keeps the request
# small; the shell also has an argv length limit, which is why the body is
# written to a file rather than passed inline.
MAX_EDGE = 900


def shrink(path: str) -> tuple[bytes, str]:
    """Downscale to JPEG via sips (macOS built-in, no pip install needed)."""
    out = os.path.join(tempfile.mkdtemp(), "img.jpg")
    r = subprocess.run(
        ["sips", "-s", "format", "jpeg", "-Z", str(MAX_EDGE), path, "--out", out],
        capture_output=True,
    )
    if r.returncode != 0 or not os.path.exists(out):
        # sips is macOS-only; fall back to sending the original bytes.
        with open(path, "rb") as f:
            ext = os.path.splitext(path)[1].lower()
            return f.read(), "image/png" if ext == ".png" else "image/jpeg"
    with open(out, "rb") as f:
        return f.read(), "image/jpeg"


def key_for(backend: dict) -> str | None:
    """Env var first; otherwise borrow the key pi already has configured."""
    k = os.environ.get(backend["key_env"])
    if k:
        return k
    try:
        with open(os.path.expanduser("~/.pi/agent/models.json")) as f:
            cfg = json.load(f)
        return cfg["providers"][backend["pi_provider"]]["apiKey"]
    except Exception:  # noqa: BLE001 - absent config is not an error here
        return None


def build(backend: dict, data: str, media: str, question: str) -> tuple:
    """Return (url, body, headers) for this backend's wire format."""
    if backend["api"] == "anthropic":
        body = {"model": backend["model"], "max_tokens": 1500,
                "messages": [{"role": "user", "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": media, "data": data}},
                    {"type": "text", "text": question}]}]}
        headers = {"x-api-key": key_for(backend) or "",
                   "anthropic-version": "2023-06-01",
                   "content-type": "application/json"}
    else:
        body = {"model": backend["model"], "max_tokens": 1500,
                "messages": [{"role": "user", "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:{media};base64,{data}"}},
                    {"type": "text", "text": question}]}]}
        headers = {"Authorization": f"Bearer {key_for(backend) or ''}",
                   "Content-Type": "application/json"}
    return backend["url"], json.dumps(body).encode(), headers


def extract(backend: dict, payload: dict) -> str | None:
    if backend["api"] == "anthropic":
        parts = [c.get("text", "") for c in payload.get("content", [])
                 if c.get("type") == "text"]
        return "".join(parts).strip() or None
    ch = payload.get("choices")
    return ch[0]["message"]["content"].strip() if ch else None


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    image, question = sys.argv[1], " ".join(sys.argv[2:])
    if not os.path.exists(image):
        print(f"no such image: {image}", file=sys.stderr)
        return 1

    raw, media = shrink(image)
    data = base64.b64encode(raw).decode()

    only = os.environ.get("VISION_BACKEND")
    backends = [b for b in BACKENDS if not only or b["name"] == only]
    if not backends:
        print(f"unknown VISION_BACKEND={only}", file=sys.stderr)
        return 1

    problems = []
    for backend in backends:
        if not key_for(backend):
            problems.append(f"{backend['name']}: no API key")
            continue
        url, body, headers = build(backend, data, media, question)
        try:
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.load(resp)
        except Exception as e:  # noqa: BLE001 - fall through to the next backend
            # A 429 here is a quota wall, not a bug: Z.AI's coding plan has a
            # rolling 5-hour limit that has already stopped work once.
            problems.append(f"{backend['name']}: {e}")
            continue
        text = extract(backend, payload)
        if not text:
            problems.append(f"{backend['name']}: {json.dumps(payload)[:200]}")
            continue
        # glm-4.6v sometimes emits its answer twice in one string; the
        # duplicate is exact, so collapse it rather than showing it double.
        half = len(text) // 2
        if len(text) % 2 == 0 and text[:half] == text[half:]:
            text = text[:half]
        if len(backends) > 1 and backend is not backends[0]:
            print(f"[{backend['name']}]", file=sys.stderr)
        print(text)
        return 0

    for p in problems:
        print(f"vision-ask: {p}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
