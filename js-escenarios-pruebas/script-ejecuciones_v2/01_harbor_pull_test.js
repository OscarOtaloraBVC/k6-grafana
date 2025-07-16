import http from 'k6/http';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate } from 'k6/metrics';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Configuración de Harbor
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';

// Configuración de Prometheus
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Métricas personalizadas
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');
const requestRate = new Rate('request_rate');
const responseTimes = new Trend('response_times');
let prometheusCpuMetrics = 'No recopilado';
let prometheusMemoryMetrics = 'No recopilado';

// Generador de imágenes aleatorias
function generateRandomImage() {
  const minSize = 28 * 1024 * 1024; // 28MB
  const maxSize = 50 * 1024 * 1024; // 50MB
  const size = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
  return new Uint8Array(size).map(() => Math.floor(Math.random() * 256));
}

// Autenticación en Harbor
function getAuthToken() {
  const credentials = `${USERNAME}:${PASSWORD}`;
  return encoding.b64encode(credentials);
}

// Obtener métricas de Prometheus
async function fetchPrometheusMetrics() {
  if (!PROMETHEUS_URL) return;

  try {
    // Obtener métricas de CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`);
    if (cpuRes.status === 200) {
      prometheusCpuMetrics = JSON.stringify(cpuRes.json().data.result, null, 2);
    }

    // Obtener métricas de memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`);
    if (memRes.status === 200) {
      prometheusMemoryMetrics = JSON.stringify(memRes.json().data.result, null, 2);
    }
  } catch (error) {
    console.error('Error fetching Prometheus metrics:', error);
  }
}

// Configuración de la prueba
export const options = {
  stages: [
    { duration: '4m', target: 5 },  // Rampa inicial
    //{ duration: '2m', target: 10 },  // Carga media
    //{ duration: '30s', target: 5 },  // Rampa de salida
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1']
  },
  teardownTimeout: '30s'
};

// Función principal de la prueba
export default async function () {
  const authToken = getAuthToken();
  const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const imageName = `${HARBOR_URL.split('://')[1]}/${PROJECT}/${IMAGE}:${randomTag}`;

  // Subir imagen
  const startTime = Date.now();
  try {
    const uploadRes = http.post(
      `${HARBOR_URL}/api/v2.0/projects/${PROJECT}/repositories/${IMAGE}/artifacts`,
      generateRandomImage(),
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Basic ${authToken}`
        },
        timeout: '120s'
      }
    );

    const duration = Date.now() - startTime;
    responseTimes.add(duration);
    requestRate.add(1);

    if (uploadRes.status === 201 || uploadRes.status === 202) {
      successfulRequests.add(1);
      
      // Eliminar imagen si está habilitado
      if (__ENV.K6_DOCKER_EXEC === 'true') {
        try {
          const cmd = `docker image rm ${imageName}`;
          exec(cmd, { output: null });
          console.log(`Deleted image: ${imageName}`);
        } catch (error) {
          console.error(`Error deleting image: ${error}`);
        }
      }
    } else {
      failedRequests.add(1);
      console.error(`Upload failed (${uploadRes.status}): ${uploadRes.body}`);
    }
  } catch (error) {
    failedRequests.add(1);
    console.error('Request failed:', error);
  }

  // Actualizar métricas de Prometheus periódicamente
  if (exec.scenario.iterationInTest % 10 === 0) {
    await fetchPrometheusMetrics();
  }

  sleep(1);
}

// Teardown - Obtener métricas finales de Prometheus
export function teardown() {
  fetchPrometheusMetrics();
}

// Generar resumen final
export function handleSummary(data) {
  // Calcular métricas básicas
  const duration = data.state.testRunDurationMs / 1000;
  const iterations = data.metrics.iterations.count;
  const successes = data.metrics.successful_requests.count;
  const failures = data.metrics.failed_requests.count;
  const successRate = iterations > 0 ? (successes / iterations * 100).toFixed(2) : 0;
  const avgResponseTime = data.metrics.response_times ? data.metrics.response_times.avg.toFixed(2) : 0;
  const rps = duration > 0 ? (iterations / duration).toFixed(2) : 0;

  // Crear resumen detallado
  const summary = {
    "Duración de la prueba": `${duration} segundos`,
    "Total de iteraciones": iterations,
    "Peticiones exitosas": successes,
    "Peticiones fallidas": failures,
    "Tasa de éxito": `${successRate}%`,
    "Tiempo de respuesta promedio": `${avgResponseTime} ms`,
    "Peticiones por segundo (RPS)": rps,
    "Uso de CPU (Prometheus)": prometheusCpuMetrics,
    "Uso de memoria (Prometheus)": prometheusMemoryMetrics
  };

  // Mostrar resumen en consola
  console.log("\n" + "=".repeat(60));
  console.log("RESUMEN FINAL DE LA PRUEBA");
  console.log("=".repeat(60));
  
  for (const [key, value] of Object.entries(summary)) {
    console.log(`• ${key.padEnd(30)}: ${value}`);
  }
  
  console.log("=".repeat(60) + "\n");

  return {
    "stdout": textSummary(data, { indent: " ", enableColors: true }),
    "summary.json": JSON.stringify(summary, null, 2)
  };
}