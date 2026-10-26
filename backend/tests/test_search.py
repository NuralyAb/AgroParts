import pytest

from app.modules.catalog.models import Category
from app.modules.catalog.router import NumberIn, PartIn, create_part
from app.modules.catalog.search import fix_layout, stem


@pytest.fixture
def catalog(db, world):
    belts = Category(name="Ремни")
    bearings = Category(name="Подшипники")
    db.add_all([belts, bearings])
    db.flush()
    from app.modules.catalog.models import Part

    db.get(Part, world.part).category_id = belts.id
    parts = {
        "thresher": create_part(db, PartIn(name="Ремень привода молотилки", category_id=belts.id,
                                           numbers=[NumberIn(number="3HB-2650", kind="manufacturer")])),
        "bearing": create_part(db, PartIn(name="Подшипник 180205 (6205-2RS)", category_id=bearings.id,
                                          numbers=[NumberIn(number="180205"), NumberIn(number="6205-2RS", kind="manufacturer")])),
        "filter": create_part(db, PartIn(name="Фильтр масляный двигателя ЯМЗ-238", numbers=[NumberIn(number="238-1017010")])),
    }
    db.commit()
    return {k: p.id for k, p in parts.items()} | {"header_belt": world.part, "belts": belts.id}


def ids(client, q, **params):
    r = client.get("/api/catalog/search", params={"q": q, **params}).json()
    return [i["id"] for i in r["items"]], r


def test_helpers():
    assert stem("подшипники") == "подшипник"
    assert stem("ремня") == "ремн"
    assert fix_layout("htvtym") == "ремень"


@pytest.mark.parametrize("q", ["ремня", "ремни", "ремень", "РЕМЕНЬ", "рем"])
def test_word_forms_and_prefix(client, catalog, q):
    found, _ = ids(client, q)
    assert {catalog["header_belt"], catalog["thresher"]} <= set(found)
    assert catalog["bearing"] not in found


@pytest.mark.parametrize("q", ["подшыпник", "подшипники", "филтр масляный", "ремен жатки"])
def test_typos(client, catalog, q):
    found, _ = ids(client, q)
    assert found, q
    expected = {"подшыпник": "bearing", "подшипники": "bearing", "филтр масляный": "filter", "ремен жатки": "header_belt"}[q]
    assert found[0] == catalog[expected]


def test_wrong_keyboard_layout(client, catalog):
    found, r = ids(client, "gjlibgybr")  # «подшипник» в английской раскладке
    assert found[0] == catalog["bearing"]
    assert r["corrected_query"] == "подшипник"


@pytest.mark.parametrize("q", ["180205", "6205 2rs", "6205-2RS", "620", "4нв-4330", "3HB2650", "238-101701O"])
def test_numbers(client, catalog, q):
    found, _ = ids(client, q)
    assert found, q


def test_exact_number_ranks_first(client, catalog):
    found, r = ids(client, "6205-2RS")
    assert found[0] == catalog["bearing"]
    assert r["items"][0]["score"] == 100


def test_more_specific_phrase_ranks_higher(client, catalog):
    found, _ = ids(client, "ремень молотилки")
    assert found[0] == catalog["thresher"]


def test_facets_ignore_selected_category_and_sorting(client, catalog):
    _, r = ids(client, "", category_id=catalog["belts"])
    assert r["total"] == 2
    names = {f["name"]: f["count"] for f in r["facets"]["categories"]}
    assert names == {"Ремни": 2, "Подшипники": 1}
    _, by_price = ids(client, "ремень", sort="price_asc")
    assert by_price["items"][0]["summary"]["min_price"] == 8500  # в наличии только он


def test_suggest(client, catalog):
    r = client.get("/api/catalog/suggest", params={"q": "дон"}).json()
    assert [m["title"] for m in r["models"]] == ["Ростсельмаш Дон-1500Б"]
    r = client.get("/api/catalog/suggest", params={"q": "подш"}).json()
    assert r["parts"][0]["id"] == catalog["bearing"]
    assert r["categories"][0]["name"] == "Подшипники"


def test_index_sees_new_parts(client, db, catalog):
    assert ids(client, "гидроцилиндр")[0] == []
    create_part(db, PartIn(name="Гидроцилиндр подъёма жатки"))
    db.commit()
    assert len(ids(client, "гидроцилиндр")[0]) == 1
