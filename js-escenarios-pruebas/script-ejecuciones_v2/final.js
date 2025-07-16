import http from 'k6/http';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate } from 'k6/metrics';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Configuración
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Almacenamiento para métricas de Prometheus
const prometheusData = {
  cpu: [],
  memory: [],
  lastUpdated: null
};

// Métricas personalizadas
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');
const responseTimes = new Trend('response_times');

// Función para obtener métricas de Prometheus
function fetchPrometheusMetrics() {
  if (!PROMETHEUS_URL || PROMETHEUS_URL === 'http://localhost:9090') return;

  try {
    // Obtener CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`);
    if (cpuRes.status === 200) {
      const data = cpuRes.json();
      if (data.status === "success") {
        prometheusData.cpu = data.data.result.map(r => ({
          container: r.metric.container,
          usage: `${parseFloat(r.value[1]).toFixed(2)}%`
        }));
      }
    }

    // Obtener Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`);
    if (memRes.status === 200) {
      const data = memRes.json();
      if (data.status === "success") {
        prometheusData.memory = data.data.result.map(r => ({
          container: r.metric.container,
          usage: `${parseFloat(r.value[1]).toFixed(2)} MB`
        }));
      }
    }
    
    prometheusData.lastUpdated = new Date().toISOString();
  } catch (error) {
    console.error('Error obteniendo métricas de Prometheus:', error);
  }
}

// Configuración de la prueba
export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '2m', target: 10 },
    { duration: '30s', target: 5 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1']
  },
  teardownTimeout: '60s'
};

// Función principal
export default function () {
  const authToken = encoding.b64encode(`${USERNAME}:${PASSWORD}`);
  const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  try {
    const start = Date.now();
    const res = http.post(
      `${HARBOR_URL}/api/v2.0/projects/${PROJECT}/repositories/${IMAGE}/artifacts`,
      new Uint8Array(30 * 1024 * 1024),
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Basic ${authToken}`
        },
        timeout: '120s'
      }
    );
    
    responseTimes.add(Date.now() - start);
    
    if (res.status === 201 || res.status === 202) {
      successfulRequests.add(1);
      if (__ENV.K6_DOCKER_EXEC === 'true') {
        try {
          exec(`docker image rm ${HARBOR_URL.split('://')[1]}/${PROJECT}/${IMAGE}:${randomTag}`, { output: null });
        } catch (error) {
          console.error('Error eliminando imagen:', error);
        }
      }
    } else {
      failedRequests.add(1);
      console.error('Request failed with status:', res.status, 'Response:', res.body);
    }
  } catch (error) {
    failedRequests.add(1);
    console.error('Request error:', error.message);
  }

  if (exec.scenario.iterationInTest % 10 === 0) {
    fetchPrometheusMetrics();
  }

  sleep(1);
}

// Teardown - Obtener métricas finales
export function teardown() {
  fetchPrometheusMetrics();
}

// Resumen final con manejo seguro de errores
export function handleSummary(data) {
  fetchPrometheusMetrics();

  // Obtener métricas directamente del escenario
  const iterations = exec.scenario.iterationInTest || 0;
  const duration = data.state ? (data.state.testRunDurationMs / 1000) : 0;
  
  // Obtener métricas personalizadas directamente
  const successes = successfulRequests.values['count'] || 0;
  const failures = failedRequests.values['count'] || 0;
  const successRate = iterations > 0 ? (successes / iterations * 100).toFixed(2) : 0;
  
  // Obtener tiempos de respuesta
  const responseData = responseTimes.values || {};
  const avgResponseTime = responseData.avg ? responseData.avg.toFixed(2) : 0;
  const rps = duration > 0 ? (iterations / duration).toFixed(2) : 0;

  const formatPrometheus = (data) => {
    if (!Array.isArray(data) || data.length === 0) return 'No disponible';
    return data.map(item => `  ${item.container.padEnd(10)}: ${item.usage}`).join('\n');
  };

  const summaryText = `
============================== RESUMEN FINAL ==============================
Duración:          ${duration} segundos
Iteraciones:       ${iterations}
Peticiones exitosas: ${successes}
Peticiones fallidas: ${failures}
Tasa de éxito:     ${successRate}%
Tiempo respuesta:  ${avgResponseTime} ms (avg)
Peticiones/seg:    ${rps}

Uso de CPU:
${formatPrometheus(prometheusData.cpu)}

Uso de Memoria:
${formatPrometheus(prometheusData.memory)}

Última actualización: ${prometheusData.lastUpdated || 'N/A'}
=======================================================================
`;

  console.log(summaryText);

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    "summary.txt": summaryText
  };
}