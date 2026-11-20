FROM python:3.12-alpine

RUN adduser -D -H arcade && mkdir /data && chown arcade /data
WORKDIR /app
COPY server.py .

USER arcade
ENV ARCADE_DB=/data/arcade.db \
    ARCADE_PORT=8000 \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1

CMD ["python", "server.py"]
