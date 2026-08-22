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

ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions"
MODEL = "glm-4.6v"
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


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    image, question = sys.argv[1], " ".join(sys.argv[2:])
    key = os.environ.get("ZAI_API_KEY")
    if not key:
        print("ZAI_API_KEY is not set", file=sys.stderr)
        return 1
    if not os.path.exists(image):
        print(f"no such image: {image}", file=sys.stderr)
        return 1

    raw, media = shrink(image)
    data = base64.b64encode(raw).decode()
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1500,
        "messages": [{"role": "user", "content": [
            {"type": "image_url",
             "image_url": {"url": f"data:{media};base64,{data}"}},
            {"type": "text", "text": question},
        ]}],
    }).encode()

    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.load(resp)
    except Exception as e:  # noqa: BLE001 - surface whatever went wrong
        print(f"request failed: {e}", file=sys.stderr)
        return 1

    if "choices" not in payload:
        print(json.dumps(payload)[:800], file=sys.stderr)
        return 1
    # glm-4.6v sometimes emits its answer twice in one content string; the
    # duplicate is exact, so collapse it rather than showing the reader double.
    text = payload["choices"][0]["message"]["content"].strip()
    half = len(text) // 2
    if len(text) % 2 == 0 and text[:half] == text[half:]:
        text = text[:half]
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
