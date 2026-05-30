from __future__ import annotations

import csv
import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).parent
SRC_DIR = ROOT / "src"
WORDLIST_DIR = ROOT / "word-list"
DIST_DIR = ROOT / "dist"
DATA_DIR = DIST_DIR / "data"


def main() -> None:
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)

    shutil.copytree(SRC_DIR, DIST_DIR)
    DATA_DIR.mkdir(exist_ok=True)

    build_word_payload()

    print(f"Built static site at: {DIST_DIR}")


def build_word_payload() -> None:
    words: list[dict[str, object]] = []
    levels: list[dict[str, str]] = []

    for csv_path in sorted(WORDLIST_DIR.glob("*.csv")):
        level_key = csv_path.stem.lower()
        level_label = level_key.upper()
        levels.append({"key": level_key, "label": level_label})

        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                expression = (row.get("expression") or "").strip()
                reading = (row.get("reading") or "").strip()
                meaning = (row.get("meaning") or "").strip()
                tags = split_tags(row.get("tags") or "")

                if not expression:
                    continue

                words.append(
                    {
                        "id": f"{level_key}:{len(words)}",
                        "level": level_key,
                        "levelLabel": level_label,
                        "expression": expression,
                        "reading": reading,
                        "meaning": meaning,
                        "tags": tags,
                    }
                )

    payload = {
        "generatedAt": datetime.now().isoformat(),
        "levels": levels,
        "words": words,
    }

    output_path = DATA_DIR / "words.json"
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def split_tags(raw_tags: str) -> list[str]:
    return [tag for tag in raw_tags.split() if tag]


if __name__ == "__main__":
    main()
