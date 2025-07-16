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

// Métricas personalizadas - USAREMOS SOLO ESTAS PARA EL RESUMEN
const successfulUploads = new Counter('successful_uploads');
const failedUploads = new Counter('failed_uploads');
const uploadTimes = new Trend('upload_times');
const totalIterations = new Counter('total_iterations');

// Almacenamiento para métricas de Prometheus
const prometheusData = {
  cpu: [],
  memory: [],
  lastUpdated: null
};

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
  scenarios: {
    harbor_stress: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '2m', target: 10 },
        { duration: '30s', target: 5 }
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000'],
    'http_req_failed': ['rate<0.1'],
    'successful_uploads': ['count>0'],
    'failed_uploads': ['count<20']
  },
  teardownTimeout: '60s',
  discardResponseBodies: true
};

// Función principal
export default function () {
  totalIterations.add(1); // Contamos cada iteración
  
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
    
    const duration = Date.now() - start;
    uploadTimes.add(duration);
    
    if (res.status === 201 || res.status === 202) {
      successfulUploads.add(1);
      if (__ENV.K6_DOCKER_EXEC === 'true') {
        try {
          exec(`docker image rm ${HARBOR_URL.split('://')[1]}/${PROJECT}/${IMAGE}:${randomTag}`, { output: null });
        } catch (error) {
          console.error('Error eliminando imagen:', error);
        }
      }
    } else {
      failedUploads.add(1);
      console.error(`Error en la petición (${res.status}): ${res.body}`);
    }
  } catch (error) {
    failedUploads.add(1);
    console.error('Error en la ejecución:', error.message);
  }

  // Actualizar métricas cada 10 iteraciones
  if (exec.scenario.iterationInTest % 10 === 0) {
    fetchPrometheusMetrics();
  }

  sleep(1);
}

// Teardown - Obtener métricas finales
export function teardown() {
  fetchPrometheusMetrics();
}

// Resumen final usando solo nuestras métricas personalizadas
export function handleSummary() {
  // Asegurarse de tener las métricas más recientes
  fetchPrometheusMetrics();

  // Obtener métricas directamente de nuestros contadores
  const iterations = totalIterations.count || 0;
  const successes = successfulUploads.count || 0;
  const failures = failedUploads.count || 0;
  const duration = exec.scenario.duration / 1000; // en segundos
  
  // Calcular métricas derivadas
  const successRate = iterations > 0 ? (successes / iterations * 100).toFixed(2) : 0;
  const avgUploadTime = uploadTimes.count > 0 ? (uploadTimes.sum / uploadTimes.count).toFixed(2) : 0;
  const rps = duration > 0 ? (iterations / duration).toFixed(2) : 0;

  // Formatear métricas de Prometheus
  const formatPrometheus = (data) => {
    if (!Array.isArray(data) || data.length === 0) return '  No disponible';
    return data.map(item => `  ${item.container.padEnd(8)}: ${item.usage}`).join('\n');
  };

  // Crear resumen completo
  const summaryText = `
============================== RESUMEN FINAL ==============================
Duración:          ${duration.toFixed(2)} segundos
Iteraciones:       ${iterations}
Subidas exitosas:  ${successes}
Subidas fallidas:  ${failures}
Tasa de éxito:     ${successRate}%
Tiempo subida avg: ${avgUploadTime} ms
Iteraciones/seg:   ${rps}

Uso de CPU:
${formatPrometheus(prometheusData.cpu)}

Uso de Memoria:
${formatPrometheus(prometheusData.memory)}

Última actualización: ${prometheusData.lastUpdated || 'N/A'}
=======================================================================
`;

  // Mostrar en consola
  console.log(summaryText);

  // También devolver el resumen estándar de k6
  return {
    stdout: textSummary({ 
      metrics: {
        total_iterations: { value: iterations },
        successful_uploads: { value: successes },
        failed_uploads: { value: failures },
        upload_times: { 
          avg: avgUploadTime,
          min: uploadTimes.min || 0,
          max: uploadTimes.max || 0,
          med: uploadTimes.med || 0,
          p90: uploadTimes.p(90) || 0,
          p95: uploadTimes.p(95) || 0
        }
      }
    }, { indent: ' ', enableColors: true }),
    "summary.txt": summaryText
  };
}