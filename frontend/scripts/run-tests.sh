#!/usr/bin/env bash
set -euo pipefail

vitest run src/pages/Market.test.tsx
vitest run \
  src/components/market/BacktestPanel.test.tsx \
  src/components/market/RuntimeModePanel.test.tsx \
  src/components/market/MoversPanel.test.tsx \
  src/hooks/useWorkspaceStorage.test.tsx \
  src/hooks/useWorkspaceDiscovery.test.tsx \
  src/hooks/useAssetCollections.test.tsx \
  src/hooks/useAssetMarketData.test.tsx \
  src/hooks/useBacktestWorkspace.test.tsx \
  src/utils/compareSnapshotHistory.test.ts \
  src/utils/marketWorkspace.test.ts \
  src/utils/runtimePerformance.test.ts
