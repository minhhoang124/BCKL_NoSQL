from urllib.parse import urlsplit

import httpx
from PIL import Image

from app.services.image_service import (
    ImageService,
    ImageTooLargeError,
    UnsupportedImageFormatError,
)


class ImageUrlNotAllowedError(ValueError):
    pass


class ImageDownloadError(RuntimeError):
    pass


class ImageDownloadService:
    """Downloads product images only from explicitly allowed service hosts."""

    _allowed_content_types = {"image/jpeg", "image/png"}

    def __init__(
        self,
        image_service: ImageService,
        allowed_hosts: set[str],
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._image_service = image_service
        self._allowed_hosts = {
            host.strip().lower() for host in allowed_hosts if host.strip()
        }
        self._client = client or httpx.AsyncClient(
            follow_redirects=False,
            timeout=timeout_seconds,
            trust_env=False,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def fetch(self, image_url: str) -> Image.Image:
        self._validate_url(image_url)

        try:
            async with self._client.stream("GET", image_url) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";", 1)[0]
                if content_type not in self._allowed_content_types:
                    raise UnsupportedImageFormatError(
                        "Remote image must use JPEG or PNG content type"
                    )

                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > self._image_service.max_image_bytes:
                        raise ImageTooLargeError(
                            "Remote image exceeds the configured size limit"
                        )
        except (ImageTooLargeError, UnsupportedImageFormatError):
            raise
        except httpx.HTTPError as error:
            raise ImageDownloadError(f"Unable to download product image: {error}") from error

        return self._image_service.decode(bytes(content))

    def _validate_url(self, image_url: str) -> None:
        parsed = urlsplit(image_url)
        hostname = (parsed.hostname or "").lower()
        if (
            parsed.scheme not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or hostname not in self._allowed_hosts
        ):
            raise ImageUrlNotAllowedError(
                "imageUrl must use HTTP(S) and an explicitly allowed host"
            )
