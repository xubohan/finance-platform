# 维护与修正计划（>=20项）

目标：保证项目在 Docker/WSL 环境稳定运行，持续修复展示错误，并建立可重复验证流程。
时间基准：2026-03-06。

## 当前进度（2026-03-15）

- 已完成：1-30（P0 全部 + P1 全部 + P2 全部）。
- 本轮新增完成项：
  - 31：单标的回测新增 `williams_reversal`、`chaikin_money_flow_trend`、`aroon_trend`、`roc_breakout` 四种策略。
  - 31 补充完成：前端策略白名单/选项目录收敛到 `frontend/src/utils/backtestStrategies.ts`，并修复 workspace 对负阈值参数的持久化限制。
  - 32：单标的回测继续新增 `wma_cross`、`cmo_reversal`、`trix_trend` 三种策略。
  - 32 补充完成：前端策略目录继续承载参数分组与占位文案，`BacktestPanel` 不再把 fast/slow、oscillator、threshold 标签散落写死在组件里。
  - 33：单标的回测继续新增 `hma_cross`、`stochrsi_reversal`、`fisher_reversal`、`coppock_trend` 四种策略。
  - 33 补充完成：修复 `stochrsi_reversal` 在 RSI 区间塌缩时返回 `NaN` 的边角，极端超卖窗口现在仍能给出稳定信号。
  - 34：单标的回测继续新增 `tema_cross`、`ultimate_oscillator_reversal`、`dpo_reversal`、`tsi_trend` 四种策略。
  - 34 补充完成：修复 `dpo_reversal` 的方向定义，使“当前价显著低于移位趋势基准”时能给出正确的超卖买入信号。
  - 35：单标的回测继续新增 `dema_cross`、`zlema_cross`、`schaff_reversal`、`vortex_trend` 四种策略。
  - 35 补充完成：进一步把 fast/slow、oscillator、threshold 三类策略都接入统一目录和参数映射，新增策略不再需要分散修改多处前端 union。
  - 36：单标的回测继续新增 `smma_cross`、`vwma_cross`、`awesome_reversal`、`kst_trend` 四种策略。
  - 36 补充完成：继续复用既有 `fast/slow`、`oscillator`、`threshold` 三类参数分组，前端没有新增第四类表单。
  - 37：单标的回测继续新增 `alma_cross`、`trima_cross`、`cfo_reversal`、`efi_trend` 四种策略。
  - 37 补充完成：继续沿用现有三类参数分组，并把 workspace/backtest 映射、页面选项、持久化测试一并补齐。
  - 38：单标的回测继续新增 `lsma_cross`、`demarker_reversal`、`rvi_reversal`、`vhf_trend` 四种策略。
  - 38 补充完成：继续沿用现有三类参数分组，并补齐对应的 builder、页面选项、workspace 持久化和参数映射测试。
  - 39：单标的回测继续新增 `mcginley_cross`、`smi_reversal`、`vzo_trend`、`pmo_trend` 四种策略。
  - 39 补充完成：继续沿用现有三类参数分组，并补齐对应的 builder、页面选项、workspace 持久化和参数映射测试。
  - 40：单标的回测继续新增 `t3_cross`、`bias_reversal`、`chaikin_volatility_trend`、`linreg_slope_trend` 四种策略。
  - 40 补充完成：继续沿用现有三类参数分组，并补齐对应的 builder、页面选项、workspace 持久化和参数映射测试。
  - 41：新增后端策略目录接口 `/api/v1/backtest/strategies`，统一暴露 `name/label/parameter_mode/summary`。
  - 42：单标的回测新增策略对比摘要表与 `对比CSV` 导出，支持同标的多策略横向比较。
  - 42 补充完成：前端优先消费后端策略目录，策略对比默认包含当前策略和核心基准池；导出 compare CSV 已接进工作台。
  - 41 补充完成：前端回测面板优先消费后端策略目录，失败时回退本地目录，并在面板内显示目录来源与策略说明。
  - 43：单标的策略对比新增排序指标，支持按总收益、年化、夏普、最大回撤、胜率、成交数切换排名。
  - 43 补充完成：排序指标已接入 `/api/v1/backtest/compare`、workspace state 持久化、页面对比池控件，以及已有 compare 结果的前端即时重排。
  - 44：策略对比请求改为给整个对比池生成参数映射，不再只给当前策略透传参数。
  - 44 补充完成：当前工作台里的 fast/slow、oscillator、threshold、breakout 等参数会同步应用到同模式的 compare 策略，避免横向比较混入默认参数。
  - 45：策略对比池新增模板切换，支持核心池、趋势池、反转池、突破池和“仅当前”模式。
  - 45 补充完成：compare pool 支持一键替换并持久化空模板，刷新后仍可保持“仅当前策略”或预设模板状态。
  - 46：回测与对比结果新增“过期提示”，在参数变更后明确标记旧结果已失效。
  - 46 补充完成：排序指标切换仅重排已有 compare 结果，不会误报过期；真正改动策略、参数、对比池或时间区间后才提示重新运行。
  - 47：策略对比新增 `JSON` 导出，保留排序指标、参数映射、时间窗口和结果快照。
  - 47 补充完成：页面层已提供 `对比JSON` 按钮，导出 payload 包含标的、compare pool、ranking metric、parametersByStrategy、meta、stale 状态与结果行。
  - 48：策略对比摘要新增“设为当前策略”动作，支持一键采用本次 compare 的最佳策略。
  - 48 补充完成：点击后会把最佳策略切成当前策略，并清空旧回测/旧对比结果，避免继续展示已失效结论。
  - 49：策略对比摘要新增 Markdown 表格复制，支持直接粘贴到 Notion 或文档。
  - 49 补充完成：页面层已提供 `复制Markdown表格`，内容包含排序指标、快照信息和完整 compare 表格。
  - 50：策略对比摘要新增“保留前三候选”，支持把当前 compare 结果里的前三个非当前策略收敛成下一轮对比池。
  - 50 补充完成：点击后会替换 compare pool、清空旧结果，并以下一轮更小的候选集重新运行 compare。
  - 51：策略对比摘要新增页面层快捷重跑，支持在结果过期后直接重跑 compare 或当前回测。
  - 51 补充完成：页面摘要区已提供 `重跑对比` / `重跑当前回测`，不必滚到下方面板也能刷新失效结果。
  - 52：策略对比摘要新增“仅保留优于当前”，支持把领先于当前策略的候选一键收敛成新的对比池。
  - 52 补充完成：点击后会替换 compare pool、清空旧结果，并以下一轮更聚焦的领先候选重新运行 compare。
  - 53：策略对比摘要新增快捷切换候选，支持直接把前几名非当前策略切成当前策略。
  - 53 补充完成：页面摘要区会渲染前 3 名非当前策略按钮，点击后会采用该策略并保留旧当前策略作为对比候选，下一轮 compare 延续性更好。
  - 54：策略对比摘要新增“回到上一主策略”，支持在采用候选或最佳策略后快速回退。
  - 54 补充完成：切换候选后页面层会记录上一主策略，并允许一键回退，同时保持 compare pool 去重和延续性。
  - 55：策略对比面板新增“撤销上一步调整”，支持回滚模板切换、候选采用和对比池调整。
  - 55 补充完成：页面层已记录上一个主策略与 compare pool 快照，可一键恢复上一步策略配置。
  - 56：手动切换主策略时自动保留旧主策略为 compare 基线，避免 compare 断档。
  - 56 补充完成：主策略下拉切换现在会把旧主策略并入 compare pool，并剔除新主策略的重复项，行为与摘要区候选切换保持一致。
  - 57：策略对比摘要新增“设为当前并回测”，支持采用最佳策略后直接触发回测。
  - 57 补充完成：页面层会在采用最佳策略后自动触发当前回测，不必再滚到下方单独点运行按钮。
  - 58：策略对比新增本地“最近对比快照”，支持记录并恢复最近几次对比配置。
  - 58 补充完成：成功 compare 后会在页面层记录当前标的下的最近配置，并支持一键恢复策略、对比池和排序指标。
  - 59：美股单标的报价链路新增腾讯行情回退，默认 provider 顺序调整为 `finnhub -> twelvedata -> tencent -> yfinance -> alphavantage`，在无 key 环境下也能让 `AAPL/QQQ/SPY` 走 live quote 而不是 `yfinance delayed`。
  - 59 补充完成：已补 `quote_provider_controller` 单测，并在 Docker 运行态验证 `/api/v2/market/AAPL/summary` 与 `/api/v2/market/batch/quotes` 返回 `provider=tencent`, `source=live`, `stale=false`。
  - 60：补齐前端自动刷新闭环，修复 News/Events/Backtest 页面任务运行中按钮仍可重复提交、旧结果继续占据结果画布、以及 search/history 元信息错配的问题。
  - 60 补充完成：`NewsCenter/EventsCenter/BacktestWorkbench` 相关 vitest 已通过，前端构建和 `scripts/smoke_frontend_routes.sh` 也已通过。
  - 6：归档运行日志到 `logs/maintenance/compose_backend_nginx_20260306_1754.log`。
  - 17：新增前端关键路由冒烟脚本 `scripts/smoke_frontend_routes.sh`。
  - 19：统一空态文案，修复 `undefined/NaN` 直出。
  - 20：图表组件改为“一次建图，多次喂数据”，并增强 resize 行为。
  - 21：新增 GitHub Actions CI，在 PR/`main` push 上执行前端测试/构建与 `scripts/run_workspace_validation.sh`。
  - 22：新增 `scripts/nightly_data_source_healthcheck.sh`、`backend/scripts/provider_healthcheck.py` 与定时工作流 `.github/workflows/nightly-provider-health.yml`，覆盖 stock snapshot/symbols、AAPL OHLCV、BTC quote/OHLCV 的夜巡。
  - 23：新增 `/api/v1/system/observability`，聚合接口状态码、延迟、热点错误以及 quote/sync/movers 回退计数，并接入前端运行面板。
  - 24：在观测端点里增加慢请求阈值、慢接口列表、quote 命中率、fallback 占比、sync/movers 成功率摘要，并纳入 smoke 校验。
  - 25：单标的回测成交记录新增分页与页码持久化，最新成交默认在第 1 页显示，切页后会写回 workspace state。
  - 26：新增 `frontend/performance-budget.json` + `frontend/scripts/check-performance-budget.mjs`，并通过 Vite code splitting 与 `modulePreload.resolveDependencies` 把首屏性能预算真正接进 CI。
  - 26 补充完成：前端运行面板新增摘要刷新、K 线刷新、回测执行、K 线重绘等 runtime 指标与慢事件列表，完成“体积预算 + runtime 阈值”闭环。
  - 27：新增 `/api/v1/system/cache-maintenance` 与清理入口 `/api/v1/system/cache-maintenance/cleanup`，并在运行面板显示 snapshot/backtest cache 待清理数量。
  - 28：新增 `scripts/release_workflow.sh` 与 `docs/release-runbook.md`，把 snapshot/promote/rollback/schema-check/workspace-validation 标准化到仓库内。
  - 28 补充完成：补齐 `backend/migrations/` Alembic 基线、发布流里的 `alembic upgrade head`、以及 schema gate 对 v2 表和缓存表的显式校验。
  - 30：新增 `scripts/run_workspace_visual_regression.sh`、`frontend/scripts/capture_workspace_visual_regression.mjs`、周度工作流 `.github/workflows/weekly-visual-regression.yml`，并生成稳定 mock-backed 基线 `docs/visual-regression/market_workspace_baseline.json`。
  - 29：将 WSL + Docker Desktop 工作流和 `sg docker` 临时方案补入 `AGENTS.md`。
