# Release Runbook

## Scope

This repository now ships both `docker/postgres/init.sql` and a standalone Alembic baseline under
`backend/migrations/`. The standard promote flow runs `alembic upgrade head` inside the backend
container before the schema gate, so releases validate both bootstrapped tables and pending
migration files.

## Standard Flow

1. Save the current rollback point:

```bash
bash scripts/release_workflow.sh snapshot
```

2. Run the full promote flow:

```bash
bash scripts/release_workflow.sh promote
```

The promote flow will:

- snapshot current `finance-plat-backend:latest` and `finance-plat-frontend:latest` image ids
- rebuild and start the core stack
- run `alembic upgrade head` inside the backend container
- verify schema baseline inside Postgres
- run `bash scripts/run_workspace_validation.sh`
- archive compose status and runtime logs under `logs/releases/`

3. If the new release is bad, roll back with the saved snapshot:

```bash
bash scripts/release_workflow.sh rollback logs/releases/release_state_<timestamp>.json
```

## Notes

- Rollback currently restores the backend and frontend images, then restarts the core runtime.
- DB/Redis volumes are preserved during rollback; this flow is meant for runtime regression rollback, not destructive data resets.
- Release evidence is stored under `logs/releases/` so later maintenance can inspect the exact validation and runtime logs used for the release decision.
- For fresh environments, `docker/postgres/init.sql` remains the bootstrap path, while Alembic is the explicit upgrade path for later schema evolution.
