"""Read-only adapters. Timing, freshness and single-flight belong to the collector."""

import base64
import math

import numpy as np

# Local PNG, decoded through the same validator as search uploads; never downloaded.
PROBE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOor68HAAL+AX66JXAlAAAAAElFTkSuQmCC"
)


def clip_probe(service, kind, image_service):
    loaded = service is not None and service.model_loaded(kind)
    result = {"loaded": loaded, "dimension": None}
    if not loaded:
        return {**result, "errorCode": "MODEL_NOT_LOADED"}
    try:
        image = image_service.decode(PROBE_PNG) if kind == "image" else None
        try:
            vector = service.probe_embedding(kind, image)
        finally:
            if image is not None:
                image.close()
    except BlockingIOError:
        raise
    except Exception:
        return {**result, "errorCode": "ENCODE_FAILED"}
    try:
        vector = np.asarray(vector)
        valid = (
            vector.ndim == 2
            and vector.shape[0] == 1
            and vector.shape[1] > 0
            and np.issubdtype(vector.dtype, np.floating)
            and np.isfinite(vector).all()
            and math.isfinite(float(np.linalg.norm(vector)))
            and float(np.linalg.norm(vector)) > 0
        )
    except (ValueError, TypeError):
        valid = False
    if not valid:
        return {**result, "errorCode": "INVALID_EMBEDDING"}
    return {**result, "dimension": int(vector.shape[1])}


def faiss_probe(service):
    result = {
        "loaded": service is not None and service.is_loaded,
        "dimension": None,
        "vectorCount": None,
    }
    if not result["loaded"]:
        return {**result, "errorCode": "INDEX_NOT_LOADED"}
    try:
        observation = service.probe_search()
    except BlockingIOError:
        raise
    except Exception:
        return {**result, "errorCode": "INDEX_SEARCH_FAILED"}
    try:
        dimension, count, scores, ids = observation
        result.update(dimension=dimension, vectorCount=count)
        if type(dimension) is not int or dimension < 1 or type(count) is not int or count < 0:
            raise ValueError()
        if np.shape(scores) != (1,) or np.shape(ids) != (1,):
            raise ValueError()
        score, identity = scores[0], ids[0]
        if not np.issubdtype(np.asarray(identity).dtype, np.integer):
            raise ValueError()
        if count == 0:
            # IndexFlatIP actually pads with -FLT_MAX; some backends use -inf.
            if identity != -1 or float(score) not in (-math.inf, -float(np.finfo("float32").max)):
                raise ValueError()
            return {**result, "warningCodes": ["EMPTY_INDEX"]}
        if identity <= 0 or not math.isfinite(float(score)):
            raise ValueError()
    except (ValueError, TypeError, IndexError):
        # Do not publish malformed metadata as if it were a measurement.
        return {
            "loaded": True,
            "dimension": None,
            "vectorCount": None,
            "errorCode": "INVALID_INDEX_RESULT",
        }
    return result
