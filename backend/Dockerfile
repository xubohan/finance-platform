FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
# Install minimal runtime dependencies required up to Step 5 gates.
RUN pip install --no-cache-dir \
    fastapi==0.115.6 \
    uvicorn==0.32.1 \
    SQLAlchemy==2.0.36 \
    asyncpg==0.30.0 \
    celery==5.4.0 \
    redis==5.2.1 \
    pandas==2.2.3 \
    numpy==2.1.3 \
    requests==2.32.3 \
    yfinance==0.2.50 \
    pytest==8.3.4

COPY app /app/app
COPY backtest /app/backtest
COPY tasks /app/tasks
COPY tests /app/tests

ENV PYTHONPATH=/app

CMD ["python", "-c", "print('backend container ready')"]
