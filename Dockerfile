# Stage 1: Build k6 with xk6-exec extension
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install required packages
RUN apk add --no-cache git ca-certificates

# Set Go environment variables
ENV CGO_ENABLED=0
ENV GOOS=linux

# Install xk6 - try with a newer version that might handle flags better
RUN go install go.k6.io/xk6/cmd/xk6@latest

# Build k6 with the exec extension
RUN xk6 build \
    --with github.com/k6io/xk6-exec@latest \
    --output /app/k6

# Stage 2: Create a minimal final image
FROM alpine:latest

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates

# Copy the custom k6 binary from the builder stage
COPY --from=builder /app/k6 /usr/bin/k6

# Make sure the binary is executable
RUN chmod +x /usr/bin/k6

# Create a non-root user
RUN adduser -D -s /bin/sh k6user

# Switch to non-root user
USER k6user

# Verify the build worked
RUN k6 version

# Set entrypoint
ENTRYPOINT ["k6"]