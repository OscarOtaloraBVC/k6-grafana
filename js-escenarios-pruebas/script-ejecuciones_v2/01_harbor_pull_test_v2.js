import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

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

// Función para autenticación en Harbor
function harborAuthenticate() {
  const url = `${HARBOR_URL}/c/login`;
  const payload = JSON.stringify({
    principal: USERNAME,
    password: PASSWORD
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  return http.post(url, payload, params);
}

// Función para pull de imagen
function harborPullImage(project, image, tag) {
  const url = `${HARBOR_URL}/v2/${project}/${image}/manifests/${tag}`;
  const params = {
    headers: {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
    },
    auth: 'basic',
  };
  
  return http.get(url, params);
}

// Función para obtener métricas de Prometheus
function getPrometheusMetrics(query) {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = http.get(url);
  
  if (res.status === 200) {
    try {
      return JSON.parse(res.body).data.result;
    } catch (e) {
      console.error('Error parsing Prometheus response:', e);
      return null;
    }
  } else {
    console.error('Error fetching Prometheus metrics:', res.status, res.body);
    return null;
  }
}

// Función para eliminar imagen Docker local
function deleteLocalImage() {
  const imageRef = `${HARBOR_URL}/${PROJECT}/${IMAGE}:${TAG}`;
  try {
    // Esto es un ejemplo, en k6 puro no podemos ejecutar comandos shell directamente
    // En una implementación real necesitarías usar k6/execution o un módulo externo
    console.log(`[SIMULACIÓN] Eliminando imagen local: docker image rm ${imageRef}`);
    return true;
  } catch (error) {
    console.error('Error eliminando imagen local:', error);
    return false;
  }
}

// Función principal de la prueba
export default function () {
  // Paso 1: Autenticación en Harbor
  const authRes = harborAuthenticate();
  check(authRes, {
    'Autenticación exitosa': (r) => r.status === 200,
  });

  // Paso 2: Pull de la imagen
  const pullRes = harborPullImage(PROJECT, IMAGE, TAG);
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
  const cpuMetrics = getPrometheusMetrics(CPU_QUERY);
  const memoryMetrics = getPrometheusMetrics(MEMORY_QUERY);
  
  console.log('\n--- Métricas de Harbor ---');
  if (cpuMetrics) {
    console.log('Uso de CPU (%):', JSON.stringify(cpuMetrics, null, 2));
  }
  if (memoryMetrics) {
    console.log('Uso de Memoria (MB):', JSON.stringify(memoryMetrics, null, 2));
  }

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