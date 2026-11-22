"""Idempotent seed script for AURA demo-cafe (supports memory verification or Cloud Firestore)."""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

from app.config import get_settings
from app.store.factory import get_store


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed AURA café dataset idempotently.")
    parser.add_argument("--cafe-id", default=None, help="Target cafeId (default: DEMO_CAFE_ID)")
    parser.add_argument("--reset", action="store_true", help="Reset seed data back to clean baseline")
    args = parser.parse_args()

    cfg = get_settings()
    cafe_id = args.cafe_id or cfg.demo_cafe_id
    store = get_store(cfg)
    counts = store.seed_cafe(cafe_id, reset=args.reset)
    print(f"Seeded cafe='{cafe_id}' (mode={cfg.aura_store_mode}, reset={args.reset}): {counts}")


if __name__ == "__main__":
    main()
