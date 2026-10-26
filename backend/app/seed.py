"""Демо-данные для разработки и показа. Все магазины, цены, остатки и номера деталей — вымышленные.

    python -m app.seed            # пересоздать dev-базу (только SQLite)
    python -m app.seed --force    # разрешить и для другой БД (осторожно: удаляет все таблицы)
"""

import math
import random
import sys
from datetime import timedelta
from pathlib import Path

from app import models  # noqa: F401
from app.core.config import settings
from app.core.db import Base, SessionLocal, engine, utcnow
from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.catalog.models import Brand, Category, Compatibility, MachineModel, Modification, PartAnalog
from app.modules.catalog.router import NumberIn, PartIn, create_part
from app.modules.crm.models import Customer
from app.modules.garage.models import Vehicle
from app.modules.integrations.matching import auto_match
from app.modules.inventory import service as inv
from app.modules.inventory.models import Offer
from app.modules.orders import service as orders
from app.modules.shops.models import Shop, ShopMember, Warehouse
from app.modules.viewer3d.models import Model3D, ModelComponent

PASSWORD = "demo1234"
MEDIA_PARTS = Path(__file__).resolve().parent.parent / "media" / "parts"

# Процедурные 3D-модели деталей (frontend/src/three/parts.tsx). Из них же рендерятся картинки карточек:
#   python scripts/render_part_images.py
RENDERS = {
    "belt_header": {"type": "vbelt", "ribs": 4, "stripe": "#f2b630"},
    "belt_header_gates": {"type": "vbelt", "ribs": 4, "stripe": "#e03a2f"},
    "belt_thresher": {"type": "vbelt", "ribs": 3, "stripe": "#f2b630"},
    "belt_reel": {"type": "vbelt", "ribs": 1, "length": 0.8, "stripe": "#f2b630"},
    "bearing_180205": {"type": "bearing", "seal": "#7a2a1f"},
    "bearing_180306": {"type": "bearing", "seal": "#1f4fa8"},
    "filter_oil": {"type": "oilfilter", "color": "#1f5ea8", "band": "#f2b630"},
    "filter_oil_mtz": {"type": "oilfilter", "color": "#c9312a", "band": "#f4f4f1"},
    "filter_fuel": {"type": "fuelfilter", "color": "#2f8f4e"},
    "filter_air": {"type": "airfilter"},
    "knife": {"type": "knife"},
    "segment": {"type": "segment"},
    "hydro_cyl": {"type": "hydrocyl", "color": "#b8322b"},
    "pump_nsh32": {"type": "gearpump"},
    "chain_feeder": {"type": "chain"},
    "seal_crank": {"type": "seal"},
    "generator": {"type": "alternator"},
}

