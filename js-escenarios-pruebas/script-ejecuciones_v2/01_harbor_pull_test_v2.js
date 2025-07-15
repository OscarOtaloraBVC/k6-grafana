// k6 script for testing Harbor Docker registry with enhanced metrics and error handling
import http from 'k6/http';
import { check, sleep } from 'k6';
import { exec } from 'k6/execution';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// Métricas mejoradas
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

// Consultas Prometheus específicas
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Función segura para ejecutar comandos Docker
function runCommand(cmd, operation) {
  const start = Date.now();
  let success = false;
  let output = '';

  try {
    // Ejecutar comando Docker usando exec de k6
    const result = exec(cmd, { timeout: '30s' });
    
    if (result && result.exit_status !== undefined) {
      success = result.exit_status === 0;
      output = result.stdout || result.stderr || '';
      if (success) {
        successCount.add(1, { operation });
      } else {
        errorCount.add(1, { operation });
        console.error(`Error en ${operation}: ${output}`);
      }
    } else {
      throw new Error('Resultado del comando no es válido');
    }
  } catch (e) {
    errorCount.add(1, { operation });
    output = e.message || 'Error desconocido';
    console.error(`Error en ${operation}: ${output}`);
  }

  const duration = (Date.now() - start) / 1000;
  operationDuration.add(duration, { operation });

  return { success, duration, output };
}

// Función para obtener métricas de Harbor
function getHarborMetrics() {
  const metrics = {
    cpu: { core: 0, registry: 0 },
    memory: { core: 0, registry: 0 }
  };

  try {
    // Consultar CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`, {
      timeout: '10s',
      tags: { query: 'cpu_usage' }
    });

    if (cpuRes && cpuRes.status === 200) {
      const data = cpuRes.json();
      if (data?.data?.result) {
        data.data.result.forEach(item => {
          const value = parseFloat(item.value?.[1]) || 0;
          if (item.metric?.container.includes('core')) metrics.cpu.core = value;
          if (item.metric?.container.includes('registry')) metrics.cpu.registry = value;
        });
      }
    } else {
      console.error(`Error en consulta CPU: ${cpuRes?.status || 'No response'}`);
    }

    // Consultar Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`, {
      timeout: '10s',
      tags: { query: 'memory_usage' }
    });

    if (memRes && memRes.status === 200) {
      const data = memRes.json();
      if (data?.data?.result) {
        data.data.result.forEach(item => {
          const value = parseFloat(item.value?.[1]) || 0;
          if (item.metric?.container.includes('core')) metrics.memory.core = value;
          if (item.metric?.container.includes('registry')) metrics.memory.registry = value;
        });
      }
    } else {
      console.error(`Error en consulta Memoria: ${memRes?.status || 'No response'}`);
    }

  } catch (e) {
    errorCount.add(1);
    console.error(`Error obteniendo métricas: ${e.message}`);
  }

  return metrics;
}

// Función principal
export default function () {
  // 1. Obtener métricas de Harbor
  const metrics = getHarborMetrics();
  harborCPU.add(metrics.cpu.core, { component: 'core' });
  harborCPU.add(metrics.cpu.registry, { component: 'registry' });
  harborMemory.add(metrics.memory.core, { component: 'core' });
  harborMemory.add(metrics.memory.registry, { component: 'registry' });

  // 2. Login a Harbor
  const loginResult = runCommand(
    `docker login ${HARBOR_URL} -u ${USERNAME} -p ${PASSWORD}`,
    'login'
  );

  // 3. Operación Docker Pull (solo si login fue exitoso)
  let pullResult = { success: false, duration: 0 };
  if (loginResult.success) {
    pullResult = runCommand(
      `docker pull ${HARBOR_URL}/${IMAGE_NAME}`,
      'pull'
    );
  }

  // 4. Operación Docker RM (solo si pull fue exitoso)
  let rmResult = { success: false, duration: 0 };
  if (pullResult.success) {
    rmResult = runCommand(
      `docker rmi ${HARBOR_URL}/${IMAGE_NAME}`,
      'rm'
    );
  }

  // 5. Registrar métricas y checks
  requestRate.add(1);
  check({
    loginSuccess: loginResult.success,
    pullSuccess: pullResult.success,
    rmSuccess: rmResult.success,
    cpuUsage: metrics.cpu.core,
    memoryUsage: metrics.memory.core
  }, {
    'docker login succeeded': (r) => r.loginSuccess,
    'docker pull succeeded': (r) => r.pullSuccess,
    'docker rm succeeded': (r) => r.rmSuccess,
    'cpu under threshold': (r) => r.cpuUsage < 80,
    'memory under threshold': (r) => r.memoryUsage < 4096,
  });

  sleep(1);
}

