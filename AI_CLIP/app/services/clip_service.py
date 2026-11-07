from threading import RLock
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    import numpy as np
    from PIL import Image
    from sentence_transformers import SentenceTransformer

from app.config import Settings


class ClipService:
    """Owns CLIP models and converts images or text into normalized vectors."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._image_model: SentenceTransformer | None = None
        self._text_model: SentenceTransformer | None = None
        self._lock = RLock()

    @property
    def is_loaded(self) -> bool:
        return self._image_model is not None and self._text_model is not None

    def model_loaded(self, kind: Literal["image", "text"]) -> bool:
        return (self._image_model if kind == "image" else self._text_model) is not None

    def probe_embedding(
        self, kind: Literal["image", "text"], image: "Image.Image | None" = None,
    ) -> "np.ndarray | None":
        """Use already loaded models only; never queue behind foreground inference."""
        if not self._lock.acquire(blocking=False):
            raise BlockingIOError("Inference busy")
        try:
            if not self.model_loaded(kind):
                return None
            if kind == "image":
                if image is None:
                    raise ValueError("Image probe requires a decoded image")
                return self.encode_image(image)
            return self.encode_text("search service readiness")
        finally:
            self._lock.release()

    @property
    def embedding_dimension(self) -> int:
        if self._image_model is None:
            raise RuntimeError("CLIP image model is not loaded")
        get_dimension = getattr(self._image_model, "get_embedding_dimension", None)
        if get_dimension is not None:
            return int(get_dimension())
        return int(self._image_model.get_sentence_embedding_dimension())

    def load(self, device: str | None = None) -> None:
        from sentence_transformers import SentenceTransformer

        self._image_model = SentenceTransformer(
            self._settings.image_model_name,
            device=device,
        )
        self._text_model = SentenceTransformer(
            self._settings.text_model_name,
            device=device,
        )

    def encode_image(self, image: "Image.Image") -> "np.ndarray":
        return self.encode_images([image])

    def encode_images(self, images: list["Image.Image"]) -> "np.ndarray":
        if self._image_model is None:
            raise RuntimeError("CLIP image model is not loaded")
        with self._lock:
            return self._image_model.encode(
                images,
                convert_to_numpy=True,
                normalize_embeddings=True,
            ).astype("float32")

    def encode_text(self, text: str) -> "np.ndarray":
        if self._text_model is None:
            raise RuntimeError("CLIP text model is not loaded")
        with self._lock:
            return self._text_model.encode(
                [text],
                convert_to_numpy=True,
                normalize_embeddings=True,
            ).astype("float32")