# key, название, категория, номера [(номер, вид, производитель)], характеристики, совместимость [ключи моделей]
PARTS = [
    ("belt_header", "Ремень привода жатки", "Ремни",
     [("10.01.50.032", "oem", "Ростсельмаш"), ("4HB-4330", "manufacturer", "Harvest Belts")],
     {"Профиль": "HB", "Число ручьёв": 4, "Расчётная длина, мм": 4330}, ["don1500"]),
    ("belt_header_gates", "Ремень привода жатки 4HB-4330 (Gates)", "Ремни",
     [("4HB4330-G", "manufacturer", "Gates")],
     {"Профиль": "HB", "Число ручьёв": 4, "Расчётная длина, мм": 4330}, ["don1500"]),
    ("belt_thresher", "Ремень привода молотилки", "Ремни",
     [("10.01.50.041", "oem", "Ростсельмаш"), ("3HB-2650", "manufacturer", "Harvest Belts")],
     {"Профиль": "HB", "Число ручьёв": 3, "Расчётная длина, мм": 2650}, ["don1500"]),
    ("belt_reel", "Ремень вариатора мотовила", "Ремни",
     [("10.01.50.055", "oem", "Ростсельмаш"), ("HB-2000", "manufacturer", "Harvest Belts")],
     {"Профиль": "HB", "Расчётная длина, мм": 2000}, ["don1500", "acros595"]),
    ("bearing_180205", "Подшипник 180205 (6205-2RS)", "Подшипники",
     [("180205", "oem", "ГОСТ"), ("6205-2RS", "manufacturer", "SKF")],
     {"d, мм": 25, "D, мм": 52, "B, мм": 15, "Уплотнение": "2RS"}, ["don1500", "acros595", "mtz82"]),
    ("bearing_180306", "Подшипник 180306 (6306-2RS)", "Подшипники",
     [("180306", "oem", "ГОСТ"), ("6306-2RS", "manufacturer", "SKF")],
     {"d, мм": 30, "D, мм": 72, "B, мм": 19, "Уплотнение": "2RS"}, ["don1500", "k701"]),
    ("filter_oil", "Фильтр масляный двигателя ЯМЗ-238", "Фильтры",
     [("238-1017010", "oem", "ЯМЗ"), ("FM-238", "manufacturer", "Цитрон")],
     {"Тип": "полнопоточный", "Высота, мм": 210}, ["don1500", "k701"]),
    ("filter_fuel", "Фильтр топливный тонкой очистки", "Фильтры",
     [("201-1117040", "oem", "ЯМЗ"), ("FT-201", "manufacturer", "Цитрон")],
     {"Тонкость очистки, мкм": 10}, ["don1500", "k701"]),
    ("filter_air", "Фильтр воздушный основной элемент", "Фильтры",
     [("B4310", "manufacturer", "Big Filter"), ("10.01.80.010", "oem", "Ростсельмаш")],
     {"Наружный диаметр, мм": 310, "Высота, мм": 430}, ["don1500"]),
    ("knife", "Нож жатки в сборе 6 м", "Жатка",
     [("ЖНУ-6-01.050", "oem", "Ростсельмаш")],
     {"Длина, м": 6, "Сегментов": 80}, ["don1500"]),
    ("segment", "Сегмент ножа жатки", "Жатка",
     [("Z-56.0102", "oem", "Ростсельмаш"), ("SG-76", "manufacturer", "Schumacher")],
     {"Шаг, мм": 76.2, "Насечка": "мелкая"}, ["don1500", "acros595"]),
    ("hydro_cyl", "Гидроцилиндр подъёма жатки", "Гидравлика",
     [("ГЦ-80.40.400", "oem", "Ростсельмаш")],
     {"Диаметр поршня, мм": 80, "Ход, мм": 400}, ["don1500"]),
    ("pump_nsh32", "Насос шестерённый НШ-32", "Гидравлика",
     [("НШ-32А-3", "oem", "Гидросила"), ("NSH32-3L", "manufacturer", "Hydrosila")],
     {"Рабочий объём, см³": 32, "Вращение": "левое"}, ["don1500", "k701", "mtz82"]),
    ("chain_feeder", "Цепь транспортёра наклонной камеры", "Ходовая часть",
     [("ПР-38,1-127", "oem", "ГОСТ 13568")],
     {"Шаг, мм": 38.1, "Разрушающая нагрузка, кН": 127}, ["don1500"]),
    ("seal_crank", "Манжета коленвала задняя", "Двигатель",
     [("240-1005034", "oem", "ЯМЗ")],
     {"Размер, мм": "130x160x15"}, ["don1500", "k701"]),
    ("generator", "Генератор 28 В 1 кВт", "Электрика",
     [("4001.3771-48", "oem", "Прамо")],
     {"Напряжение, В": 28, "Ток, А": 35}, ["don1500", "k701"]),
    ("filter_oil_mtz", "Фильтр масляный Д-243 (МТЗ)", "Фильтры",
     [("240-1404010", "oem", "ММЗ")],
     {"Высота, мм": 140}, ["mtz82"]),
]

SHOPS = [
    ("АгроДеталь Костанай (демо)", "AGRO", "демо-адрес: ул. Промышленная, 1", True),
    ("Степь-Запчасть (демо)", "STEP", "демо-адрес: пр. Абая, 10", False),
    ("КомбайнСервис (демо)", "KOMB", "демо-адрес: ул. Складская, 5", True),
    ("Нива-Агро (демо)", "NIVA", "демо-адрес: ул. Рабочая, 22", False),
    ("ТракторЛенд (демо)", "TRAK", "демо-адрес: Северный промузел, 3", False),
]


def _component(key, name, assembly, part, shape, size, position, color, *, rotation=(0, 0, 0), explode=(0, 0, 0), shell=False, material="paint"):
    return dict(
        key=key, name=name, assembly=assembly, part=part, is_shell=shell, explode=list(explode),
        geometry={"shape": shape, "size": list(size), "position": list(position), "rotation": list(rotation), "color": color,
                  "material": material},
    )


