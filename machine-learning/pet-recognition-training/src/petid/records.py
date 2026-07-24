import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ImageRecord:
    path: str
    species: str
    individual_id: str
    dataset: str
    split: str = ""


def write_manifest(records: list[ImageRecord], path: str) -> None:
    with open(path, "w") as f:
        json.dump({"records": [asdict(r) for r in records]}, f, indent=2)


def read_manifest(path: str) -> list[ImageRecord]:
    with open(path) as f:
        data = json.load(f)
    return [ImageRecord(**r) for r in data["records"]]
