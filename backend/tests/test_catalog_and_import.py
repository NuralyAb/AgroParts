from app.modules.catalog.models import Compatibility, MachineModel
from app.modules.catalog.normalize import normalize_number
from tests.conftest import auth


def test_normalize_number_handles_cyrillic_and_separators():
    assert normalize_number("4нв-4330") == normalize_number("4HB 4330") == "4HB4330"
    assert normalize_number(" 180205 ") == "180205"


def test_search_by_name_number_and_offer_article(client, world):
    by_name = client.get("/api/catalog/search", params={"q": "ремень жатки"}).json()
    by_number = client.get("/api/catalog/search", params={"q": "4нв 4330"}).json()
    assert by_name["total"] == by_number["total"] == 1
    item = by_number["items"][0]
    assert item["summary"]["min_price"] == 8500 and item["summary"]["available"] == 5


def test_compatibility_filter_uses_only_verified_records(client, db, world):
    other = MachineModel(brand_id=1, name="Acros 595", kind="combine")
    db.add(other)
    db.flush()
    db.add(Compatibility(part_id=world.part, model_id=other.id, source="слухи", verified=False))
    db.commit()
    assert client.get("/api/catalog/search", params={"model_id": world.model}).json()["total"] == 1
    assert client.get("/api/catalog/search", params={"model_id": other.id}).json()["total"] == 0
    compat = client.get(f"/api/catalog/parts/{world.part}").json()["compatibility"]
    assert [c["model_id"] for c in compat] == [world.model]


def test_garage_shows_compatible_parts(client, world):
    r = client.post("/api/garage", json={"model_id": world.model, "year": 2005}, headers=auth(world.buyer))
    vehicle = r.json()[0]
    parts = client.get(f"/api/garage/{vehicle['id']}/parts", headers=auth(world.buyer)).json()
    assert [p["id"] for p in parts["items"]] == [world.part]


CSV = (
    "Артикул;Наименование;Цена;Количество;Ячейка\n"
    "4НВ-4330;Ремень жатки Дон;8 900;7;A-1\n"  # совпадает с каталогом → matched, обновит существующий товар
    ";Ремень комбайна длинный;5000;3;\n"  # без номера → на ручную проверку
    "X-1;Что-то;;2;\n"  # нет цены → ошибка строки
)


def test_import_csv_updates_matches_and_reports_errors(client, world):
    files = {"file": ("price.csv", CSV.encode("utf-8"), "text/csv")}
    r = client.post(f"/api/shops/{world.shop}/import", files=files, data={"stock_mode": "manual"}, headers=auth(world.seller))
    rep = r.json()
    assert r.status_code == 200, r.text
    assert (rep["rows"], rep["created"], rep["updated"], rep["matched"], rep["review"]) == (3, 1, 1, 1, 1)
    assert rep["errors"] == [{"row": 4, "error": "не заполнено поле «Цена»"}]

    offers = {o["title"]: o for o in client.get(f"/api/shops/{world.shop}/offers", headers=auth(world.seller)).json()}
    belt = offers["Ремень жатки Дон"]
    assert (belt["price"], belt["on_hand"], belt["stock_mode"], belt["stocks"][0]["bin_location"]) == (8900, 7, "manual", "A-1")
    assert offers["Ремень комбайна длинный"]["match_status"] == "review"

    queue = client.get("/api/admin/offers/review", headers=auth(world.admin)).json()
    assert [q["title"] for q in queue] == ["Ремень комбайна длинный"]
    assert queue[0]["suggestions"][0]["part_id"] == world.part


def test_import_dry_run_changes_nothing(client, world):
    files = {"file": ("price.csv", CSV.encode("utf-8"), "text/csv")}
    client.post(f"/api/shops/{world.shop}/import", files=files, data={"dry_run": "true"}, headers=auth(world.seller))
    offers = client.get(f"/api/shops/{world.shop}/offers", headers=auth(world.seller)).json()
    assert len(offers) == 1 and offers[0]["on_hand"] == 5


def test_1c_sync_by_api_key(client, world):
    key = client.post(f"/api/shops/{world.shop}/api-key", headers=auth(world.seller)).json()["api_key"]
    r = client.post("/api/integrations/1c/stock", json={"items": [{"sku": "AAA-000001", "price": 9000, "qty": 11}]},
                    headers={"X-Api-Key": key})
    assert r.json()["updated"] == 1
    offer = client.get(f"/api/shops/{world.shop}/offers", headers=auth(world.seller)).json()[0]
    assert (offer["price"], offer["on_hand"], offer["stock_mode"]) == (9000, 11, "tracked")
    assert client.post("/api/integrations/1c/stock", json={"items": [{"sku": "x", "price": 1, "qty": 1}]},
                       headers={"X-Api-Key": "wrong"}).status_code == 401
