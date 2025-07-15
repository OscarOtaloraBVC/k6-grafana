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

// Variables de entorno - IMPORTANTE: Usar http://
const PROMETHEUS_URL = 'http://localhost:9090'; // Añadir protocolo http://
const HARBOR_URL = 'test-nuam-registry.coffeesoft.org'; // Sin https:// para comandos Docker
const IMAGE_NAME = 'test-devops/ubuntu:xk6-1749486052417';

// Consultas Prometheus ajustadas
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{container=~"harbor-core|harbor-registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{container=~"harbor-core|harbor-registry"}) by (container) / (1024*1024)';

// Función mejorada para obtener métricas
function getHarborMetrics() {
  let metrics = {
    cpu: { core: 0, registry: 0 },
    memory: { core: 0, registry: 0 }
  };

  try {
    // Consultar CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`, {
      timeout: '10s',
      tags: { metric_type: 'cpu_query' }
    });

    if (cpuRes && cpuRes.status === 200) {
      const cpuData = cpuRes.json();
      if (cpuData && cpuData.data && cpuData.data.result) {
        cpuData.data.result.forEach(item => {
          const value = parseFloat(item.value?.[1]) || 0;
          if (item.metric?.container.includes('core')) metrics.cpu.core = value;
          if (item.metric?.container.includes('registry')) metrics.cpu.registry = value;
        });
      }
    }

    // Consultar Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`, {
      timeout: '10s',
      tags: { metric_type: 'memory_query' }
    });

    if (memRes && memRes.status === 200) {
      const memData = memRes.json();
      if (memData && memData.data && memData.data.result) {
        memData.data.result.forEach(item => {
          const value = parseFloat(item.value?.[1]) || 0;
          if (item.metric?.container.includes('core')) metrics.memory.core = value;
          if (item.metric?.container.includes('registry')) metrics.memory.registry = value;
        });
      }
    }

  } catch (e) {
    errorCount.add(1);
    console.error(`Error fetching metrics: ${e.message}`);
  }

  return metrics;
}

// Función segura para ejecutar comandos Docker
function runDockerCommand(cmd, operation) {
  const start = Date.now();
  let success = false;
  let output = '';

  try {
    const result = exec(cmd, { timeout: '30s' });
    success = result.exit_status === 0;
    output = result.stdout || result.stderr || '';
  } catch (e) {
    errorCount.add(1);
    console.error(`${operation} error: ${e.message}`);
    output = e.message;
  }

  const duration = (Date.now() - start) / 1000;
  operationDuration.add(duration, { operation });

  return { success, duration, output };
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
  const { success: pullSuccess, duration: pullDuration } = runDockerCommand(
    `docker pull ${HARBOR_URL}/${IMAGE_NAME}`,
    'pull'
  );

  // 3. Operación Docker RM (solo si pull fue exitoso)
  let rmSuccess = false;
  let rmDuration = 0;
  
  if (pullSuccess) {
    const rmResult = runDockerCommand(
      `docker rmi ${HARBOR_URL}/${IMAGE_NAME}`,
      'rm'
    );
    rmSuccess = rmResult.success;
    rmDuration = rmResult.duration;
  }

  // 4. Registrar resultados
  requestRate.add(1);
  check({
    pullSuccess,
    rmSuccess: pullSuccess ? rmSuccess : true, // No fallar si no se intentó rm
    cpuUsage: metrics.cpu.core,
  }, {
    'docker pull succeeded': (r) => r.pullSuccess,
    'docker rm succeeded': (r) => r.rmSuccess,
    'cpu under threshold': (r) => r.cpuUsage < 80,
  });

  sleep(1);
}

// Función de resumen mejorada
export function handleSummary(data) {
  const safeGet = (obj, path, def = 0) => {
    try {
      return path.split('.').reduce((o, p) => o[p], obj) || def;
    } catch {
      return def;
    }
  };

  const summary = {
    timestamp: new Date().toISOString(),
    metrics: {
      cpu_usage: {
        core: safeGet(data.metrics, 'harbor_cpu_usage_percent.values.avg'),
        registry: safeGet(data.metrics, 'harbor_cpu_usage_percent.values.avg')
      },
      operations: {
        pull: {
          count: safeGet(data.metrics, 'checks.passes'),
          duration_p95: safeGet(data.metrics, 'docker_operation_duration_seconds.values.p(95)')
        }
      },
      errors: safeGet(data.metrics, 'error_count.values.count')
    }
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    'summary.json': JSON.stringify(summary, null, 2)
  };
}