from __future__ import annotations

from app.config import Settings, get_settings
from app.store.base import CafeStore
from app.store.memory_store import MemoryCafeStore

_store_instance: CafeStore | None = None


def get_store(settings: Settings | None = None) -> CafeStore:
    global _store_instance
    if _store_instance is not None:
        return _store_instance
    cfg = settings or get_settings()
    if cfg.aura_store_mode.lower() == "firestore":
        from app.store.firestore_store import FirestoreCafeStore

        _store_instance = FirestoreCafeStore(project_id=cfg.google_cloud_project or None)
    else:
        mem = MemoryCafeStore()
        mem.seed_cafe(cfg.demo_cafe_id, reset=False)
        _store_instance = mem
    return _store_instance


def set_store_for_tests(store: CafeStore | None) -> None:
    global _store_instance
    _store_instance = store
