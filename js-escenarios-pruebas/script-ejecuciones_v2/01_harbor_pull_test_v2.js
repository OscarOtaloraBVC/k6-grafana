import http from 'k6/http';
import { check, sleep } from 'k6';
import { exec } from 'k6/execution';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// Métricas personalizadas
const cpuUsage = new Gauge('harbor_cpu_usage_percent');
const memoryUsage = new Gauge('harbor_memory_usage_mb');
const requestRate = new Rate('requests_per_second');
const operationDuration = new Trend('docker_operation_duration_seconds');
const errorCount = new Counter('error_count');

// Configuración de la prueba
export let options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 25 },
    { duration: '1m', target: 15 },
    { duration: '2m', target: 10 },
  ],
  noConnectionReuse: true,
  thresholds: {
    'docker_operation_duration_seconds{operation:pull}': ['p(95)<10000'],
    'docker_operation_duration_seconds{operation:rm}': ['p(95)<5000'],
    'harbor_cpu_usage_percent': ['value<80'],
    'harbor_memory_usage_mb': ['value<4096'], // 4GB máximo
    'error_count': ['count<10'],
  },
};

// Variables de entorno
const PROMETHEUS_URL = 'http://prometheus-kube-prometheus-prometheus.monitoring:9090';
const HARBOR_URL = 'https://test-nuam-registry.coffeesoft.org';
const IMAGE_NAME = 'test-devops/ubuntu:xk6-1749486052417';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="harbor",container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="harbor",container=~"core|registry"}) by (container) / (1024*1024)';

// Obtener métricas de Prometheus 
function getHarborMetrics() {
  try {
    // Consultar CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`, {
      timeout: '5s',
      tags: { metric_type: 'cpu_query' }
    });
    
    // Consultar Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`, {
      timeout: '5s',
      tags: { metric_type: 'memory_query' }
    });

    // Procesar resultados
    const metrics = {
      cpu: { core: 0, registry: 0 },
      memory: { core: 0, registry: 0 }
    };

    if (cpuRes.status === 200) {
      const data = cpuRes.json();
      if (data.data && data.data.result) {
        data.data.result.forEach(item => {
          if (item.metric.container === 'core') metrics.cpu.core = parseFloat(item.value[1]) || 0;
          if (item.metric.container === 'registry') metrics.cpu.registry = parseFloat(item.value[1]) || 0;
        });
      }
    }

    if (memRes.status === 200) {
      const data = memRes.json();
      if (data.data && data.data.result) {
        data.data.result.forEach(item => {
          if (item.metric.container === 'core') metrics.memory.core = parseFloat(item.value[1]) || 0;
          if (item.metric.container === 'registry') metrics.memory.registry = parseFloat(item.value[1]) || 0;
        });
      }
    }

    return metrics;
  } catch (e) {
    errorCount.add(1);
    console.error(`Error fetching metrics: ${e.message}`);
    return {
      cpu: { core: 0, registry: 0 },
      memory: { core: 0, registry: 0 }
    };
  }
}

// Función principal de prueba
export default function () {
  // 1. Obtener métricas de Harbor
  const metrics = getHarborMetrics();
  cpuUsage.add(metrics.cpu.core, { component: 'core' });
  cpuUsage.add(metrics.cpu.registry, { component: 'registry' });
  memoryUsage.add(metrics.memory.core, { component: 'core' });
  memoryUsage.add(metrics.memory.registry, { component: 'registry' });

  // 2. Operación Docker Pull
  const pullStart = Date.now();
  let pullSuccess = false;
  try {
    const pullResult = exec(`docker pull ${HARBOR_URL}/${IMAGE_NAME}`, { timeout: '30s' });
    pullSuccess = pullResult.exit_status === 0;
  } catch (e) {
    errorCount.add(1);
    console.error(`Docker pull failed: ${e.message}`);
  }
  const pullDuration = (Date.now() - pullStart) / 1000;
  operationDuration.add(pullDuration, { operation: 'pull' });

  // 3. Operación Docker RM
  const rmStart = Date.now();
  let rmSuccess = false;
  try {
    const rmResult = exec(`docker rmi ${HARBOR_URL}/${IMAGE_NAME}`, { timeout: '30s' });
    rmSuccess = rmResult.exit_status === 0;
  } catch (e) {
    errorCount.add(1);
    console.error(`Docker rm failed: ${e.message}`);
  }
  const rmDuration = (Date.now() - rmStart) / 1000;
  operationDuration.add(rmDuration, { operation: 'rm' });

  // 4. Registrar resultados
  requestRate.add(1);
  check({
    pullSuccess: pullSuccess,
    rmSuccess: rmSuccess,
    cpuUsage: metrics.cpu.core,
  }, {
    'docker pull succeeded': (r) => r.pullSuccess,
    'docker rm succeeded': (r) => r.rmSuccess,
    'cpu under threshold': (r) => r.cpuUsage < 80,
  });

  sleep(1);
}

// Función de resumen compatible con Prometheus
export function handleSummary(data) {
  const metrics = [
    // Métricas de rendimiento
    `# HELP k6_docker_operations_total Total docker operations`,
    `# TYPE k6_docker_operations_total counter`,
    `k6_docker_operations_total{operation="pull"} ${data.metrics['checks'].passes || 0}`,
    `k6_docker_operations_total{operation="rm"} ${data.metrics['checks'].passes || 0}`,

    // Métricas de duración
    `# HELP k6_operation_duration_seconds Duration of operations`,
    `# TYPE k6_operation_duration_seconds summary`,
    `k6_operation_duration_seconds{operation="pull",quantile="0.95"} ${data.metrics['docker_operation_duration_seconds'].values['p(95)'] || 0}`,
    `k6_operation_duration_seconds{operation="rm",quantile="0.95"} ${data.metrics['docker_operation_duration_seconds'].values['p(95)'] || 0}`,

    // Métricas de error
    `# HELP k6_errors_total Total errors during test`,
    `# TYPE k6_errors_total counter`,
    `k6_errors_total ${data.metrics['error_count'].values.count || 0}`,
  ].join('\n');

  return {
    'stdout': `Resumen de prueba:\n${JSON.stringify(data, null, 2)}`,
    'prometheus-metrics.txt': metrics
  };
}