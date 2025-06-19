FROM grafana/xk6:latest-with-extensions
RUN xk6 build --with github.com/grafana/xk6-exec@latest