FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY alembic.ini /app/alembic.ini
COPY app /app/app
COPY backtest /app/backtest
COPY migrations /app/migrations
COPY tasks /app/tasks
COPY tests /app/tests

ENV PYTHONPATH=/app

CMD ["python", "-c", "print('backend container ready')"]
