import http from 'k6/http';
import { check, sleep } from 'k6';
import { Harbor } from 'k6/x/harbor';
import exec from 'k6/execution';
import { Counter, Trend, Rate } from 'k6/metrics';

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';  
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';

// Consultas Prometheus específicas
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Métricas personalizadas
let successfulRequests = new Counter('successful_requests');
let failedRequests = new Counter('failed_requests');
let requestRate = new Rate('request_rate');
let responseTimes = new Trend('response_times');

// Generador de imágenes aleatorias
function generateRandomImage() {
  const minSize = 28 * 1024 * 1024; // 28MB en bytes
  const maxSize = 50 * 1024 * 1024; // 50MB en bytes
  const size = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
  
  // Generar datos binarios aleatorios
  return new Array(size).fill(0).map(() => Math.floor(Math.random() * 256));
}

// Función para obtener métricas de Prometheus
async function getPrometheusMetrics(query) {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = http.get(url);
  
  if (res.status === 200) {
    return JSON.parse(res.body).data.result;
  }
  return null;
}

// Configuración
export let options = {
  stages: [
    { duration: '1s', target: 50 },
    { duration: '5m', target: 50 }, // 5 minutos de prueba
    { duration: '1s', target: 0 },
  ],
  noConnectionReuse: true,
  thresholds: {
    http_req_duration: ['p(95)<3500'],
    http_req_failed: [
      { threshold: 'rate<0.1', abortOnFail: true },
      { threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '10s' }
    ],
  },
};

// Función para eliminar imágenes Docker
function deleteDockerImage(imageName) {
  try {
    const cmd = `docker image rm ${imageName}`;
    const result = exec(cmd);
    console.log(`Deleted image: ${imageName} - ${result}`);
  } catch (error) {
    console.error(`Error deleting image ${imageName}: ${error}`);
  }
}

export default async function () {
  // Autenticación en Harbor
  const authRes = http.post(`${HARBOR_URL}/c/login`, {
    principal: USERNAME,
    password: PASSWORD
  });
  
  if (!authRes.cookies['sid']) {
    failedRequests.add(1);
    return;
  }
  
  const cookies = {
    sid: authRes.cookies['sid'][0].value
  };
  
  // Generar y subir imagen
  const randomImage = generateRandomImage();
  const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const imageName = `${PROJECT}/${IMAGE}:${randomTag}`;
  
  const startTime = new Date().getTime();
  const uploadRes = http.post(
    `${HARBOR_URL}/api/v2.0/projects/${PROJECT}/repositories/${IMAGE}/artifacts`,
    { file: randomImage },
    {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      cookies: cookies
    }
  );
  
  const endTime = new Date().getTime();
  const duration = endTime - startTime;
  
  responseTimes.add(duration);
  requestRate.add(1);
  
  if (uploadRes.status === 201) {
    successfulRequests.add(1);
    
    // Eliminar la imagen después de subirla
    deleteDockerImage(imageName);
  } else {
    failedRequests.add(1);
    console.error(`Failed to upload image: ${uploadRes.status} - ${uploadRes.body}`);
  }
  
  // Obtener métricas de Prometheus periódicamente
  if (exec.scenario.iterationInTest % 10 === 0) {
    const cpuMetrics = await getPrometheusMetrics(CPU_QUERY);
    const memoryMetrics = await getPrometheusMetrics(MEMORY_QUERY);
    
    console.log('--- Métricas de Harbor ---');
    console.log('CPU Usage (%):', JSON.stringify(cpuMetrics, null, 2));
    console.log('Memory Usage (MB):', JSON.stringify(memoryMetrics, null, 2));
  }
  
  sleep(1);
}

export function handleSummary(data) {
  // Resumen de métricas
  const metrics = {
    'Tiempo de prueba': `${data.state.testRunDurationMs / 1000} segundos`,
    'Iteraciones totales': data.metrics.iterations.count,
    'Peticiones exitosas': data.metrics['successful_requests'].count,
    'Peticiones fallidas': data.metrics['failed_requests'].count,
    'Tasa de éxito': `${(data.metrics['successful_requests'].count / data.metrics.iterations.count * 100).toFixed(2)}%`,
    'Tiempo de respuesta promedio (ms)': data.metrics['response_times'].avg.toFixed(2),
    'Peticiones por segundo': (data.metrics.iterations.count / (data.state.testRunDurationMs / 1000)).toFixed(2),
  };
  
  // Obtener métricas finales de Prometheus
  const cpuMetrics = getPrometheusMetrics(CPU_QUERY);
  const memoryMetrics = getPrometheusMetrics(MEMORY_QUERY);
  
  if (cpuMetrics && memoryMetrics) {
    metrics['CPU Usage Harbor (%)'] = JSON.stringify(cpuMetrics, null, 2);
    metrics['Memory Usage Harbor (MB)'] = JSON.stringify(memoryMetrics, null, 2);
  }
  
  // Imprimir resumen en consola
  console.log('\n===== RESUMEN DE LA PRUEBA =====');
  for (const [key, value] of Object.entries(metrics)) {
    console.log(`${key}: ${value}`);
  }
  
  return {
    'stdout': 'Resumen impreso en consola',
  };
}