- 剩余：无。

## P0（立即执行，阻塞稳定性）

1. 固定 Docker 执行方式：当前会话统一使用 `sg docker -c 'docker compose ...'`，避免 `docker.sock` 权限报错。
2. 执行容器健康检查：`docker compose ps` 全部服务 `Up`。
3. 执行后端测试：`docker compose exec -T backend pytest -q`，确保回归通过。
4. 执行前端构建：`cd frontend && npm run build`，确保发布包可产出。
5. 执行全链路烟雾测试：`bash scripts/smoke_runtime.sh`。
6. 保留运行日志证据：归档 `docker compose logs --tail=200 backend nginx`。
7. 修复图表页日期默认值时区偏移问题（本地日期而非 UTC 截断）。
8. 修复图表页开始/结束日期非法区间展示错误（前端直接拦截并提示）。
9. 修复 K 线图每次刷新整图重建导致闪烁问题（改为一次建图，多次喂数据）。
10. 修复因子回测数据结构不完整时页面渲染异常（增加响应结构校验与提示）。

## P1（高优先级，7天内）

11. 优化加密报价刷新频率（30秒）降低 CoinGecko 429 导致的前端报错噪声。
12. 后端增加加密报价短期缓存（30-60秒）并在上游限流时返回最近成功值。
13. 给 `/api/v1/market/{symbol}/quote` 增加重试与退避策略（仅 crypto 路径）。
14. 为 `backtest/lab` 补充 API 契约测试（含 422 参数校验与成功分页）。
15. 为 `factors/backtest` 增加空数据与字段缺失契约测试。
16. 为前端 API 层增加统一 `as_of` 时间格式化工具，避免页面重复实现。
17. 增加前端 E2E 冒烟（访问 Market/Chart/Screener/Factors/Backtest 关键路径）。
18. 为 `scripts/smoke_runtime.sh` 增加失败重试（网络型 5xx/429 场景）。
19. 统一页面空态文案（无数据、加载中、接口错误）并避免显示 `undefined`。
20. 为图表组件增加 resize 行为验收（桌面与移动端切换不截断）。

