"""Unit tests for realtime quote provider orchestration."""

from __future__ import annotations

from types import SimpleNamespace
import sys

from app.services.quote_provider_controller import QuoteProviderController


def _settings(**overrides):
    defaults = {
        "quote_provider_timeout_sec": 5,
        "quote_provider_user_agent": "finance-platform-test/0.1",
        "crypto_quote_provider_order": "binance,kraken,coinbase,coingecko",
        "stock_quote_provider_order": "finnhub,twelvedata,tencent,yfinance,alphavantage",
        "crypto_binance_base_url": "https://api.binance.com",
        "crypto_kraken_base_url": "https://api.kraken.com",
        "crypto_coinbase_base_url": "https://api.exchange.coinbase.com",
        "crypto_coingecko_base_url": "https://api.coingecko.com",
        "binance_base_url": "https://api.binance.com",
        "kraken_base_url": "https://api.kraken.com",
        "coinbase_base_url": "https://api.exchange.coinbase.com",
        "coingecko_base_url": "https://api.coingecko.com",
        "finnhub_api_key": "",
        "finnhub_base_url": "https://finnhub.io",
        "twelvedata_api_key": "",
        "twelvedata_base_url": "https://api.twelvedata.com",
        "tencent_quote_base_url": "https://qt.gtimg.cn/q=",
        "alphavantage_api_key": "",
        "alphavantage_base_url": "https://www.alphavantage.co",
        "alphavantage_entitlement": "",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_fetch_crypto_quote_falls_back_in_provider_order(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())
    calls: list[str] = []

    monkeypatch.setattr(
        controller,
        "_fetch_binance_crypto_quote",
        lambda symbol: calls.append("binance") or {},
    )
    monkeypatch.setattr(
        controller,
        "_fetch_kraken_crypto_quote",
        lambda symbol: calls.append("kraken") or {
            "symbol": symbol,
            "price": 68000.0,
            "change_pct_24h": 2.0,
            "provider": "kraken",
            "fetch_source": "kraken",
            "source": "live",
            "stale": False,
            "as_of": "2026-03-25T12:00:00+00:00",
        },
    )
    monkeypatch.setattr(
        controller,
        "_fetch_coinbase_crypto_quote",
        lambda symbol: calls.append("coinbase") or {
            "symbol": symbol,
            "price": 67000.0,
        },
    )

    payload = controller.fetch_crypto_quote("BTC")

    assert payload["provider"] == "kraken"
    assert calls == ["binance", "kraken"]


def test_fetch_stock_quote_uses_twelvedata_before_tencent(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())
    calls: list[str] = []

    monkeypatch.setattr(
        controller,
        "_fetch_finnhub_stock_quote",
        lambda symbol: calls.append("finnhub") or {},
    )
    monkeypatch.setattr(
        controller,
        "_fetch_twelvedata_stock_quote",
        lambda symbol: calls.append("twelvedata") or {
            "symbol": symbol,
            "price": 201.5,
            "change_pct_24h": 1.1,
            "provider": "twelvedata",
            "fetch_source": "twelvedata",
            "source": "live",
            "stale": False,
            "as_of": "2026-03-25T12:00:00+00:00",
        },
    )
    monkeypatch.setattr(
        controller,
        "_fetch_tencent_stock_quote",
        lambda symbol: calls.append("tencent") or {
            "symbol": symbol,
            "price": 200.0,
        },
    )
    monkeypatch.setattr(
        controller,
        "_fetch_alpha_vantage_stock_quote",
        lambda symbol: calls.append("alphavantage") or {
            "symbol": symbol,
            "price": 198.0,
        },
    )

    payload = controller.fetch_stock_quote("AAPL")

    assert payload["provider"] == "twelvedata"
    assert calls == ["finnhub", "twelvedata"]


def test_fetch_stock_quote_falls_back_to_yfinance_before_alphavantage(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())
    calls: list[str] = []

    monkeypatch.setattr(
        controller,
        "_fetch_finnhub_stock_quote",
        lambda symbol: calls.append("finnhub") or {},
    )
    monkeypatch.setattr(
        controller,
        "_fetch_twelvedata_stock_quote",
        lambda symbol: calls.append("twelvedata") or {},
    )
    monkeypatch.setattr(
        controller,
        "_fetch_tencent_stock_quote",
        lambda symbol: calls.append("tencent") or {},
    )
    monkeypatch.setattr(
        controller,
        "_fetch_yfinance_stock_quote",
        lambda symbol: calls.append("yfinance") or {
            "symbol": symbol,
            "price": 199.25,
            "change_pct_24h": 0.8,
            "provider": "yfinance",
            "fetch_source": "yfinance",
            "source": "live",
            "stale": False,
            "as_of": "2026-03-25T12:00:00+00:00",
        },
    )
    monkeypatch.setattr(
        controller,
        "_fetch_alpha_vantage_stock_quote",
        lambda symbol: calls.append("alphavantage") or {
            "symbol": symbol,
            "price": 198.0,
        },
    )

    payload = controller.fetch_stock_quote("AAPL")

    assert payload["provider"] == "yfinance"
    assert calls == ["finnhub", "twelvedata", "tencent", "yfinance"]


def test_fetch_stock_quote_uses_finnhub_first_when_configured(monkeypatch) -> None:
    controller = QuoteProviderController(_settings(finnhub_api_key="demo"))
    calls: list[str] = []

    monkeypatch.setattr(
        controller,
        "_fetch_finnhub_stock_quote",
        lambda symbol: calls.append("finnhub") or {
            "symbol": symbol,
            "price": 203.4,
            "change_pct_24h": 0.7,
            "provider": "finnhub",
            "fetch_source": "finnhub",
            "source": "live",
            "stale": False,
            "as_of": "2026-03-25T12:00:00+00:00",
        },
    )
    monkeypatch.setattr(
        controller,
        "_fetch_twelvedata_stock_quote",
        lambda symbol: calls.append("twelvedata") or {},
    )

    payload = controller.fetch_stock_quote("AAPL")

    assert payload["provider"] == "finnhub"
    assert calls == ["finnhub"]


def test_fetch_stock_quote_falls_back_to_tencent_before_delayed_sources(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())
    calls: list[str] = []

    monkeypatch.setattr(controller, "_fetch_finnhub_stock_quote", lambda symbol: calls.append("finnhub") or {})
    monkeypatch.setattr(controller, "_fetch_twelvedata_stock_quote", lambda symbol: calls.append("twelvedata") or {})
    monkeypatch.setattr(
        controller,
        "_fetch_tencent_stock_quote",
        lambda symbol: calls.append("tencent") or {
            "symbol": symbol,
            "price": 248.8,
            "change_pct_24h": -1.62,
            "provider": "tencent",
            "fetch_source": "tencent",
            "source": "live",
            "stale": False,
            "as_of": "2026-03-27T16:00:03+00:00",
        },
    )
    monkeypatch.setattr(controller, "_fetch_yfinance_stock_quote", lambda symbol: calls.append("yfinance") or {})

    payload = controller.fetch_stock_quote("AAPL")

    assert payload["provider"] == "tencent"
    assert payload["source"] == "live"
    assert payload["stale"] is False
    assert calls == ["finnhub", "twelvedata", "tencent"]


def test_fetch_twelvedata_stock_quote_parses_payload(monkeypatch) -> None:
    controller = QuoteProviderController(
        _settings(
            twelvedata_api_key="demo",
            twelvedata_base_url="https://api.twelvedata.com",
        )
    )
    monkeypatch.setattr(
        controller,
        "_request_json",
        lambda url, params=None, headers=None: {
            "symbol": "AAPL",
            "close": "201.50",
            "percent_change": "1.10",
            "datetime": "2026-03-25 15:59:00",
        },
    )

    payload = controller._fetch_twelvedata_stock_quote("AAPL")

    assert payload["price"] == 201.5
    assert payload["change_pct_24h"] == 1.1
    assert payload["provider"] == "twelvedata"
    assert payload["source"] == "live"
    assert payload["stale"] is False
    assert payload["as_of"] == "2026-03-25T15:59:00+00:00"


def test_fetch_finnhub_stock_quote_parses_payload(monkeypatch) -> None:
    controller = QuoteProviderController(
        _settings(
            finnhub_api_key="demo",
            finnhub_base_url="https://finnhub.io",
        )
    )
    seen: dict[str, object] = {}

    def _mock_request_json(url, params=None, headers=None):
        seen["url"] = url
        seen["params"] = params
        return {
            "c": 203.4,
            "pc": 201.0,
            "dp": 1.19,
            "t": 1774459200,
        }

    monkeypatch.setattr(
        controller,
        "_request_json",
        _mock_request_json,
    )

    payload = controller._fetch_finnhub_stock_quote("AAPL")

    assert seen["url"] == "https://finnhub.io/api/v1/quote"
    assert seen["params"] == {"symbol": "AAPL", "token": "demo"}
    assert payload["price"] == 203.4
    assert payload["change_pct_24h"] == 1.19
    assert payload["provider"] == "finnhub"
    assert payload["source"] == "live"
    assert payload["stale"] is False
    assert payload["as_of"] == "2026-03-25T17:20:00+00:00"


def test_fetch_tencent_stock_quote_parses_us_payload(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())

    class _FakeResponse:
        text = 'v_usAAPL="200~苹果~AAPL.OQ~248.80~252.89~253.90~47899998~0~0~247.21~100~0~0~0~0~0~0~0~0~247.28~100~0~0~0~0~0~0~0~0~~2026-03-27 16:00:03~-4.09~-1.62~255.49~248.07~USD";'

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr("app.services.quote_provider_controller.requests.get", lambda *args, **kwargs: _FakeResponse())

    payload = controller._fetch_tencent_stock_quote("AAPL")

    assert payload["price"] == 248.8
    assert payload["change_pct_24h"] == -1.62
    assert payload["provider"] == "tencent"
    assert payload["source"] == "live"
    assert payload["stale"] is False
    assert payload["as_of"] == "2026-03-27T20:00:03+00:00"


def test_fetch_tencent_stock_quote_parses_cn_payload(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())

    class _FakeResponse:
        text = 'v_sh600519="1~贵州茅台~600519~1420.00~1416.02~1407.00~28685~15699~12985~1420.00~15~1419.99~3~1419.98~54~1419.97~11~1419.94~1~1420.01~8~1422.91~1~1422.95~1~1423.00~7~1423.20~1~~20260330161418~3.98~0.28~1431.00~1402.52~CNY";'

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr("app.services.quote_provider_controller.requests.get", lambda *args, **kwargs: _FakeResponse())

    payload = controller._fetch_tencent_stock_quote("600519.SH")

    assert payload["price"] == 1420.0
    assert payload["change_pct_24h"] == 0.28
    assert payload["provider"] == "tencent"
    assert payload["source"] == "live"
    assert payload["stale"] is False
    assert payload["as_of"] == "2026-03-30T08:14:18+00:00"


def test_fetch_alpha_vantage_stock_quote_defaults_to_eod_without_entitlement(monkeypatch) -> None:
    controller = QuoteProviderController(
        _settings(
            alphavantage_api_key="demo",
            alphavantage_base_url="https://www.alphavantage.co/query",
            alphavantage_entitlement="",
        )
    )
    monkeypatch.setattr(
        controller,
        "_request_json",
        lambda url, params=None, headers=None: {
            "Global Quote": {
                "05. price": "198.25",
                "10. change percent": "-0.25%",
                "07. latest trading day": "2026-03-25",
            }
        },
    )

    payload = controller._fetch_alpha_vantage_stock_quote("AAPL")

    assert payload["price"] == 198.25
    assert payload["change_pct_24h"] == -0.25
    assert payload["provider"] == "alphavantage"
    assert payload["fetch_source"] == "alphavantage_eod"
    assert payload["source"] == "eod"
    assert payload["stale"] is True


def test_fetch_alpha_vantage_stock_quote_normalizes_root_base_url(monkeypatch) -> None:
    controller = QuoteProviderController(
        _settings(
            alphavantage_api_key="demo",
            alphavantage_base_url="https://www.alphavantage.co",
            alphavantage_entitlement="",
        )
    )
    seen: dict[str, str] = {}

    def _mock_request_json(url, params=None, headers=None):
        seen["url"] = url
        return {
            "Global Quote": {
                "05. price": "198.25",
                "10. change percent": "-0.25%",
                "07. latest trading day": "2026-03-25",
            }
        }

    monkeypatch.setattr(controller, "_request_json", _mock_request_json)

    payload = controller._fetch_alpha_vantage_stock_quote("AAPL")

    assert seen["url"] == "https://www.alphavantage.co/query"
    assert payload["price"] == 198.25
    assert payload["fetch_source"] == "alphavantage_eod"


def test_fetch_alpha_vantage_stock_quote_marks_realtime_when_entitlement_enabled(monkeypatch) -> None:
    controller = QuoteProviderController(
        _settings(
            alphavantage_api_key="demo",
            alphavantage_base_url="https://www.alphavantage.co/query",
            alphavantage_entitlement="realtime",
        )
    )
    monkeypatch.setattr(
        controller,
        "_request_json",
        lambda url, params=None, headers=None: {
            "Global Quote": {
                "05. price": "202.75",
                "10. change percent": "0.50%",
                "07. latest trading day": "2026-03-25",
            }
        },
    )

    payload = controller._fetch_alpha_vantage_stock_quote("AAPL")

    assert payload["price"] == 202.75
    assert payload["fetch_source"] == "alphavantage_realtime"
    assert payload["source"] == "live"
    assert payload["stale"] is False


def test_fetch_yfinance_stock_quote_uses_fast_info_payload(monkeypatch) -> None:
    controller = QuoteProviderController(_settings())

    class _Ticker:
        @property
        def fast_info(self):
            return {
                "lastPrice": 205.25,
                "previousClose": 200.0,
                "lastPriceTimestamp": 1_742_905_600,
            }

        @property
        def info(self):
            return {}

    monkeypatch.setitem(sys.modules, "yfinance", SimpleNamespace(Ticker=lambda symbol: _Ticker()))

    payload = controller._fetch_yfinance_stock_quote("AAPL")

    assert payload["price"] == 205.25
    assert payload["change_pct_24h"] == 2.625
    assert payload["provider"] == "yfinance"
    assert payload["fetch_source"] == "yfinance"
    assert payload["source"] == "delayed"
    assert payload["stale"] is True
