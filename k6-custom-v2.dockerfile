FROM grafana/xk6:latest as builder
RUN xk6 build --with github.com/grafana/xk6-exec@latest -o /k6

FROM alpine:3.18
COPY --from=builder /k6 /usr/bin/k6
ENTRYPOINT ["/usr/bin/k6"]