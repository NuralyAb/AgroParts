from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AGRO_", extra="ignore")

    # SQLite — только для локальной разработки без Docker.
    # Production: postgresql+psycopg://agro:agro@localhost:5432/agroparts
    database_url: str = "sqlite:///./agroparts.db"

    jwt_secret: str = "dev-secret-change-me"
    jwt_ttl_minutes: int = 60 * 24 * 7
    password_iterations: int = 120_000

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Сколько держится резерв по онлайн-заказу, пока магазин его не подтвердил.
    pending_order_ttl_minutes: int = 120
    # Сколько магазин держит товар после подтверждения брони.
    confirmed_hold_hours: int = 48
    # Период фоновой проверки просроченных броней.
    expire_interval_seconds: int = 60
    run_background_jobs: bool = True


settings = Settings()
