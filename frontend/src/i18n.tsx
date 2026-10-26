import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "ru" | "kk";

// Казахские строки — черновой перевод, перед запуском нужна вычитка носителем языка.
const dict = {
  "nav.search": { ru: "Поиск", kk: "Іздеу" },
  "nav.3d": { ru: "3D-каталог", kk: "3D-каталог" },
  "nav.garage": { ru: "Мой гараж", kk: "Менің гаражым" },
  "nav.orders": { ru: "Заказы", kk: "Тапсырыстар" },
  "nav.favorites": { ru: "Избранное", kk: "Таңдаулылар" },
  "nav.cart": { ru: "Корзина", kk: "Себет" },
  "nav.shop": { ru: "Кабинет магазина", kk: "Дүкен кабинеті" },
  "nav.admin": { ru: "Администрирование", kk: "Әкімшілік" },
  "nav.login": { ru: "Войти", kk: "Кіру" },
  "nav.logout": { ru: "Выйти", kk: "Шығу" },
  "hero.title": {
    ru: "Запчасти для сельхозтехники во всех магазинах Костаная",
    kk: "Қостанайдың барлық дүкендеріндегі ауыл шаруашылығы техникасының бөлшектері",
  },
  "hero.subtitle": {
    ru: "Сравните цены и реальное наличие, забронируйте деталь и заберите в удобном магазине.",
    kk: "Бағалар мен нақты қалдықты салыстырыңыз, бөлшекті брондап, ыңғайлы дүкеннен алыңыз.",
  },
  "search.placeholder": { ru: "Название, артикул или OEM-номер", kk: "Атауы, артикулы немесе OEM нөмірі" },
  "search.button": { ru: "Найти", kk: "Табу" },
  "common.inStock": { ru: "В наличии", kk: "Қоймада бар" },
  "common.outOfStock": { ru: "Нет в наличии", kk: "Қоймада жоқ" },
  "common.addToCart": { ru: "В корзину", kk: "Себетке" },
  "common.price": { ru: "Цена", kk: "Бағасы" },
  "common.shops": { ru: "Магазины", kk: "Дүкендер" },
  "part.compat": { ru: "Совместимость", kk: "Сәйкестік" },
  "part.analogs": { ru: "Аналоги", kk: "Аналогтар" },
  "part.offers": { ru: "Предложения магазинов", kk: "Дүкендердің ұсыныстары" },
  "cart.checkout": { ru: "Оформить", kk: "Рәсімдеу" },
  "status.pending": { ru: "Ожидает подтверждения", kk: "Растауды күтуде" },
  "status.confirmed": { ru: "Подтверждён", kk: "Расталды" },
  "status.ready": { ru: "Готов к выдаче", kk: "Беруге дайын" },
  "status.issued": { ru: "Выдан", kk: "Берілді" },
  "status.cancelled": { ru: "Отменён", kk: "Бас тартылды" },
} satisfies Record<string, Record<Lang, string>>;

export type TKey = keyof typeof dict;

const LANG_KEY = "agroparts.lang";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "kk" ? "kk" : "ru";
  } catch {
    return "ru";
  }
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string }>({
  lang: "ru",
  setLang: () => {},
  t: (k) => dict[k].ru,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  };
  const t = (k: TKey) => dict[k][lang] ?? dict[k].ru;
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
