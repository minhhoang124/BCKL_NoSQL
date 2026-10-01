from fastapi.testclient import TestClient

from app.main import create_app

client = TestClient(create_app(load_runtime=False))


def test_root_describes_service() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "service": "BCKL AI Service",
        "version": "0.1.0",
        "docs": "/docs",
    }


def test_health_reports_unloaded_runtime() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "modelLoaded": False,
        "indexLoaded": False,
        "vectorCount": 0,
    }


def test_openapi_contains_health_endpoint() -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/health" in paths
    assert "/index/product" in paths
    assert "/index/products" in paths


def test_health_reads_current_faiss_vector_count() -> None:
    app = create_app(load_runtime=False)
    app.state.faiss_service = type("FakeFaissService", (), {"vector_count": 1201})()

    with TestClient(app) as test_client:
        response = test_client.get("/health")

    assert response.status_code == 200
    assert response.json()["vectorCount"] == 1201
