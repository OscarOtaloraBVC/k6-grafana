# Stage 1: Build k6 with xk6-exec extension using Go 1.24
FROM golang:1.24rc1-alpine AS builder

WORKDIR /app

# Install required packages
RUN apk add --no-cache git ca-certificates

# Set Go environment variables
ENV CGO_ENABLED=0
ENV GOOS=linux

# Install xk6 latest (now compatible with Go 1.24)
RUN go install go.k6.io/xk6/cmd/xk6@latest

# Build k6 with the exec extension
RUN xk6 build \
    --with github.com/grafana/xk6-exec@latest \
    --output /app/k6

# Stage 2: Create the final k6 image
FROM grafana/k6:latest

# Copy the custom k6 binary from the builder stage
COPY --from=builder /app/k6 /usr/bin/k6

# Make sure the binary is executable
RUN chmod +x /usr/bin/k6

# Verify the build worked
RUN k6 version

# Set entrypoint
ENTRYPOINT ["k6"]