#!/bin/bash
# deploy-k6-monitoring.sh

echo "🚀 Desplegando K6 + Prometheus + Grafana en Kubernetes..."

# Crear namespace
echo "📦 Creando namespace..."
kubectl apply -f namespace.yaml

# Aplicar ConfigMaps
echo "⚙️ Aplicando configuraciones..."
kubectl apply -f prometheus-config.yaml
kubectl apply -f grafana-datasources.yaml
kubectl apply -f grafana-dashboards.yaml
kubectl apply -f grafana-dashboard-files.yaml
kubectl apply -f k6-scripts-configmap.yaml

# Desplegar Prometheus
echo "📊 Desplegando Prometheus..."
kubectl apply -f prometheus-deployment.yaml
kubectl apply -f prometheus-service.yaml

# Desplegar Grafana
echo "📈 Desplegando Grafana..."
kubectl apply -f grafana-deployment.yaml
kubectl apply -f grafana-service.yaml

# Configurar K6 Output Service
echo "🔧 Configurando K6 Output Service..."
kubectl apply -f k6-output-service.yaml

# Esperar a que los pods estén listos
echo "⏳ Esperando a que los pods estén listos..."
kubectl wait --for=condition=ready pod -l app=prometheus -n k6-monitoring --timeout=300s
kubectl wait --for=condition=ready pod -l app=grafana -n k6-monitoring --timeout=300s

echo "✅ Despliegue completado!"
echo ""
echo "🌐 Para acceder a Grafana, ejecuta:"
echo "kubectl port-forward -n k6-monitoring svc/grafana-service 3000:3000"
echo ""
echo "Credenciales de Grafana:"
echo "Usuario: admin"
echo "Contraseña: admin123"
echo ""
echo "🧪 Para ejecutar las pruebas K6, usa:"
echo "kubectl apply -f k6-harbor-job.yaml"
echo "kubectl apply -f k6-artifactory-job.yaml"
echo "kubectl apply -f k6-vault-job.yaml"
echo "kubectl apply -f k6-keycloak-job.yaml"
echo "kubectl apply -f k6-combined-job.yaml"