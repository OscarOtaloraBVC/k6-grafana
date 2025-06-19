# Use a base k6 image
FROM grafana/k6:latest

# Install xk6 and build k6 with the exec extension
RUN go install go.k6.io/xk6/cmd/xk6@latest \
    && xk6 build --with github.com/k6io/xk6-exec