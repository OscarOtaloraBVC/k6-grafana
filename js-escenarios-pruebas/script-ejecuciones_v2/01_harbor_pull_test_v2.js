import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { HarborClient } from './modules/harbor.js'; // Asumiendo que tienes un módulo Harbor client
import { PrometheusClient } from './modules/prometheus.js'; // Asumiendo que tienes un módulo Prometheus client

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';
const TEST_DURATION = __ENV.TEST_DURATION || '5m';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Configuración de la prueba
export const options = {
  scenarios: {
    harbor_load: {
      executor: 'constant-arrival-rate',
      rate: 20, // 20 iteraciones por segundo
      timeUnit: '1s',
      duration: TEST_DURATION,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% de las solicitudes deben ser menores a 500ms
    http_req_failed: ['rate<0.01'], // Menos del 1% de errores
  },
};

// Clientes
const harbor = new HarborClient(HARBOR_URL, USERNAME, PASSWORD);
const prometheus = new PrometheusClient(PROMETHEUS_URL);

// Función para obtener métricas de Prometheus
async function getMetrics() {
  try {
    const cpuMetrics = await prometheus.query(CPU_QUERY);
    const memoryMetrics = await prometheus.query(MEMORY_QUERY);
    
    console.log('--- Métricas de Harbor ---');
    console.log('Uso de CPU (%):', JSON.stringify(cpuMetrics, null, 2));
    console.log('Uso de Memoria (MB):', JSON.stringify(memoryMetrics, null, 2));
  } catch (error) {
    console.error('Error obteniendo métricas:', error);
  }
}

// Función para eliminar imagen Docker local
function deleteLocalImage() {
  try {
    const imageRef = `${HARBOR_URL}/${PROJECT}/${IMAGE}:${TAG}`;
    const cmd = `docker image rm ${imageRef}`;
    const result = exec(cmd, { output: 'inherit' });
    
    if (result.exit_code !== 0) {
      console.warn(`No se pudo eliminar la imagen ${imageRef}`);
    } else {
      console.log(`Imagen ${imageRef} eliminada localmente`);
    }
  } catch (error) {
    console.error('Error eliminando imagen local:', error);
  }
}

// Función principal de la prueba
export default async function () {
  // Paso 1: Autenticación en Harbor
  const authRes = harbor.authenticate();
  check(authRes, {
    'Autenticación exitosa': (r) => r.status === 200,
  });

  // Paso 2: Pull de la imagen
  const pullRes = harbor.pullImage(PROJECT, IMAGE, TAG);
  check(pullRes, {
    'Pull de imagen exitoso': (r) => r.status === 200,
  });

  // Paso 3: Eliminar imagen local (simulando ciclo de vida)
  if (__ITER % 10 === 0) { // Cada 10 iteraciones
    deleteLocalImage();
  }

  // Pequeña pausa entre operaciones
  sleep(0.1);
}

// Función de manejo de resumen
export function handleSummary(data) {
  // Obtener métricas finales de Prometheus
  getMetrics();

  // Resumen estándar de K6
  const summary = {
    duration: data.metrics.http_req_duration.values.avg.toFixed(2) + 'ms',
    requests_per_second: (data.metrics.http_reqs.values.rate || 0).toFixed(2),
    failed_requests: (data.metrics.http_req_failed.values.passes || 0),
    checks: data.root_group.checks,
  };

  console.log('\n--- Resumen de la Prueba ---');
  console.log(`- Duración promedio de solicitudes: ${summary.duration}`);
  console.log(`- Peticiones por segundo: ${summary.requests_per_second}`);
  console.log(`- Solicitudes fallidas: ${summary.failed_requests}`);
  console.log('- Checks:', summary.checks);

  return {
    'stdout': 'Resumen de prueba impreso en consola',
  };
}