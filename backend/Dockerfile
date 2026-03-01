FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
# Step 4 gate only needs ORM importability.
# Full dependency installation will be enforced in later steps.
RUN pip install --no-cache-dir SQLAlchemy==2.0.36 asyncpg==0.30.0

COPY app /app/app
COPY backtest /app/backtest
COPY tasks /app/tasks

ENV PYTHONPATH=/app

CMD ["python", "-c", "print('backend container ready')"]
