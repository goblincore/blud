import json

import numpy as np
import pytest
import torch

from nupscale.constants import DATASET_FORMAT
from nupscale.convert_p2 import convert_p2, pair_crop
from nupscale.data import load_dataset
from tests.helpers import hwc, upsample_nearest


def _write_p2(root):
    frames = []
    for seq in range(3):
        (root / f"seq{seq}").mkdir(parents=True)
        for f in range(2 + (seq == 0)):
            inp = torch.zeros(4, 20, 30)
            inp[3] = 1.0
            if f < 2:  # seq 0 frame 2 stays empty and is skipped
                inp[:, 5:9, 10:14] = 0.5
            np.save(root / f"seq{seq}/frame{f:03d}-in.npy", hwc(inp))
            np.save(root / f"seq{seq}/frame{f:03d}-target.npy", hwc(upsample_nearest(inp)))
            frames.append({"seq": seq, "frame": f, "room": 1, "body": 2, "dist": [1.0, 2.5, 5.0][seq], "orbit": 0,
                           "input": f"seq{seq}/frame{f:03d}-in.npy", "target": f"seq{seq}/frame{f:03d}-target.npy",
                           "inputCoverage": 0.03})
    (root / "manifest.json").write_text(json.dumps({"near": 0.1, "far": 200, "checkout": "abc", "frames": frames}))


def test_pair_crop_rule():
    inp = np.ones((20, 30, 4), dtype=np.float32)
    target = np.ones((40, 60, 4), dtype=np.float32)
    assert pair_crop(inp, target) is None
    inp[5:9, 10:14, 3] = 0.5
    assert pair_crop(inp, target) == (2, 0, 20, 17)
    target[30:31, 57:59, 3] = 0.5  # target-only flesh, halved outward: x 28..30, y 15..16
    assert pair_crop(inp, target) == (2, 0, 28, 20)


def test_convert_p2(tmp_path):
    _write_p2(tmp_path / "p2")
    m = convert_p2(tmp_path / "p2", tmp_path / "v2")
    assert m["format"] == DATASET_FORMAT and len(m["pairs"]) == 6 and m["stats"]["skippedEmpty"] == 1
    assert m["pairs"][0]["crop"] == {"x": 2, "y": 0, "w": 20, "h": 17}
    assert [p["class"] for p in m["pairs"]][::2] == ["close", "medium", "far"]
    assert {p["split"] for p in m["pairs"] if p["seq"] == 2} == {"val"}
    assert {p["split"] for p in m["pairs"] if p["seq"] < 2} == {"train"}
    assert [p["showcase"] for p in m["pairs"]].count(True) == 2
    assert (tmp_path / "v2" / "pairs.jsonl").read_text().count("\n") == 6
    ds = load_dataset(tmp_path / "v2")
    assert ds.pairs[0].inp.shape == (4, 17, 20) and ds.pairs[0].target.shape == (4, 34, 40)
    assert int(ds.pairs[0].masks["flesh"].sum()) == 64
    with pytest.raises(FileExistsError):
        convert_p2(tmp_path / "p2", tmp_path / "v2")
