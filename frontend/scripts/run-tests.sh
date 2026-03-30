#!/usr/bin/env bash
set -euo pipefail

npx vitest run \
  src/components/layout/AppShell.test.tsx \
  src/pages/BacktestWorkbench.test.tsx \
  src/pages/EventsCenter.test.tsx \
  src/pages/MarketDetail.test.tsx \
  src/pages/NewsCenter.test.tsx \
  src/hooks/useWorkspaceStorage.test.tsx \
  src/utils/backtestParameters.test.ts \
  src/utils/compareSnapshotHistory.test.ts \
  src/utils/text.test.ts \
  src/utils/marketWorkspace.test.ts \
  src/utils/runtimePerformance.test.ts
