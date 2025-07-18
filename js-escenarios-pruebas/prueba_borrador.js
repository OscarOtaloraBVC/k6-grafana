import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { check, sleep } from 'k6';
import http from 'k6/http';
import exec from 'k6/x/exec';

const HARBOR_URL = 'test-nuam-registry.coffeesoft.org';
const PROJECT_NAME = 'library';
const IMAGE_NAME = 'ubuntu';
const image_tag_prefix = 'latest';
const PROMETHEUS_URL = 'http://localhost:9090'; 

const HARBOR_USER = 'admin';
const HARBOR_PASSWORD = 'r7Y5mQBwsM2lIj0';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Almacenamiento para métricas de Prometheus
const prometheusData = {
  cpu: [],
  memory: [],
  lastUpdated: null
};

// Global variable to store Prometheus metrics across VUs (needs careful handling for aggregation)
// For simplicity, we'll just store the last fetched value here,
// but for true aggregation, you'd need custom metrics.
//let globalPrometheusMetrics = {
//    cpu: [],
//    memory: [],
//    lastUpdated: null
//};

// Función para obtener métricas de Prometheus
function fetchPrometheusMetrics() {
  if (!PROMETHEUS_URL) return;

  try {
    // Consulta CPU
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

    // Consulta Memoria
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
    // Update global metrics for the summary
    //**globalPrometheusMetrics = { ...prometheusData };

  } catch (error) {
    console.error('Error obteniendo métricas de Prometheus:', error);
  }
}

// Configuración iteraciones de la prueba
export const options = {
  stages: [
    { duration: '1m', target: 10 }   
    //{ duration: '1m15s', target: 50 },
    //{ duration: '1m15s', target: 25 },
    //{ duration: '1m15s', target: 15 },
    //{ duration: '1m15s', target: 10 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1']
  },
  teardownTimeout: '60s' // Tiempo máximo para la fase de limpieza
};

function dockerLogin() {
    try {
        console.log(`Authenticating with Harbor registry...`);
        const cmd = `docker login ${HARBOR_URL} -u ${HARBOR_USER} -p ${HARBOR_PASSWORD}`;
        exec.command('sh', ['-c', cmd]);
        return true;
    } catch (error) {
        console.error(`Error during Docker login: ${error}`);
        return false;
    }
}

export default function () {
    // Autenticación por cada usuario virtual (VU)
    if (!dockerLogin()) {
        check(false, { 'docker login failed': false });
        return;
    }
        
    const uniqueTag = image_tag_prefix + '-' + new Date().getTime();
  
    const fullImageName =  HARBOR_URL+'/' +PROJECT_NAME +'/ubuntu/'+new Date().getTime() + '/' + IMAGE_NAME + ':' + uniqueTag;
    const sourceImage = IMAGE_NAME + ':latest';
 
    console.log(`Pushing image: ${fullImageName} from source: ${sourceImage}`);
 
    try {
        console.log(`Tagging image: ${fullImageName} from source: ${sourceImage}`);
        exec.command('docker', ['tag', sourceImage, fullImageName]);
    } catch (error) {
        console.error(`Error tagging image: ${error}`);
        check(false,{ 'exception during docker push': false });
    }
 
    try {
        console.log(`Pushing image: ${fullImageName} to Harbor`);
        exec.command('docker', ['push', fullImageName]);
    } catch (error) {
        console.error(`Error pushing image: ${error}`);
        check(false,{ 'exception during docker push': false });
    }
 
    sleep(5); // Simula tiempo de procesamiento


    if (exec.scenario.iterationInTest  % 1 === 0) { // Fetch metrics every 5 iterations from VU 1
        fetchPrometheusMetrics();
    }
}

 //Obtener métricas finales 
export function teardown() {
  fetchPrometheusMetrics(); 
}

// Resumen final 
export function handleSummary(data) {
 
  //*****const finalPrometheusData = globalPrometheusMetrics;

  // Función para manejar métricas no definidas
  const safeMetric = (metric, prop = 'count', defaultValue = 0) => {
    if (!data.metrics || !data.metrics[metric]) return defaultValue;
    return data.metrics[metric][prop] || defaultValue;
  };

  // Calcular métricas básicas
  const duration = data.state ? (data.state.testRunDurationMs / 1000) : 0;
  const durationInMinutes = (duration / 60).toFixed(2);
  
  // Formatear métricas de Prometheus
  const formatPrometheus = (metrics) => {
    if (!Array.isArray(metrics) || metrics.length === 0) return 'No disponible';
    return metrics.map(item => `  ${item.container.padEnd(10)}: ${item.usage}`).join('\n');
  };

  // Resumen
  const summaryText = `
============================== RESUMEN =================================
Duración:          ${durationInMinutes} minutos

Uso de CPU Harbor:
${formatPrometheus(finalPrometheusData.cpu)}

Uso de Memoria Harbor:
${formatPrometheus(finalPrometheusData.memory)}

=======================================================================
`;

  // Mostrar en consola
  console.log(summaryText);
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    "summary.txt": summaryText
  };
}