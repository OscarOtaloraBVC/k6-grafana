import http from 'k6/http';
import { check, sleep } from 'k6';
import { exec } from 'k6/execution';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// Métricas
const harborCPU = new Gauge('harbor_cpu_usage');
const harborMemory = new Gauge('harbor_memory_usage');
const requestRate = new Rate('requests_per_second');
const operationDuration = new Trend('operation_duration');
const errorCount = new Counter('error_count');
const successCount = new Counter('success_count');

// Configuración de prueba
export let options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 25 },
    { duration: '1m', target: 15 },
    { duration: '2m', target: 10 },
  ],
  noConnectionReuse: true,
  thresholds: {
    'operation_duration{operation:pull}': ['p(95)<10000'],
    'operation_duration{operation:rm}': ['p(95)<5000'],
    'error_count': ['count<20'],
  },
};

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';
const HARBOR_URL = __ENV.HARBOR_URL || 'test-nuam-registry.coffeesoft.org';
const IMAGE_NAME = __ENV.IMAGE_NAME || 'test-devops/ubuntu:xk6-1749486052417';
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Función para obtener métricas
function getHarborMetrics() {
  const metrics = {
    cpu: { core: 0, registry: 0 },
    memory: { core: 0, registry: 0 },
    timestamp: new Date().toISOString()
  };

  try {
    // Consultar CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`, {
      timeout: '10s',
      tags: { query: 'cpu_usage' }
    });

    if (cpuRes && cpuRes.status === 200) {
      const data = cpuRes.json();
      if (data.data?.result) {
        data.data.result.forEach(item => {
          const value = parseFloat(item.value?.[1]) || 0;
          if (item.metric?.container.includes('core')) metrics.cpu.core = value;
          if (item.metric?.container.includes('registry')) metrics.cpu.registry = value;
        });
      }
    }

    // Consultar Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`, {
      timeout: '10s',
      tags: { query: 'memory_usage' }
    });

    if (memRes && memRes.status === 200) {
      const data = memRes.json();
      if (data.data?.result) {
        data.data.result.forEach(item => {
          const value = parseFloat(item.value?.[1]) || 0;
          if (item.metric?.container.includes('core')) metrics.memory.core = value;
          if (item.metric?.container.includes('registry')) metrics.memory.registry = value;
        });
      }
    }

  } catch (e) {
    errorCount.add(1);
    console.error(`Error getting metrics: ${e.message}`);
  }

  return metrics;
}

// Función operaciones Docker
function dockerOperation(cmd, operation) {
  const start = Date.now();
  let success = false;
  let output = '';

  try {
    const result = exec(cmd, { timeout: '30s' });
    success = result.exit_status === 0;
    output = result.stdout || result.stderr || '';
    if (success) successCount.add(1);
  } catch (e) {
    errorCount.add(1);
    output = e.message;
    console.error(`${operation} error: ${e.message}`);
  }

  const duration = (Date.now() - start) / 1000;
  operationDuration.add(duration, { operation });

  return { success, duration, output };
}

// Función principal
export default function () {
  // 1. Obtener métricas de Harbor
  const metrics = getHarborMetrics();
  harborCPU.add(metrics.cpu.core, { component: 'core' });
  harborCPU.add(metrics.cpu.registry, { component: 'registry' });
  harborMemory.add(metrics.memory.core, { component: 'core' });
  harborMemory.add(metrics.memory.registry, { component: 'registry' });

  // 2. Login a Harbor (opcional)
  const loginCmd = `docker login ${HARBOR_URL} -u ${USERNAME} -p ${PASSWORD}`;
  dockerOperation(loginCmd, 'login');

  // 3. Operación Docker Pull
  const pullResult = dockerOperation(
    `docker pull ${HARBOR_URL}/${IMAGE_NAME}`,
    'pull'
  );

  // 4. Operación Docker RM (solo si pull fue exitoso)
  let rmResult = { success: true, duration: 0 };
  if (pullResult.success) {
    rmResult = dockerOperation(
      `docker rmi ${HARBOR_URL}/${IMAGE_NAME}`,
      'rm'
    );
  }

  // 5. Registrar métricas
  requestRate.add(1);
  check({
    pullSuccess: pullResult.success,
    rmSuccess: rmResult.success,
    cpuUsage: metrics.cpu.core,
    memoryUsage: metrics.memory.core
  }, {
    'docker pull succeeded': (r) => r.pullSuccess,
    'docker rm succeeded': (r) => r.rmSuccess,
    'cpu under threshold': (r) => r.cpuUsage < 80,
    'memory under threshold': (r) => r.memoryUsage < 4096,
  });

  sleep(1);
}

// Función de reporte
export function handleSummary(data) {
  // Función para obtener valores
  const safeValue = (path, defaultValue = 0) => {
    try {
      return path.split('.').reduce((obj, key) => obj[key], data) || defaultValue;
    } catch {
      return defaultValue;
    }
  };

  // Datos de rendimiento
  const performance = {
    requests_per_second: safeValue('metrics.requests_per_second.values.rate'),
    avg_response_time: safeValue('metrics.operation_duration.values.avg'),
    p95_response_time: safeValue('metrics.operation_duration.values.p(95)'),
    success_rate: safeValue('metrics.success_count.values.count') / 
                (safeValue('metrics.success_count.values.count') + safeValue('metrics.error_count.values.count')) || 0
  };

  // Datos de recursos
  const resources = {
    cpu_usage: {
      core: safeValue('metrics.harbor_cpu_usage.values.avg', 0),
      registry: safeValue('metrics.harbor_cpu_usage.values.avg', 0)
    },
    memory_usage: {
      core: safeValue('metrics.harbor_memory_usage.values.avg', 0),
      registry: safeValue('metrics.harbor_memory_usage.values.avg', 0)
    }
  };

  // Resultados de operaciones
  const operations = {
    pull: {
      count: safeValue('metrics.checks.passes', 0),
      avg_duration: safeValue('metrics.operation_duration.values.avg', 0)
    },
    rm: {
      count: safeValue('metrics.checks.passes', 0),
      avg_duration: safeValue('metrics.operation_duration.values.avg', 0)
    }
  };

  // Reporte consolidado
  const report = {
    timestamp: new Date().toISOString(),
    test_duration: safeValue('state.testDuration', 0),
    performance,
    resources,
    operations,
    errors: safeValue('metrics.error_count.values.count', 0),
    thresholds: {
      cpu: safeValue('metrics.harbor_cpu_usage.thresholds', {}),
      memory: safeValue('metrics.harbor_memory_usage.thresholds', {})
    }
  };

  //return {
  //  stdout: `REPORTE DE PRUEBA\n${JSON.stringify(report, null, 2)}`,
  //  'report.json': JSON.stringify(report, null, 2)
  //};
}