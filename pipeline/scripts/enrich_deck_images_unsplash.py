from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

import requests


UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos"


def build_query(card: dict[str, Any]) -> str:
  tags = " ".join(card.get("tags", [])[:2])
  return f"{card.get('hanzi', '')} {card.get('meaningVi', '')} {tags}".strip()


def pick_photo(items: list[dict[str, Any]]) -> dict[str, Any] | None:
  if not items:
    return None
  return items[0]


def enrich_deck(deck_path: Path, access_key: str, per_page: int, delay_ms: int) -> None:
  deck = json.loads(deck_path.read_text(encoding="utf-8"))
  cards: list[dict[str, Any]] = deck.get("cards", [])
  if not cards:
    print("No cards found in deck.")
    return

  session = requests.Session()
  headers = {
    "Accept-Version": "v1",
    "Authorization": f"Client-ID {access_key}",
  }

  enriched = 0
  skipped = 0
  failed = 0

  for card in cards:
    if card.get("imageUrl"):
      skipped += 1
      continue

    query = build_query(card)
    if not query:
      skipped += 1
      continue

    try:
      response = session.get(
        UNSPLASH_SEARCH_URL,
        headers=headers,
        params={
          "query": query,
          "per_page": per_page,
          "orientation": "landscape",
        },
        timeout=15,
      )
      response.raise_for_status()
      payload = response.json()
      photo = pick_photo(payload.get("results", []))
      if not photo:
        failed += 1
        continue

      regular_url = photo.get("urls", {}).get("regular")
      author = photo.get("user", {}).get("name", "Unsplash")
      html = photo.get("links", {}).get("html", "https://unsplash.com")
      if not regular_url:
        failed += 1
        continue

      card["imageUrl"] = regular_url
      card["imageAttribution"] = f"Photo by {author} on Unsplash ({html})"
      enriched += 1
    except Exception:
      failed += 1

    if delay_ms > 0:
      time.sleep(delay_ms / 1000)

  deck_path.write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")
  print(f"Done. enriched={enriched}, skipped={skipped}, failed={failed}")
  print(f"Deck updated: {deck_path}")


def main() -> None:
  parser = argparse.ArgumentParser(description="Enrich published deck cards with Unsplash images.")
  parser.add_argument(
    "--deck",
    default="web/public/content/published/deck-expanded-vocabulary-lessons-1-9.json",
    help="Path to published deck JSON.",
  )
  parser.add_argument("--per-page", type=int, default=1, help="Unsplash results per card query.")
  parser.add_argument("--delay-ms", type=int, default=200, help="Delay between API calls.")
  args = parser.parse_args()

  access_key = os.getenv("UNSPLASH_ACCESS_KEY", "").strip()
  if not access_key:
    raise SystemExit("Missing UNSPLASH_ACCESS_KEY env var.")

  deck_path = Path(args.deck)
  if not deck_path.exists():
    raise SystemExit(f"Deck file not found: {deck_path}")

  enrich_deck(deck_path, access_key, args.per_page, args.delay_ms)


if __name__ == "__main__":
  main()
