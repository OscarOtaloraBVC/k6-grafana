import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend, Rate } from 'k6/metrics';
import encoding from 'k6/encoding';

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';  
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Métricas
let successfulRequests = new Counter('successful_requests');
let failedRequests = new Counter('failed_requests');
let requestRate = new Rate('request_rate');
let responseTimes = new Trend('response_times');

// Generador de imágenes aleatorias
function generateRandomImage() {
  const minSize = 28 * 1024 * 1024; // 28MB
  const maxSize = 50 * 1024 * 1024; // 50MB
  const size = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
  return new Array(size).fill(0).map(() => Math.floor(Math.random() * 256));
}

// Autenticación en Harbor v2.0
function getAuthToken() {
  const credentials = `${USERNAME}:${PASSWORD}`;
  const encodedCredentials = encoding.b64encode(credentials);
  
  const res = http.get(`${HARBOR_URL}/api/v2.0/users/current`, {
    headers: {
      'Authorization': `Basic ${encodedCredentials}`
    }
  });
  
  if (res.status === 200) {
    return encodedCredentials; // Usaremos Basic Auth
  }
  
  console.error(`Authentication failed: ${res.status} - ${res.body}`);
  return null;
}

// Configuración
export let options = {
  stages: [
    { duration: '30s', target: 10 }, // Rampa inicial
    { duration: '5m', target: 50 },  // Carga sostenida
    { duration: '30s', target: 0 },   // Rampa de salida
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1']
  }
};

export default function () {
  // Obtener credenciales codificadas
  const authToken = getAuthToken();
  if (!authToken) {
    failedRequests.add(1);
    return;
  }

  // Generar datos de imagen
  const randomImage = generateRandomImage();
  const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const imageName = `${HARBOR_URL.split('://')[1]}/${PROJECT}/${IMAGE}:${randomTag}`;

  // Subir imagen
  const startTime = new Date().getTime();
  const uploadRes = http.post(
    `${HARBOR_URL}/api/v2.0/projects/${PROJECT}/repositories/${IMAGE}/artifacts`,
    randomImage,
    {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': `Basic ${authToken}`
      },
      timeout: '120s'
    }
  );

  const duration = new Date().getTime() - startTime;
  responseTimes.add(duration);
  requestRate.add(1);

  if (uploadRes.status === 201 || uploadRes.status === 202) {
    successfulRequests.add(1);
    
    // Eliminar imagen si está habilitado
    if (__ENV.K6_DOCKER_EXEC === 'true') {
      try {
        const cmd = `docker image rm ${imageName}`;
        const result = exec(cmd, { output: null });
        console.log(`Deleted image: ${imageName}`);
      } catch (error) {
        console.error(`Error deleting image: ${error}`);
      }
    }
  } else {
    failedRequests.add(1);
    console.error(`Upload failed (${uploadRes.status}): ${uploadRes.body}`);
  }

  sleep(1);
}

export function handleSummary(data) {
  // Resumen básico
  const summary = {
    "Duración": `${data.state.testRunDurationMs / 1000}s`,
    "Iteraciones": data.metrics.iterations.count,
    "Éxitos": data.metrics.successful_requests.count,
    "Fallos": data.metrics.failed_requests.count,
    "Tasa éxito": `${(data.metrics.successful_requests.count / data.metrics.iterations.count * 100).toFixed(2)}%`,
    "Tiempo respuesta (avg)": `${data.metrics.response_times.avg.toFixed(2)}ms`,
    "RPS": (data.metrics.iterations.count / (data.state.testRunDurationMs / 1000)).toFixed(2)
  };

  console.log("\n===== RESUMEN FINAL =====");
  for (const [key, value] of Object.entries(summary)) {
    console.log(`${key}: ${value}`);
  }

  return { stdout: "Resumen completado" };
}