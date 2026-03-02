# Repository Guidelines

## Project Structure & Module Organization
This repository is a Docker-first full-stack finance platform.
- `backend/`: FastAPI APIs (`app/api`), market/factor services (`app/services`), backtest engine (`backtest/`), Celery tasks (`tasks/`), and backend tests (`tests/`).
- `frontend/`: React + Vite UI. Main pages are in `src/pages`, API clients in `src/api`, reusable UI in `src/components`.
- `ai_service/`: separate FastAPI microservice for AI analysis tasks.
- `docker/`: Nginx and database bootstrap assets.
- `docker-compose.yml`: orchestrates db, redis, backend, celery worker, ai_service, frontend, and nginx.

## Build, Test, and Development Commands
Use Docker for end-to-end runs (recommended):
- `docker compose up -d --build`: rebuild and start the full stack.
- `docker compose up -d --build backend celery_worker nginx`: use after backend/api changes to refresh runtime routing and workers.
- `docker compose logs -f backend nginx`: inspect API/data-source errors.
- `docker compose down`: stop all services.

## WSL + Docker Desktop Workflow
Run Docker commands from your WSL shell at the repo root.

Prerequisite checks (WSL):
- `docker version` (both Client and Server should respond).
- `docker compose version`
- `docker context show` (usually `default` or `desktop-linux`).
- If Server is unavailable, start Docker Desktop on Windows and enable this distro in Docker Desktop `Settings -> Resources -> WSL Integration`.

Standard commands:
- `docker compose up -d`: start services with existing images.
- `docker compose up -d --build`: rebuild and restart after dependency/Dockerfile changes.
- `docker compose ps`: quick health/status check.
- `docker compose logs -f backend nginx`: inspect backend and reverse-proxy issues.
- `docker compose exec backend pytest -q`: run backend tests in-container.
- `docker compose down`: stop stack.
- `docker compose down -v`: reset volumes only when explicitly needed.

Assistant assumptions:
- Assume WSL terminal + Docker Desktop integration are the default runtime.
- Prefer Docker Compose workflows over host-local installs unless the user asks otherwise.
- Verify container state/logs before proposing code-level fixes.
- Avoid destructive cleanup commands unless explicitly requested.

Permission quick-fix (when `docker.sock` says permission denied):
- Diagnose:
  - `id -nG`
  - `ls -l /var/run/docker.sock`
  - `docker info`
- Fix user/group access (interactive terminal):
  - `sudo groupadd docker 2>/dev/null || true`
  - `sudo usermod -aG docker $USER`
  - `newgrp docker` (or reopen WSL terminal)
- Recheck:
  - `docker info`
  - `docker compose ps`
- If `getent group docker` includes your user but current shell still lacks the group, run Docker commands with:
  - `sg docker -c 'docker compose up -d --build'`
  - `sg docker -c 'docker compose ps'`
  - then reopen the terminal later for permanent group refresh.
- If group changes still do not apply, restart WSL from PowerShell:
  - `wsl --shutdown`
  - reopen terminal and rerun checks above.

Local-only development (optional):
- Backend: `pip install -r backend/requirements.txt && cd backend && uvicorn app.main:app --reload`
- Frontend: `cd frontend && npm ci && npm run dev`

## Coding Style & Naming Conventions
- Python: PEP 8, 4-space indentation, type hints, `snake_case` for functions/variables, `PascalCase` for classes.
- TypeScript/React: 2-space indentation, `camelCase` for variables/functions, `PascalCase` for component files (for example `Screener.tsx`).
- Keep API contracts explicit: update `frontend/src/api/*.ts` types when backend response schema changes.
- Prefer live market sources; do not add static/mock fallback paths to production APIs.

## Testing Guidelines
- Framework: `pytest` (`backend/tests/test_*.py`).
- Run: `cd backend && pytest -q`
- For container parity: `docker compose run --rm backend pytest -q`
- For API/source changes, include both success and upstream-failure cases (for example expected `502` on unavailable live feed).

## Commit & Pull Request Guidelines
- Follow existing commit style: `fix: ...`, `feat: ...`, `stepNN: ...` (short imperative summary).
- Keep commits focused by area (backend/frontend/docker).
- PRs should include:
  1. What changed and why.
  2. How it was tested (commands + key results).
  3. UI screenshots for frontend-visible changes.
  4. Any config/env changes (for example `.env` keys).
