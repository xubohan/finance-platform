# Release Runbook

## Scope

This repository currently uses Docker Compose plus `docker/postgres/init.sql` as the schema baseline.
There is no standalone migration tool such as Alembic in the repo yet, so the release gate treats
"schema check" as "required baseline tables are present after startup", not "run pending migration files".

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