HALF_PI = math.pi / 2
RED, DARK, METAL, RUBBER = "#c9312a", "#2a2f2c", "#a7afab", "#181818"
# Геометрия совпадает с процедурной моделью комбайна на фронтенде (frontend/src/three/models.tsx).
DON_COMPONENTS = [
    # корпус — можно скрыть, чтобы увидеть узлы внутри
    _component("body", "Корпус молотилки", "body", None, "box", (4.4, 2.3, 2.5), (-0.8, 2.15, 0), RED, shell=True, explode=(0, 0, 0)),
    _component("tank", "Бункер", "body", None, "box", (2.5, 1.0, 2.6), (-1.1, 3.8, 0), RED, shell=True, explode=(0, 1.6, 0)),
    _component("cab_base", "Площадка кабины", "body", None, "box", (1.7, 0.35, 1.9), (1.25, 3.45, 0), RED, shell=True, explode=(0.8, 1.2, 0)),
    _component("cab", "Кабина", "body", None, "box", (1.45, 1.25, 1.6), (1.25, 4.25, 0), "#9cc6dc", shell=True, explode=(0.8, 1.8, 0), material="glass"),
    _component("auger", "Выгрузной шнек", "body", None, "cylinder", (0.14, 4.3), (-1.7, 4.45, 1.45), RED, rotation=(0, 0, HALF_PI), explode=(0, 1.4, 1.6)),
    _component("chopper", "Измельчитель соломы", "body", None, "box", (0.8, 0.9, 2.2), (-3.35, 1.35, 0), DARK, explode=(-1.2, 0, 0), material="dark"),
    # двигатель
    _component("engine", "Двигатель ЯМЗ-238", "engine", None, "box", (1.3, 0.85, 2.1), (-2.55, 3.7, 0), DARK, explode=(-1.4, 1.0, 0), material="dark"),
    _component("filter_oil", "Фильтр масляный", "engine", "filter_oil", "cylinder", (0.16, 0.4), (-2.15, 3.55, 1.17), "#f2b630", explode=(-1.2, 1.0, 1.4), material="metal"),
    _component("filter_fuel", "Фильтр топливный", "engine", "filter_fuel", "cylinder", (0.12, 0.36), (-2.15, 3.55, -1.17), "#f6c84a", explode=(-1.2, 1.0, -1.4), material="metal"),
    _component("filter_air", "Воздушный фильтр", "engine", "filter_air", "cylinder", (0.3, 0.7), (-2.9, 4.48, 0.5), "#7f8c86", explode=(-1.6, 2.0, 0.6), material="metal"),
    _component("generator", "Генератор", "engine", "generator", "cylinder", (0.18, 0.34), (-3.05, 3.45, 0.85), "#a7afab", rotation=(0, 0, HALF_PI), explode=(-2.0, 0.8, 1.2), material="metal"),
    _component("seal_crank", "Манжета коленвала", "engine", "seal_crank", "torus", (0.22, 0.05), (-3.22, 3.7, 0), RUBBER, rotation=(0, HALF_PI, 0), explode=(-2.4, 1.0, 0), material="rubber"),
    # гидравлика
    _component("pump", "Насос НШ-32", "hydraulics", "pump_nsh32", "cylinder", (0.14, 0.42), (-1.9, 1.5, -1.32), "#2a5da8", rotation=(0, 0, HALF_PI), explode=(-0.6, -0.4, -1.4), material="metal"),
    _component("lift_cyl_l", "Гидроцилиндр подъёма жатки (лев.)", "hydraulics", "hydro_cyl", "cylinder", (0.09, 1.4), (2.15, 1.15, 0.92), "#3b7bd1", rotation=(0, 0, -0.95), explode=(0.6, -0.2, 1.1), material="metal"),
    _component("lift_cyl_r", "Гидроцилиндр подъёма жатки (прав.)", "hydraulics", "hydro_cyl", "cylinder", (0.09, 1.4), (2.15, 1.15, -0.92), "#3b7bd1", rotation=(0, 0, -0.95), explode=(0.6, -0.2, -1.1), material="metal"),
    # приводы на левом борту
    _component("belt_thresher", "Ремень привода молотилки", "transmission", "belt_thresher", "torus", (0.55, 0.05), (-0.4, 2.4, 1.31), RUBBER, explode=(0, 0.3, 1.5), material="rubber"),
    _component("bearing_beater", "Подшипник вала битера", "transmission", "bearing_180205", "torus", (0.15, 0.07), (-0.4, 2.4, 1.36), METAL, explode=(0, 0.3, 2.2), material="metal"),
    _component("belt_header", "Ремень привода жатки", "header", "belt_header", "torus", (0.34, 0.045), (1.9, 1.72, 0.82), RUBBER, explode=(0.4, 0.3, 1.7), material="rubber"),
    _component("bearing_pulley", "Подшипник шкива привода жатки", "header", "bearing_180306", "torus", (0.11, 0.06), (1.9, 1.72, 0.86), METAL, explode=(0.4, 0.3, 2.4), material="metal"),
    _component("belt_reel", "Ремень вариатора мотовила", "header", "belt_reel", "torus", (0.3, 0.04), (4.1, 1.62, 3.32), RUBBER, explode=(0.3, 0.4, 0.9), material="rubber"),
    # наклонная камера и жатка
    _component("feeder", "Наклонная камера", "header", None, "box", (2.0, 0.85, 1.5), (2.25, 1.5, 0), RED, rotation=(0, 0, -0.42), explode=(0.9, 0, 0)),
    _component("feeder_chain", "Цепь транспортёра наклонной камеры", "header", "chain_feeder", "box", (1.9, 0.07, 1.2), (2.12, 1.89, 0), DARK, rotation=(0, 0, -0.42), explode=(0.9, 1.1, 0), material="dark"),
    _component("header", "Жатка ЖЗК-6", "header", None, "box", (1.25, 0.5, 6.6), (3.55, 0.62, 0), RED, explode=(2.0, 0, 0)),
    _component("header_wall", "Задняя стенка жатки", "header", None, "box", (0.14, 1.05, 6.6), (2.95, 1.0, 0), RED, explode=(1.8, 0, 0)),
    _component("header_auger", "Шнек жатки", "header", None, "cylinder", (0.27, 6.3), (3.47, 0.84, 0), METAL, rotation=(HALF_PI, 0, 0), explode=(2.2, 0.6, 0), material="metal"),
    _component("reel", "Мотовило", "header", None, "reel", (0.62, 6.2), (4.1, 1.62, 0), RED, explode=(2.6, 1.4, 0)),
    _component("knife", "Нож жатки", "header", "knife", "box", (0.34, 0.06, 6.6), (4.21, 0.38, 0), METAL, explode=(3.2, -0.2, 0), material="metal"),
    _component("segment", "Сегмент ножа", "header", "segment", "box", (0.14, 0.05, 0.1), (4.38, 0.42, 2.0), "#e9ecea", explode=(3.6, -0.2, 2.6), material="metal"),
    # ходовая часть
    _component("wheel_fl", "Ведущее колесо (лев.)", "chassis", None, "wheel", (0.92, 0.66), (0.9, 0.92, 1.62), RUBBER, explode=(0, -0.2, 1.4), material="rubber"),
    _component("wheel_fr", "Ведущее колесо (прав.)", "chassis", None, "wheel", (0.92, 0.66), (0.9, 0.92, -1.62), RUBBER, explode=(0, -0.2, -1.4), material="rubber"),
    _component("wheel_rl", "Управляемое колесо (лев.)", "chassis", None, "wheel", (0.55, 0.4), (-2.6, 0.55, 1.25), RUBBER, explode=(0, -0.2, 1.2), material="rubber"),
    _component("wheel_rr", "Управляемое колесо (прав.)", "chassis", None, "wheel", (0.55, 0.4), (-2.6, 0.55, -1.25), RUBBER, explode=(0, -0.2, -1.2), material="rubber"),
]



