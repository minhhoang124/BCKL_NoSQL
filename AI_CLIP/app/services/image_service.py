from io import BytesIO

from PIL import Image, UnidentifiedImageError


class InvalidImageError(ValueError):
    pass


class ImageTooLargeError(InvalidImageError):
    pass


class UnsupportedImageFormatError(InvalidImageError):
    pass


class ImageService:
    """Validates uploaded bytes and decodes them as an RGB image."""

    _allowed_formats = {"JPEG", "PNG"}

    def __init__(self, max_image_bytes: int, max_image_pixels: int) -> None:
        self._max_image_bytes = max_image_bytes
        self._max_image_pixels = max_image_pixels

    @property
    def max_image_bytes(self) -> int:
        return self._max_image_bytes

    def decode(self, content: bytes) -> Image.Image:
        if not content:
            raise InvalidImageError("Image is empty")
        if len(content) > self._max_image_bytes:
            raise ImageTooLargeError("Image exceeds the configured size limit")

        try:
            with Image.open(BytesIO(content)) as source:
                if source.width * source.height > self._max_image_pixels:
                    raise ImageTooLargeError(
                        "Image dimensions exceed the configured pixel limit"
                    )
                source.verify()
            with Image.open(BytesIO(content)) as source:
                if source.format not in self._allowed_formats:
                    raise UnsupportedImageFormatError(
                        "Only JPEG and PNG image formats are supported"
                    )
                return source.convert("RGB")
        except Image.DecompressionBombError as error:
            raise ImageTooLargeError(
                "Image dimensions exceed Pillow's safety limit"
            ) from error
        except (UnidentifiedImageError, OSError) as error:
            raise InvalidImageError("Invalid or corrupted image") from error
