"""Database engine, ORM base, and async session factories."""

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://finuser:finpass@db:5432/finterminal",
)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session for FastAPI dependencies."""
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def get_task_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a Celery-safe async session bound to a task-scoped engine.

    Celery tasks use ``asyncio.run()`` and therefore create a fresh event loop
    per invocation. Reusing the process-global asyncpg-backed engine across
    different loops can attach pooled connections to the wrong loop. A task-
    scoped engine with ``NullPool`` avoids cross-loop connection reuse.
    """

    task_engine = create_async_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        poolclass=NullPool,
    )
    task_session_local = async_sessionmaker(
        bind=task_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        async with task_session_local() as session:
            yield session
    finally:
        await task_engine.dispose()