def run() -> None:
    if not settings.database_url.startswith("sqlite") and "--force" not in sys.argv:
        raise SystemExit("Сид удаляет все таблицы. Для не-SQLite базы запустите с --force.")
    random.seed(42)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    pw = hash_password(PASSWORD)

    def user(phone, name, role="buyer"):
        u = User(phone=phone, name=name, role=role, password_hash=pw)
        db.add(u)
        db.flush()
        return u

    admin = user("+77000000001", "Администратор", "admin")
    content = user("+77000000002", "Контент-менеджер", "content_manager")
    farmer = user("+77000000100", "Ержан (фермер, демо)")

    # техника
    def brand(name):
        b = Brand(name=name)
        db.add(b)
        db.flush()
        return b

    rsm, ptz, mtz = brand("Ростсельмаш"), brand("Кировец"), brand("МТЗ")
    machines = {
        "don1500": MachineModel(brand_id=rsm.id, name="Дон-1500Б", kind="combine"),
        "acros595": MachineModel(brand_id=rsm.id, name="Acros 595 Plus", kind="combine"),
        "k701": MachineModel(brand_id=ptz.id, name="К-701", kind="tractor"),
        "mtz82": MachineModel(brand_id=mtz.id, name="Беларус-82.1", kind="tractor"),
    }
    db.add_all(machines.values())
    db.flush()
    don_mod = Modification(model_id=machines["don1500"].id, name="с двигателем ЯМЗ-238АК", year_from=1996, year_to=2008)
    db.add_all([
        don_mod,
        Modification(model_id=machines["don1500"].id, name="с двигателем ЯМЗ-7511", year_from=2008, year_to=2012),
        Modification(model_id=machines["mtz82"].id, name="Д-243", year_from=2000, year_to=None),
    ])

    categories = {}
    for name in ["Ремни", "Подшипники", "Фильтры", "Жатка", "Гидравлика", "Ходовая часть", "Двигатель", "Электрика"]:
        c = Category(name=name)
        db.add(c)
        db.flush()
        categories[name] = c.id

    parts = {}
    for key, name, cat, numbers, specs, compat in PARTS:
        p = create_part(db, PartIn(
            name=name, category_id=categories[cat], specs=specs,
            description="Демо-карточка. Номера и характеристики приведены для демонстрации, не для заказа.",
            numbers=[NumberIn(number=n, kind=k, manufacturer=m) for n, k, m in numbers],
        ))
        p.render = RENDERS.get(key)
        if (MEDIA_PARTS / f"{key}.png").exists():
            p.image_url = f"/api/media/parts/{key}.png"
        parts[key] = p
        for mk in compat:
            db.add(Compatibility(part_id=p.id, model_id=machines[mk].id, source="Демо: каталог деталей производителя",
                                 verified=True, created_by=content.id, verified_by=admin.id))
    # непроверенная совместимость — для очереди модерации
    db.add(Compatibility(part_id=parts["belt_header"].id, model_id=machines["acros595"].id,
                         source="Сообщение продавца, не подтверждено каталогом", verified=False, created_by=content.id))
    db.add(PartAnalog(part_id=parts["belt_header"].id, analog_id=parts["belt_header_gates"].id,
                      source="Демо: таблица взаимозаменяемости Gates", verified=True, created_by=content.id))
    db.add(PartAnalog(part_id=parts["filter_oil"].id, analog_id=parts["filter_oil_mtz"].id,
                      source="Похожий внешний вид (не подтверждено)", verified=False, created_by=content.id))
    db.flush()

    # магазины
    shops = []
    for i, (name, code, address, manual) in enumerate(SHOPS, start=1):
        s = Shop(name=name, code=code, address=address, phone=f"+7 7142 00-00-0{i}", status="verified",
                 city="Костанай", delivery_available=i % 2 == 1,
                 description="Вымышленный магазин для демонстрации платформы.")
        db.add(s)
        db.flush()
        db.add(Warehouse(shop_id=s.id, name="Основной склад", address=address))
        if i == 1:
            db.add(Warehouse(shop_id=s.id, name="Точка на рынке", address="демо-адрес: Центральный рынок, пав. 7"))
        seller = user(f"+7700000001{i}", f"Продавец «{name.split(' (')[0]}»")
        db.add(ShopMember(shop_id=s.id, user_id=seller.id, role="owner"))
        db.flush()
        db.refresh(s)
        shops.append((s, seller, manual))
    pending = Shop(name="Новый магазин (ждёт проверки)", code="NEW1", status="pending", address="демо-адрес")
    db.add(pending)
    db.flush()
    db.add(Warehouse(shop_id=pending.id, name="Основной склад"))

    base_price = {
        "belt_header": 8500, "belt_header_gates": 7900, "belt_thresher": 6200, "belt_reel": 4100,
        "bearing_180205": 1400, "bearing_180306": 2600, "filter_oil": 3200, "filter_fuel": 2100,
        "filter_air": 9800, "knife": 98000, "segment": 650, "hydro_cyl": 54000, "pump_nsh32": 46000,
        "chain_feeder": 28500, "seal_crank": 3900, "generator": 61000, "filter_oil_mtz": 2400,
    }
    offer_by = {}
    for s, seller, manual in shops:
        keys = random.sample(list(parts), k=random.randint(10, 14))
        if s.code in ("AGRO", "STEP", "KOMB"):
            keys = list(dict.fromkeys(["belt_header", "bearing_180205", *keys]))
        for key in keys:
            p = parts[key]
            article = next(n.number for n in p.numbers)
            o = Offer(shop_id=s.id, sku=inv.next_sku(db, s), title=p.name, article=article,
                      price=int(round(base_price[key] * random.uniform(0.9, 1.15), -1)),
                      stock_mode="manual" if manual else "tracked")
            db.add(o)
            auto_match(db, o)
            db.flush()
            stock = inv.get_or_create_stock(db, o, s.warehouses[0].id)
            stock.bin_location = f"{random.choice('ABC')}-{random.randint(1, 9):02d}-{random.randint(1, 4)}"
            qty = random.choice([0, 1, 2, 3, 5, 8, 12, 20])
            if key in ("belt_header", "bearing_180205") and s.code in ("AGRO", "STEP", "KOMB"):
                qty = max(qty, 5)  # нужны для демо-заказов и примера с подшипником
            if qty:
                inv.receive(db, stock, qty, user_id=seller.id, note="Начальный остаток")
            offer_by[(s.code, key)] = o
    # нестандартные названия — для очереди сопоставления
    s1 = shops[0][0]
    for title, article in [("Ремень комбайна длинный", None), ("Фильтр масл. ЯМЗ", "ФМ-238"), ("Подшипн. 6205 2rs", "6205 2RS")]:
        o = Offer(shop_id=s1.id, sku=inv.next_sku(db, s1), title=title, article=article, price=5000, stock_mode="manual")
        db.add(o)
        auto_match(db, o)
        db.flush()
        inv.receive(db, inv.get_or_create_stock(db, o, s1.warehouses[0].id), 4, user_id=None, note="Начальный остаток")
    db.commit()

    # гараж фермера и примеры заказов по всем каналам
    db.add(Vehicle(user_id=farmer.id, model_id=machines["don1500"].id, modification_id=don_mod.id, year=2005,
                   title="Дон на 2-м отделении"))
    db.commit()
    agro, agro_seller, _ = shops[0]
    orders.checkout(db, farmer, [(offer_by[("AGRO", "belt_header")].id, 1)], "on_pickup", "Заберу завтра утром")
    db.add(Customer(shop_id=agro.id, name="ТОО «Демо-Агро»", phone="+77000000200", farm="ТОО «Демо-Агро»"))
    db.commit()
    orders.pos_sale(db, agro_seller, agro, [(offer_by[("AGRO", "bearing_180205")].id, 1)], None, "")
    issued = orders.checkout(db, farmer, [(offer_by[("STEP", "bearing_180205")].id, 1)], "on_pickup")[0]
    seller_step = shops[1][1]
    orders.transition(db, issued, "confirmed", user_id=seller_step.id)
    orders.transition(db, issued, "ready", user_id=seller_step.id)
    orders.transition(db, issued, "issued", user_id=seller_step.id)
    issued.created_at = utcnow() - timedelta(days=12)
    db.commit()

    # 3D-модель
    m3d = Model3D(machine_model_id=machines["don1500"].id, title="Ростсельмаш Дон-1500Б")
    db.add(m3d)
    db.flush()
    for c in DON_COMPONENTS:
        db.add(ModelComponent(model3d_id=m3d.id, key=c["key"], name=c["name"], assembly=c["assembly"],
                              part_id=parts[c["part"]].id if c["part"] else None, geometry=c["geometry"],
                              explode=c["explode"], is_shell=c["is_shell"]))
    db.commit()
    db.close()

    print("Демо-база создана. Пароль всех пользователей:", PASSWORD)
    print("  администратор     +7 700 000 00 01")
    print("  контент-менеджер  +7 700 000 00 02")
    print("  фермер            +7 700 000 01 00")
    print("  продавцы          +7 700 000 00 11 … 15 (магазины 1–5)")


if __name__ == "__main__":
    run()
