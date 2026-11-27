"""Run against npm run preview with uv run --with playwright scripts/verify-mandopop.py."""
import json
import os
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import expect, sync_playwright

base = os.getenv("PIANORA_URL", "http://127.0.0.1:4173")
report = {}
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel=os.getenv("PIANORA_BROWSER", "chrome"))
    page = browser.new_page()
    for artist, count in [("周杰伦", 5), ("林俊杰", 4)]:
        page.goto(base)
        page.get_by_role("tab", name=artist, exact=False).click()
        cards = page.locator(".score-card")
        expect(cards).to_have_count(count)
        if artist == "林俊杰":
            href = page.get_by_role("link", name="林俊杰《江南》", exact=False).get_attribute("href")
            assert page.request.get(urljoin(base, href)).body().startswith(b"%PDF")
        songs = cards.locator("h3").all_text_contents()
        for song in songs:
            cards.filter(has=page.get_by_role("heading", name=song, exact=True)).click()
            card = page.locator("#importedScoreCard")
            expect(card.get_by_role("heading", name=song, exact=True)).to_be_visible()
            expect(page.locator("#renderBtn")).to_be_enabled()
            report[song] = card.inner_text()
            page.go_back()
            page.get_by_role("tab", name=artist, exact=False).click()
    playback = []
    page.goto(urljoin(base, "/#editor"))
    for preset, song in [("red_dust_inn", "红尘客栈"), ("back_to_back", "背对背拥抱")]:
        page.locator("#presetSelect").select_option(preset)
        expect(page.locator("#importedScoreCard h3")).to_have_text(song)
        page.locator("#renderBtn").click()
        page.wait_for_url("**/#studio", timeout=240000)
        expect(page.locator(".mixer-field small")).to_contain_text("就绪", timeout=120000)
        page.locator("#playBtn").click()
        expect(page.locator("#playBtn")).to_have_text("暂停")
        page.locator("#stopBtn").click()
        playback.append(song)
        page.get_by_role("link", name="乐谱编辑").click()
    report["playback"] = playback
    browser.close()

output = Path(os.getenv("PIANORA_ARTIFACTS", Path(__file__).resolve().parents[1] / "artifacts"))
output.mkdir(exist_ok=True, parents=True)
(output / "mandopop.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
