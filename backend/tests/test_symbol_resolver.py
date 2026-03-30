"""Unit tests for news/event symbol resolution."""

from __future__ import annotations

from app.services.symbol_resolver import resolve_symbols


def test_resolve_symbols_ignores_title_case_english_noise() -> None:
    payload = resolve_symbols(
        "Apple shares rise after market update while investors wait for more guidance",
        default_market="us",
    )

    assert payload == []


def test_resolve_symbols_ignores_crypto_alias_substrings_inside_words() -> None:
    payload = resolve_symbols(
        "The ethics panel said solidarity matters more than hype in this update",
        default_market="us",
    )

    assert payload == []


def test_resolve_symbols_keeps_explicit_us_and_crypto_tokens() -> None:
    payload = resolve_symbols(
        "Nasdaq: NVDA rallies while $AAPL extends gains and Bitcoin joins ETH higher",
        default_market="us",
    )

    assert payload == ["BTC", "ETH", "NVDA", "AAPL"]
