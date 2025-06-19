FROM grafana/xk6:latest
RUN xk6 build --with github.com/grafana/xk6-exec@latest -o /tmp/k6 && \
    mv /tmp/k6 /usr/bin/k6