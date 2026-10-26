import re

# Кириллические буквы, которые в артикулах часто набирают вместо латинских.
_LOOKALIKES = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")
_JUNK = re.compile(r"[^0-9A-ZА-ЯЁ]")


def normalize_number(value: str | None) -> str:
    """'4HB-4330', '4нв 4330' и '4HB4330' дают одно и то же: '4HB4330'."""
    if not value:
        return ""
    return _JUNK.sub("", value.upper().translate(_LOOKALIKES))
