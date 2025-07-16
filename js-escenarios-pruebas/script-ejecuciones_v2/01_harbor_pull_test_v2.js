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

// Variables para almacenar métricas
let prometheusMetrics = {
  cpu: [],
  memory: [],
  lastUpdated: null
};

// Métricas personalizadas
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');
const responseTimes = new Trend('response_times');

// Función para obtener métricas de Prometheus de forma síncrona
function fetchPrometheusMetricsSync() {
  if (!PROMETHEUS_URL || PROMETHEUS_URL === 'http://localhost:9090') {
    return;
  }

  try {
    // Obtener métricas de CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`);
    if (cpuRes.status === 200) {
      const cpuData = cpuRes.json();
      if (cpuData.status === "success") {
        prometheusMetrics.cpu = cpuData.data.result.map(r => ({
          container: r.metric.container,
          usage: `${parseFloat(r.value[1]).toFixed(2)}%`
        }));
      }
    }

    // Obtener métricas de Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`);
    if (memRes.status === 200) {
      const memData = memRes.json();
      if (memData.status === "success") {
        prometheusMetrics.memory = memData.data.result.map(r => ({
          container: r.metric.container,
          usage: `${parseFloat(r.value[1]).toFixed(2)} MB`
        }));
      }
    }
    
    prometheusMetrics.lastUpdated = new Date().toISOString();
  } catch (error) {
    console.error('Error fetching Prometheus metrics:', error);
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
  teardownTimeout: '60s' // Aumentamos el timeout del teardown
};

// Función principal
export default function () {
  const authToken = encoding.b64encode(`${USERNAME}:${PASSWORD}`);
  const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  try {
    const start = Date.now();
    const res = http.post(
      `${HARBOR_URL}/api/v2.0/projects/${PROJECT}/repositories/${IMAGE}/artifacts`,
      new Uint8Array(30 * 1024 * 1024), // 30MB
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
    }
  } catch (error) {
    failedRequests.add(1);
  }

  // Actualizar métricas cada 10 iteraciones
  if (exec.scenario.iterationInTest % 10 === 0) {
    fetchPrometheusMetricsSync();
  }

  sleep(1);
}

// Teardown - Obtener métricas finales
export function teardown() {
  fetchPrometheusMetricsSync();
}

// Resumen final mejorado
export function handleSummary(data) {
  // Asegurarse de tener las métricas más recientes
  fetchPrometheusMetricsSync();

  // Función para manejar métricas potencialmente no definidas
  const safeMetric = (metric, prop = 'count', defaultValue = 0) => {
    return data.metrics[metric] ? (data.metrics[metric][prop] || defaultValue) : defaultValue;
  };

  // Calcular métricas básicas
  const duration = data.state ? (data.state.testRunDurationMs / 1000) : 0;
  const iterations = safeMetric('iterations');
  const successes = safeMetric('successful_requests');
  const failures = safeMetric('failed_requests');
  const successRate = iterations > 0 ? (successes / iterations * 100).toFixed(2) : 0;
  const avgResponseTime = safeMetric('response_times', 'avg', 0).toFixed(2);
  const rps = duration > 0 ? (iterations / duration).toFixed(2) : 0;

  // Formatear métricas de Prometheus
  const formatPrometheus = (data) => {
    if (!Array.isArray(data) || data.length === 0) return 'No disponible';
    return data.map(item => `${item.container}: ${item.usage}`).join('\n           ');
  };

  // Crear resumen completo
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
${formatPrometheus(prometheusMetrics.cpu)}

Uso de Memoria:
${formatPrometheus(prometheusMetrics.memory)}

Última actualización: ${prometheusMetrics.lastUpdated || 'N/A'}
=======================================================================
`;

  // Mostrar en consola
  console.log(summaryText);

  // También devolver el resumen estándar de k6
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    "summary.txt": summaryText
  };
}