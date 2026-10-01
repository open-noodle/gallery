from __future__ import annotations

from pathlib import Path

from huggingface_hub import snapshot_download

from immich_ml.config import log, settings
from immich_ml.models.base import _IGNORED_PATTERNS, InferenceModel
from immich_ml.schemas import Options

GALLERY_HF_ORG = "open-noodle"


class GalleryHostedModel[O: Options](InferenceModel[O]):
    """A Gallery-only model, published in Gallery's Hugging Face org rather than upstream's.

    Upstream's `download()` fetches `{settings.model_organization}/{name}` at `settings.model_revision`, and keeps each
    revision in its own cache folder once one is set. Neither applies to these repositories, which carry none of
    upstream's revisions: they always fetch `main`, into the unversioned folder existing installs already have.

    Graph preparation is not covered: `sessions/ort.py` keys fp16 conversion and graph rewrites for accelerators off the
    global `settings.legacy_models`, so setting `MACHINE_LEARNING_MODEL_REVISION` applies them to these models too,
    which were never validated that way.
    """

    def download(self) -> None:
        if self.cached:
            return
        model_type = self.model_type.replace("-", " ")
        log.info(f"Downloading {model_type} model '{self.model_name}' to {self.model_dir}. This may take a while.")
        snapshot_download(
            f"{GALLERY_HF_ORG}/{self.model_name}",
            cache_dir=self.cache_dir,
            local_dir=self.cache_dir,
            ignore_patterns=_IGNORED_PATTERNS.get(self.model_format, []),
        )
        if not self.cached:  # as upstream: this is what sends an RKNN/ARMNN model back to ONNX
            raise FileNotFoundError(f"Model file not found: {self.model_path}")

    @property
    def _cache_dir_default(self) -> Path:
        return settings.cache_folder / self.model_task.value / self.model_name
