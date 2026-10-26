"""Рендерит картинки карточек запчастей из процедурных 3D-моделей (PNG с прозрачным фоном).

Нужен запущенный фронтенд (npm run dev) и Chromium-браузер (Edge или Chrome):

    python scripts/render_part_images.py [--url http://localhost:5173] [ключ ...]

Картинки сохраняются в media/parts/<ключ>.png; сид (python -m app.seed) подхватывает их автоматически.
Настоящие фото, загруженные магазинами, просто заменяют image_url и имеют приоритет.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.seed import MEDIA_PARTS, RENDERS  # noqa: E402

BROWSERS = [
    os.environ.get("AGRO_BROWSER", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
    shutil.which("microsoft-edge") or "",
]
MIN_BYTES = 15_000  # пустой прозрачный кадр весит единицы килобайт — значит, сцена не успела отрисоваться


def browser() -> str:
    for b in BROWSERS:
        if b and Path(b).exists():
            return b
    sys.exit("Не найден Edge/Chrome. Укажите путь в переменной AGRO_BROWSER.")


def shoot(exe: str, url: str, target: Path) -> bool:
    target.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
        subprocess.run(
            [
                exe, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--hide-scrollbars",
                "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=900,700",
                "--virtual-time-budget=10000", "--default-background-color=00000000", f"--screenshot={target}", url,
            ],
            capture_output=True, timeout=180, check=False,
        )
        for _ in range(80):  # лаунчер браузера может вернуться раньше, чем записан файл
            if target.exists() and target.stat().st_size > 0:
                break
            time.sleep(0.5)
        time.sleep(1)
    return target.exists() and target.stat().st_size >= MIN_BYTES


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("keys", nargs="*")
    args = ap.parse_args()
    exe = browser()
    MEDIA_PARTS.mkdir(parents=True, exist_ok=True)
    failed = []
    for key in args.keys or list(RENDERS):
        url = f"{args.url}/render?spec={urllib.parse.quote(json.dumps(RENDERS[key]))}"
        target = MEDIA_PARTS / f"{key}.png"
        ok = any(shoot(exe, url, target) for _ in range(3))
        print(f"{key}: {'ok' if ok else 'НЕ УДАЛОСЬ'} ({target.stat().st_size // 1024 if target.exists() else 0} KB)")
        if not ok:
            target.unlink(missing_ok=True)
            failed.append(key)
    if failed:
        sys.exit(f"Не отрисовались: {', '.join(failed)}")


if __name__ == "__main__":
    main()
