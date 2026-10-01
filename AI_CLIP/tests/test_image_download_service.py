import asyncio
from io import BytesIO

import httpx
import pytest
from PIL import Image

from app.services.image_download_service import (
    ImageDownloadService,
    ImageUrlNotAllowedError,
)
from app.services.image_service import (
    ImageService,
    ImageTooLargeError,
    UnsupportedImageFormatError,
)


def create_png() -> bytes:
    content = BytesIO()
    Image.new("RGB", (8, 8), color="blue").save(content, format="PNG")
    return content.getvalue()


def test_downloads_valid_image_from_allowed_host() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "backend"
        return httpx.Response(200, headers={"content-type": "image/png"}, content=create_png())

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ImageDownloadService(ImageService(1024, 1000), {"backend"}, 1, client)

    async def run_test() -> Image.Image:
        image = await service.fetch("http://backend/uploads/125.png")
        await service.close()
        return image

    image = asyncio.run(run_test())

    assert image.mode == "RGB"
    assert image.size == (8, 8)


def test_rejects_host_outside_allowlist() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200)))
    service = ImageDownloadService(ImageService(1024, 1000), {"backend"}, 1, client)

    async def run_test() -> None:
        with pytest.raises(ImageUrlNotAllowedError):
            await service.fetch("http://169.254.169.254/latest/meta-data")
        await service.close()

    asyncio.run(run_test())


def test_rejects_non_image_content_type() -> None:
    transport = httpx.MockTransport(
        lambda _: httpx.Response(200, headers={"content-type": "text/html"}, content=b"x")
    )
    client = httpx.AsyncClient(transport=transport)
    service = ImageDownloadService(ImageService(1024, 1000), {"backend"}, 1, client)

    async def run_test() -> None:
        with pytest.raises(UnsupportedImageFormatError):
            await service.fetch("http://backend/not-an-image")
        await service.close()

    asyncio.run(run_test())


def test_rejects_remote_image_over_size_limit() -> None:
    transport = httpx.MockTransport(
        lambda _: httpx.Response(
            200,
            headers={"content-type": "image/png"},
            content=create_png(),
        )
    )
    client = httpx.AsyncClient(transport=transport)
    service = ImageDownloadService(ImageService(4, 1000), {"backend"}, 1, client)

    async def run_test() -> None:
        with pytest.raises(ImageTooLargeError):
            await service.fetch("http://backend/too-large.png")
        await service.close()

    asyncio.run(run_test())
