# src/petid/dataset.py
from collections.abc import Callable

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms  # torchvision ships with torch

from petid.records import ImageRecord

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def build_transform(train: bool) -> Callable[[Image.Image], torch.Tensor]:
    ops: list = [transforms.Resize((224, 224))]
    if train:
        ops += [transforms.RandomHorizontalFlip(), transforms.ColorJitter(0.2, 0.2, 0.2)]
    ops += [transforms.ToTensor(), transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD)]
    return transforms.Compose(ops)


def label_map_for(records: list[ImageRecord]) -> dict[str, int]:
    ids = sorted({r.individual_id for r in records})
    return {ind: i for i, ind in enumerate(ids)}


class PetDataset(Dataset):
    def __init__(self, records: list[ImageRecord], label_map: dict[str, int], train: bool):
        self.records = records
        self.label_map = label_map
        self.transform = build_transform(train)

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, i: int) -> tuple[torch.Tensor, int]:
        r = self.records[i]
        img = Image.open(r.path).convert("RGB")
        return self.transform(img), self.label_map[r.individual_id]
