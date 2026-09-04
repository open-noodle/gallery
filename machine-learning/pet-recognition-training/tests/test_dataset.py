# tests/test_dataset.py
import torch

from petid.dataset import PetDataset, build_transform, label_map_for
from petid.manifest import build


def _train_recs(synthetic_data_root, tmp_path):
    out = tmp_path / "m.json"
    recs = build(str(synthetic_data_root), str(out), min_images=2, test_frac=0.5, seed=0)
    return [r for r in recs if r.split == "train"]


def test_transform_shape_and_norm():
    from PIL import Image

    t = build_transform(train=False)
    x = t(Image.new("RGB", (50, 30), (128, 128, 128)))
    assert x.shape == (3, 224, 224) and x.dtype == torch.float32


def test_dataset_yields_tensor_and_label(synthetic_data_root, tmp_path):
    recs = _train_recs(synthetic_data_root, tmp_path)
    lm = label_map_for(recs)
    ds = PetDataset(recs, lm, train=True)
    x, y = ds[0]
    assert x.shape == (3, 224, 224)
    assert 0 <= y < len(lm)


def test_label_map_is_contiguous(synthetic_data_root, tmp_path):
    recs = _train_recs(synthetic_data_root, tmp_path)
    lm = label_map_for(recs)
    assert sorted(lm.values()) == list(range(len(lm)))
