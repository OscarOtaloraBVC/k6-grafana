# Stage 1: Build k6 with xk6-exec extension
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install required packages
RUN apk add --no-cache git ca-certificates

# Set Go environment variables
ENV CGO_ENABLED=0
ENV GOOS=linux

# Install xk6 - using older stable version
RUN go install go.k6.io/xk6/cmd/xk6@v0.8.1

# Build k6 with the exec extension - using correct module path
RUN xk6 build \
    --with github.com/grafana/xk6-exec@v0.4.2 \
    --output /app/k6

# Stage 2: Create the final k6 image
FROM grafana/k6:0.45.0

# Copy the custom k6 binary from the builder stage to a writable location
COPY --from=builder /app/k6 /usr/local/bin/k6

# Make sure the binary is executable
RUN chmod +x /usr/local/bin/k6

# Update PATH to prioritize our custom k6 binary
ENV PATH="/usr/local/bin:$PATH"

# Verify the build worked
RUN k6 version

# Set entrypoint
ENTRYPOINT ["k6"]