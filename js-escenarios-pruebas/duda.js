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

// Consultas Prometheus separadas
const CPU_CORE_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container="core"}[1m])) by (container) * 100'; 
const CPU_REGISTRY_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container="registry"}[1m])) by (container) * 100';

const MEMORY_CORE_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container="core"}) by (container) / (1024*1024)';
const MEMORY_REGISTRY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container="registry"}) by (container) / (1024*1024)';

// Almacenamiento para métricas de Prometheus usando SharedArray para acceso entre VUs
const prometheusData = new SharedArray('prometheus_metrics', () => [{
  cpu: [],
  memory: [],
  lastUpdated: null
}]);

// Contador de iteraciones por VU
let iterationCounter = 0;

// Función para obtener y actualizar métricas de Prometheus
function fetchPrometheusMetrics() {
  if (!PROMETHEUS_URL) return;

  const currentData = { cpu: [], memory: [], lastUpdated: null };

  try {
    // Consultas CPU
    const cpuCoreRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_CORE_QUERY)}`);
    const cpuRegistryRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_REGISTRY_QUERY)}`);
    
    // Procesar resultados CPU
    if (cpuCoreRes.status === 200) {
      const data = cpuCoreRes.json();
      if (data.status === "success" && data.data.result.length > 0) {
        currentData.cpu.push({
          container: 'core',
          usage: `${parseFloat(data.data.result[0].value[1]).toFixed(2)}%`
        });
      }
    }
    
    if (cpuRegistryRes.status === 200) {
      const data = cpuRegistryRes.json();
      if (data.status === "success" && data.data.result.length > 0) {
        currentData.cpu.push({
          container: 'registry',
          usage: `${parseFloat(data.data.result[0].value[1]).toFixed(2)}%`
        });
      }
    }

    // Consultas Memoria
    const memCoreRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_CORE_QUERY)}`);
    const memRegistryRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_REGISTRY_QUERY)}`);
    
    // Procesar resultados Memoria
    if (memCoreRes.status === 200) {
      const data = memCoreRes.json();
      if (data.status === "success" && data.data.result.length > 0) {
        currentData.memory.push({
          container: 'core',
          usage: `${parseFloat(data.data.result[0].value[1]).toFixed(2)} MB`
        });
      }
    }
    
    if (memRegistryRes.status === 200) {
      const data = memRegistryRes.json();
      if (data.status === "success" && data.data.result.length > 0) {
        currentData.memory.push({
          container: 'registry',
          usage: `${parseFloat(data.data.result[0].value[1]).toFixed(2)} MB`
        });
      }
    }
    
    currentData.lastUpdated = new Date().toISOString();
    prometheusData[0] = currentData;

  } catch (error) {
    console.error('Error obteniendo métricas de Prometheus:', error);
  }
}

export const options = {
  stages: [
    { duration: '1m', target: 10 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1']
  },
  teardownTimeout: '60s'
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
    iterationCounter++;
    
    if (!dockerLogin()) {
        check(false, { 'docker login failed': false });
        return;
    }
        
    const uniqueTag = image_tag_prefix + '-' + new Date().getTime();
    const fullImageName = `${HARBOR_URL}/${PROJECT_NAME}/ubuntu/${new Date().getTime()}/${IMAGE_NAME}:${uniqueTag}`;
    const sourceImage = `${IMAGE_NAME}:latest`;
 
    console.log(`Pushing image: ${fullImageName} from source: ${sourceImage}`);
 
    try {
        console.log(`Tagging image: ${fullImageName} from source: ${sourceImage}`);
        exec.command('docker', ['tag', sourceImage, fullImageName]);
    } catch (error) {
        console.error(`Error tagging image: ${error}`);
        check(false, { 'exception during docker push': false });
    }
 
    try {
        console.log(`Pushing image: ${fullImageName} to Harbor`);
        exec.command('docker', ['push', fullImageName]);
    } catch (error) {
        console.error(`Error pushing image: ${error}`);
        check(false, { 'exception during docker push': false });
    }
 
    sleep(5);

    // Obtener métricas cada 5 iteraciones
    if (iterationCounter % 5 === 0) {
        fetchPrometheusMetrics();
    }
}

export function teardown() {
  // Forzar una última actualización de métricas
  fetchPrometheusMetrics();
}

export function handleSummary(data) {
  // Obtener los datos más recientes
  const finalMetrics = prometheusData[0];

  const duration = data.state ? (data.state.testRunDurationMs / 1000 / 60) : 0;
  const durationInMinutes = duration.toFixed(2);
  
  const formatPrometheus = (metrics) => {
    if (!Array.isArray(metrics) || metrics.length === 0) return '  No disponible';
    return metrics.map(item => `  ${item.container.padEnd(10)}: ${item.usage}`).join('\n');
  };

  const summaryText = `
============================== RESUMEN =================================
Duración:          ${durationInMinutes} minutos
Última actualización: ${finalMetrics.lastUpdated || 'No disponible'}

Uso de CPU Harbor:
${formatPrometheus(finalMetrics.cpu)}

Uso de Memoria Harbor:
${formatPrometheus(finalMetrics.memory)}

=======================================================================
`;

  console.log(summaryText);
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    "summary.txt": summaryText
  };
}