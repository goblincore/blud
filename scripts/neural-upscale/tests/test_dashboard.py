import json

import numpy as np
import torch
from PIL import Image

from nupscale.dashboard import INDEX_HTML, Dashboard
from nupscale.images import BACKGROUND, save_march_png, to_rgb8
from tests.helpers import random_march


def test_to_rgb8_tonemaps_and_paints_background():
    march = torch.tensor([[[0.0, 1.0]], [[0.0, 1.0]], [[0.0, 1.0]], [[0.5, 1.0]]])
    u8 = to_rgb8(march)
    assert u8.shape == (1, 2, 3) and u8.dtype == np.uint8
    assert tuple(u8[0, 0]) == (0, 0, 0) and tuple(u8[0, 1]) == BACKGROUND
    one = torch.tensor([1.0, 1.0, 1.0, 0.5]).view(4, 1, 1)
    assert int(to_rgb8(one)[0, 0, 0]) == int((0.5 ** (1 / 2.2)) * 255 + 0.5)


def test_save_png_enlarges_with_nearest(tmp_path):
    march = random_march(10, 20, seed=1)
    factor = save_march_png(march, tmp_path / "a.png")
    img = np.asarray(Image.open(tmp_path / "a.png"))
    assert factor == 8 and img.shape == (80, 160, 3)
    assert np.array_equal(img[::8, ::8], to_rgb8(march))


def test_dashboard_writes_json_and_index_and_reloads(tmp_path):
    d = Dashboard(tmp_path / "root")
    d.run("s8-rgb")["state"] = "running"
    d.showcase_images("s8-rgb", "best")["p1"] = "img/x.png"
    d.save()
    assert (tmp_path / "root" / "index.html").read_text().startswith("<!doctype html>")
    saved = json.loads((tmp_path / "root" / "dashboard.json").read_text())
    assert saved["format"] == "blud-upscale-dashboard/1" and saved["updated"]
    assert saved["runs"][0]["state"] == "running" and saved["showcase"]["runs"]["s8-rgb"]["best"] == {"p1": "img/x.png"}
    again = Dashboard(tmp_path / "root")
    assert again.run("s8-rgb")["state"] == "running" and len(again.state["runs"]) == 1


def test_index_html_is_self_contained():
    html = INDEX_HTML.read_text()
    assert "http://" not in html and "https://" not in html
    assert "dashboard.json" in html and "30000" in html
