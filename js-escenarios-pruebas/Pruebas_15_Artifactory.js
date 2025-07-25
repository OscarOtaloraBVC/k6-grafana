import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { check, sleep } from 'k6';
import http from 'k6/http';
import exec from 'k6/x/exec';

// Configuración Artifactory
const ARTIFACTORY_URL = 'test-nuam-artifactory.coffeesoft.org';
const REPOSITORY_NAME = 'k6-prueba'; // Nombre del repositorio Docker en Artifactory
const IMAGE_NAME = 'ubuntu';
const IMAGE_TAG = 'latest';
const ARTIFACTORY_USER = 'admin';
const ARTIFACTORY_PASSWORD = 'Nuam123.*';

// Configuración Prometheus (opcional)
const PROMETHEUS_URL = 'http://localhost:9090';
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="artifactory"}[1m])) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="artifactory"}) / (1024*1024)';

// Variables globales
let authToken = null;
let finalMetrics = {
  cpu: null,
  memory: null,
  requests: 0,
  errors: 0
};

export const options = {
  stages: [
    //{ duration: '1m', target: 10 },  // Rampa inicial
    //{ duration: '3m', target: 50 },  // Carga sostenida
    { duration: '5m', target: 15 }    // Rampa descendente
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05']
  },
  teardownTimeout: '120s'
};

// Setup: Autenticación única al inicio
export function setup() {
  console.log('Realizando autenticación inicial...');
  try {
    const cmd = `docker login ${ARTIFACTORY_URL} -u ${ARTIFACTORY_USER} -p ${ARTIFACTORY_PASSWORD}`;
    exec.command('sh', ['-c', cmd]);
    return { success: true };
  } catch (error) {
    console.error('Error en autenticación:', error);
    return { success: false, error: error.message };
  }
}

// Función principal
export default function (data) {
  if (!data.success) {
    console.error('No se pudo autenticar, abortando prueba');
    return;
  }

  const uniqueTag = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const targetImage = `${ARTIFACTORY_URL}/${REPOSITORY_NAME}/${IMAGE_NAME}:${uniqueTag}`;
  
  try {
    // 1. Etiquetar imagen
    exec.command('docker', ['tag', `${IMAGE_NAME}:${IMAGE_TAG}`, targetImage]);
    
    // 2. Subir imagen
    const pushStart = Date.now();
    exec.command('docker', ['push', targetImage]);
    const pushDuration = (Date.now() - pushStart) / 1000;
    
    // 3. Registrar métricas
    finalMetrics.requests++;
    console.log(`Imagen ${targetImage} subida en ${pushDuration}s`);
    
    // 4. Limpieza opcional (descomentar si se desea)
    // exec.command('docker', ['rmi', targetImage]);
    
  } catch (error) {
    finalMetrics.errors++;
    console.error(`Error en VU ${__VU}, iteración ${__ITER}:`, error);
  }
  
  sleep(1); // Intervalo entre operaciones
}

// Teardown: Capturar métricas finales
export function teardown() {
  if (PROMETHEUS_URL) {
    try {
      const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`);
      const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`);
      
      if (cpuRes.status === 200 && cpuRes.json().data.result.length > 0) {
        finalMetrics.cpu = `${parseFloat(cpuRes.json().data.result[0].value[1]).toFixed(2)}%`;
      }
      
      if (memRes.status === 200 && memRes.json().data.result.length > 0) {
        finalMetrics.memory = `${parseFloat(memRes.json().data.result[0].value[1]).toFixed(2)} MB`;
      }
    } catch (error) {
      console.error('Error obteniendo métricas finales:', error);
    }
  }
}

// Generar reporte
export function handleSummary(data) {
  const summary = {
    ...data,
    artifactory_metrics: finalMetrics
  };

  return {
    'stdout': textSummary(summary, { indent: ' ', enableColors: true }),
    'artifactory_load_test.json': JSON.stringify(summary, null, 2)
  };
}