## P2（中期优化，2-4周）

21. 建立 CI 流程：后端测试 + 前端构建 + 烟雾脚本（PR 阻断）。已完成，见 `.github/workflows/ci.yml`。
22. 建立 nightly 数据源健康巡检任务（OpenBB/CoinGecko/YFinance 可用率）。已完成，结果会落盘到 `logs/maintenance/provider_healthcheck_<timestamp>.json` 并通过 GitHub Actions 定时执行。
23. 引入 API 错误码统计与告警（按接口、上游来源、状态码聚合）。已完成基础统计与热点错误观察面；外部通知型告警待后续接入。
24. 为关键接口补充请求超时、回退、缓存命中率仪表盘。已完成基础摘要与前端展示；外部告警与长期趋势存储待后续接入。
25. 对 backtest/factors 结果页增加分页状态持久化（刷新后恢复当前页）。已完成单标的 backtest 成交记录分页与 workspace-state 持久化；research-only 页面当前默认未启用。
26. 增加前端性能预算（首屏 JS 大小、图表重绘耗时、交互延时）。已完成，首屏 JS/CSS 与 lazy chunk 预算已接入 CI，图表重绘/工作台刷新/回测执行的 runtime 指标与慢事件阈值已接入运行面板。
27. 对数据库缓存表（`market_snapshot_daily`、`backtest_cache`）制定清理策略。已完成，已提供 retention 摘要、dry-run/执行清理入口，以及运行面板可见的待清理计数。
28. 建立发布清单：构建、迁移、回滚、烟雾验证四步标准化。已完成，当前仓库同时提供 `docker/postgres/init.sql` 启动基线与 `backend/migrations/` Alembic 升级路径，发布流会先执行 `alembic upgrade head` 再做 schema-check。
29. 将运行手册补充到 `AGENTS.md`：Docker 组刷新与 `sg docker` 临时方案。已完成。
30. 每周固定一次“展示错误专项回归”（Chart/Factors/Backtest 三页截图对比）。已完成，当前以 `workspace-overview / workspace-chart / workspace-backtest` 三个区块的稳定 mock-backed 截图基线替代旧独立页面，并已接入周度工作流。

## 验收标准

- `docker compose ps` 全部核心服务 `Up`。
- `pytest` 全通过（当前基线：容器全量后端 `130 passed`，workspace validation 内嵌后端子集 `113 passed`，前端 `131 passed`）。
- 前端构建成功（Vite build 成功）。
- `scripts/smoke_runtime.sh` 全部步骤通过。
- Chart/Factors 页面不存在明显闪烁、日期错位、空数据崩溃问题。
