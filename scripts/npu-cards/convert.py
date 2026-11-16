#!/usr/bin/env python3
"""Makes an NPU-ready copy of a full-precision OpenVINO model: symmetric 4-bit weights, which the
Intel NPU compiler needs (the stock "int4" uploads are asymmetric and fail to compile on NPU).

    python convert.py <fp16 model dir> <output dir> [group size: 128 (default) or -1]
"""
import shutil
import sys
from pathlib import Path

import nncf
import openvino as ov

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
group = int(sys.argv[3]) if len(sys.argv) > 3 else 128
dst.mkdir(parents=True, exist_ok=True)

model = ov.Core().read_model(src / "openvino_model.xml")
model = nncf.compress_weights(model, mode=nncf.CompressWeightsMode.INT4_SYM, ratio=1.0, group_size=group)
ov.save_model(model, dst / "openvino_model.xml", compress_to_fp16=False)

for f in src.iterdir():  # tokenizer, detokenizer, configs, chat template
    if f.is_file() and not f.name.startswith("openvino_model."):
        shutil.copy2(f, dst / f.name)
print(f"saved {dst}")
