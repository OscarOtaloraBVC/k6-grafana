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
    { duration: '5m', target: 5 },
    //{ duration: '5m', target: 50 },  
    //{ duration: '30s', target: 0 },   
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
  // Calcular métricas con verificación de existencia para evitar errores
  const duration = data.state ? (data.state.testRunDurationMs / 1000) : 0;
  const iterations = data.metrics.iterations ? data.metrics.iterations.count : 0;
  const successes = data.metrics.successful_requests ? data.metrics.successful_requests.count : 0;
  const failures = data.metrics.failed_requests ? data.metrics.failed_requests.count : 0;
  const successRate = iterations > 0 ? (successes / iterations * 100).toFixed(2) : 0;
  const avgResponseTime = data.metrics.response_times ? data.metrics.response_times.avg.toFixed(2) : 0;
  const rps = duration > 0 ? (iterations / duration).toFixed(2) : 0;

  // Resumen detallado
  const summary = {
    "Duración de la prueba": `${duration} segundos`,
    "Total de iteraciones": iterations,
    "Peticiones exitosas": successes,
    "Peticiones fallidas": failures,
    "Tasa de éxito": `${successRate}%`,
    "Tiempo de respuesta promedio": `${avgResponseTime} ms`,
    "Peticiones por segundo (RPS)": rps,
    "Uso de CPU (Prometheus)": __ENV.PROMETHEUS_URL ? CPU_QUERY : "No configurado",
    "Uso de memoria (Prometheus)": __ENV.PROMETHEUS_URL ? MEMORY_QUERY : "No configurado"
  };

  // Mostrar resumen en consola con formato
  console.log("\n" + "=".repeat(50));
  console.log("RESUMEN FINAL DE LA PRUEBA");
  console.log("=".repeat(50));
  
  for (const [key, value] of Object.entries(summary)) {
    console.log(`• ${key.padEnd(30)}: ${value}`);
  }
  
  console.log("=".repeat(50) + "\n");

  // También devolver el resumen como texto plano
  return {
    "stdout": textSummary(data, { indent: " ", enableColors: true }),
    "summary.json": JSON.stringify(summary, null, 2)
  };
}