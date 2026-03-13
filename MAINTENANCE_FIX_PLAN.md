# 维护与修正计划（>=20项）

目标：保证项目在 Docker/WSL 环境稳定运行，持续修复展示错误，并建立可重复验证流程。  
时间基准：2026-03-06。

## 当前进度（2026-03-06）

- 已完成：1-20（P0 全部 + P1 全部）。  
- 本轮新增完成项：  
  - 6：归档运行日志到 `logs/maintenance/compose_backend_nginx_20260306_1754.log`。  
  - 17：新增前端关键路由冒烟脚本 `scripts/smoke_frontend_routes.sh`。  
  - 19：统一空态文案，修复 `undefined/NaN` 直出。  
  - 20：图表组件改为“一次建图，多次喂数据”，并增强 resize 行为。  
- 剩余：21-30（CI、观测与长期治理）。

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

21. 建立 CI 流程：后端测试 + 前端构建 + 烟雾脚本（PR 阻断）。  
22. 建立 nightly 数据源健康巡检任务（OpenBB/CoinGecko/YFinance 可用率）。  
23. 引入 API 错误码统计与告警（按接口、上游来源、状态码聚合）。  
24. 为关键接口补充请求超时、回退、缓存命中率仪表盘。  
25. 对 backtest/factors 结果页增加分页状态持久化（刷新后恢复当前页）。  
26. 增加前端性能预算（首屏 JS 大小、图表重绘耗时、交互延时）。  
27. 对数据库缓存表（`market_snapshot_daily`、`backtest_cache`）制定清理策略。  
28. 建立发布清单：构建、迁移、回滚、烟雾验证四步标准化。  
29. 将运行手册补充到 `AGENTS.md`：Docker 组刷新与 `sg docker` 临时方案。  
30. 每周固定一次“展示错误专项回归”（Chart/Factors/Backtest 三页截图对比）。

## 验收标准

- `docker compose ps` 全部核心服务 `Up`。  
- `pytest` 全通过（当前基线：28 passed）。  
- 前端构建成功（Vite build 成功）。  
- `scripts/smoke_runtime.sh` 全部步骤通过。  
- Chart/Factors 页面不存在明显闪烁、日期错位、空数据崩溃问题。
