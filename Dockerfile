# Stage 1: Build k6 with xk6-exec extension
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install xk6
RUN go install go.k6.io/xk6/cmd/xk6@latest

# Build k6 with the exec extension
# Ensure you have the correct version for k6 if needed, otherwise 'latest' will be used by xk6
RUN xk6 build --with github.com/k6io/xk6-exec

# Stage 2: Create the final k6 image
FROM grafana/k6:latest

# Copy the custom k6 binary from the builder stage
COPY --from=builder /app/k6 /usr/bin/k6

# (Optional) Set entrypoint if you always want to run k6
# ENTRYPOINT ["k6"]