// Función de resumen completo en consola
export function handleSummary(data) {
  // Función para obtener valores de forma segura
  const getValue = (path, defaultValue = 0) => {
    try {
      return path.split('.').reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : defaultValue), data) || defaultValue;
    } catch {
      return defaultValue;
    }
  };

  // Calcular porcentaje de éxito
  const totalChecks = getValue('metrics.checks.values.count', 1);
  const passedChecks = getValue('metrics.checks.values.passes', 0);
  const successRate = totalChecks > 0 ? (passedChecks / totalChecks * 100).toFixed(2) : '0.00';

  // Obtener métricas de recursos
  const cpuCore = getValue('metrics.harbor_cpu_usage.values["component=core"].avg', 0).toFixed(2);
  const cpuRegistry = getValue('metrics.harbor_cpu_usage.values["component=registry"].avg', 0).toFixed(2);
  const memCore = getValue('metrics.harbor_memory_usage.values["component=core"].avg', 0).toFixed(2);
  const memRegistry = getValue('metrics.harbor_memory_usage.values["component=registry"].avg', 0).toFixed(2);

  // Obtener métricas de rendimiento
  const avgDuration = getValue('metrics.operation_duration.values.avg', 0).toFixed(3);
  const p95Duration = getValue('metrics.operation_duration.values.p95', 0).toFixed(3);
  const reqRate = getValue('metrics.requests_per_second.values.rate', 0).toFixed(2);

  // Construir resumen legible
  const summary = `
╔══════════════════════════════════════════════╗
║           RESUMEN DE PRUEBA HARBOR           ║
╠══════════════════════════════════════════════╣
║ • DURACIÓN TOTAL: ${(getValue('state.testDuration', 0) / 1000000000).toFixed(0)} segundos
║ • TASA DE ÉXITO: ${successRate}%
║ • ERRORES: ${getValue('metrics.error_count.values.count', 0)}
╠══════════════════════════════════════════════╣
║            MÉTRICAS DE RECURSOS              ║
╠══════════════════════════════════════════════╣
║ • CPU CORE: ${cpuCore}% (máx: ${getValue('metrics.harbor_cpu_usage.values["component=core"].max', 0).toFixed(2)}%)
║ • CPU REGISTRY: ${cpuRegistry}% (máx: ${getValue('metrics.harbor_cpu_usage.values["component=registry"].max', 0).toFixed(2)}%)
║ • MEMORIA CORE: ${memCore} MB (máx: ${getValue('metrics.harbor_memory_usage.values["component=core"].max', 0).toFixed(2)} MB)
║ • MEMORIA REGISTRY: ${memRegistry} MB (máx: ${getValue('metrics.harbor_memory_usage.values["component=registry"].max', 0).toFixed(2)} MB)
╠══════════════════════════════════════════════╣
║            MÉTRICAS DE RENDIMIENTO           ║
╠══════════════════════════════════════════════╣
║ • PETICIONES/SEG: ${reqRate}
║ • TIEMPO RESPUESTA (avg): ${avgDuration}s
║ • TIEMPO RESPUESTA (p95): ${p95Duration}s
╠══════════════════════════════════════════════╣
║            RESULTADOS DE OPERACIONES         ║
╠══════════════════════════════════════════════╣
║ • LOGIN EXITOSO: ${getValue('metrics.success_count.values["operation=login"].count', 0)}
║ • PULL EXITOSO: ${getValue('metrics.success_count.values["operation=pull"].count', 0)}
║ • RM EXITOSO: ${getValue('metrics.success_count.values["operation=rm"].count', 0)}
╚══════════════════════════════════════════════╝
`;

  return { stdout: summary };
}