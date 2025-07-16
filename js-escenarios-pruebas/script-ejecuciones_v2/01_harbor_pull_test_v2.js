import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import encoding from 'k6/encoding';

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
const dockerPushCounter = new Counter('docker_push_total');
const dockerPushRate = new Rate('docker_push_success_rate');
const dockerPushDuration = new Trend('docker_push_duration');
const dockerRmCounter = new Counter('docker_rm_total');
const dockerRmRate = new Rate('docker_rm_success_rate');
const harbourCpuUsage = new Trend('harbor_cpu_usage_percent');
const harbourMemoryUsage = new Trend('harbor_memory_usage_mb');

// Configuración de prueba
export const options = {
  stages: [
    // Fase 1: 50 imágenes/segundo por 1 minuto 25 segundos
    //{ duration: '1m25s', target: 50 },
    { duration: '1m25s', target: 10 },
    // Fase 2: 25 imágenes/segundo por 1 minuto 25 segundos
    //{ duration: '1m25s', target: 25 },
    //{ duration: '1m25s', target: 15 },
    // Fase 3: 15 imágenes/segundo por 1 minuto 25 segundos
    //{ duration: '1m25s', target: 15 },
    //{ duration: '1m25s', target: 20 },
    // Fase 4: 10 imágenes/segundo por 1 minuto 25 segundos
    //{ duration: '1m25s', target: 10 }
    //{ duration: '1m25s', target: 25 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% de las solicitudes deben completarse en <1s
    http_req_failed: ['rate<0.01'],    // Tasa de error menor al 1%
    docker_push_success_rate: ['rate>0.95'], // 95% de éxito en push
    docker_rm_success_rate: ['rate>0.95'],   // 95% de éxito en rm
  },
};

// Generador de imágenes aleatorias en el rango de tamaño especificado
function generateRandomImage() {
  const minSize = 28 * 1024 * 1024; // 28MB en bytes
  const maxSize = 50 * 1024 * 1024; // 50MB en bytes
  const size = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
  
  // Generar datos binarios aleatorios (simulando imagen Docker)
  return new Array(size).fill(0).map(() => Math.floor(Math.random() * 256));
}

// Función para autenticación con Harbor
function authenticateHarbor() {
  const authUrl = `${HARBOR_URL}/api/v2.0/projects`;
  const credentials = `${USERNAME}:${PASSWORD}`;
  const encodedCredentials = encoding.b64encode(credentials);
  
  const response = http.get(authUrl, {
    headers: {
      'Authorization': `Basic ${encodedCredentials}`,
      'Content-Type': 'application/json',
    },
  });
  
  return response.status === 200;
}

// Función para obtener métricas de Prometheus
function getPrometheusMetrics() {
  try {
    // Consulta CPU
    const cpuResponse = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`);
    if (cpuResponse.status === 200) {
      const cpuData = JSON.parse(cpuResponse.body);
      if (cpuData.data && cpuData.data.result && cpuData.data.result.length > 0) {
        const cpuValue = parseFloat(cpuData.data.result[0].value[1]);
        harbourCpuUsage.add(cpuValue);
      }
    }
    
    // Consulta Memoria
    const memoryResponse = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`);
    if (memoryResponse.status === 200) {
      const memoryData = JSON.parse(memoryResponse.body);
      if (memoryData.data && memoryData.data.result && memoryData.data.result.length > 0) {
        const memoryValue = parseFloat(memoryData.data.result[0].value[1]);
        harbourMemoryUsage.add(memoryValue);
      }
    }
  } catch (error) {
    console.warn(`Error obteniendo métricas de Prometheus: ${error.message}`);
  }
}

// Función para simular docker push
function dockerPush(imageName) {
  const startTime = Date.now();
  
  // Simular la carga de imagen a Harbor
  const imageData = generateRandomImage();
  const url = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/blobs/uploads/`;
  
  const credentials = `${USERNAME}:${PASSWORD}`;
  const encodedCredentials = encoding.b64encode(credentials);
  
  const headers = {
    'Authorization': `Basic ${encodedCredentials}`,
    'Content-Type': 'application/octet-stream',
  };
  
  const response = http.post(url, { file: imageData }, { headers: headers });
  
  const duration = Date.now() - startTime;
  dockerPushDuration.add(duration);
  dockerPushCounter.add(1);
  
  const success = response.status >= 200 && response.status < 300;
  dockerPushRate.add(success);
  
  return {
    success: success,
    duration: duration,
    imageName: imageName,
    status: response.status
  };
}

// Función para simular docker rmi
function dockerRmi(imageName) {
  const startTime = Date.now();
  
  // Simular eliminación de imagen de Harbor
  const url = `${HARBOR_URL}/api/v2.0/projects/${PROJECT}/repositories/${IMAGE}/artifacts/${TAG}`;
  
  const credentials = `${USERNAME}:${PASSWORD}`;
  const encodedCredentials = encoding.b64encode(credentials);
  
  const headers = {
    'Authorization': `Basic ${encodedCredentials}`,
    'Content-Type': 'application/json',
  };
  
  const response = http.del(url, null, { headers: headers });
  
  const duration = Date.now() - startTime;
  dockerRmCounter.add(1);
  
  const success = response.status >= 200 && response.status < 300;
  dockerRmRate.add(success);
  
  return {
    success: success,
    duration: duration,
    imageName: imageName,
    status: response.status
  };
}

// Función principal de prueba
export default function() {
  // Verificar autenticación cada 10 iteraciones
  if (exec.vu.iterationInScenario % 10 === 0) {
    if (!authenticateHarbor()) {
      console.error('Error de autenticación con Harbor');
      return;
    }
  }
  
  // Obtener métricas de Prometheus cada 5 iteraciones
  if (exec.vu.iterationInScenario % 5 === 0) {
    getPrometheusMetrics();
  }
  
  // Generar nombre único para la imagen
  const uniqueTag = `${TAG}-${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${Date.now()}`;
  const imageName = `${HARBOR_URL}/${PROJECT}/${IMAGE}:${uniqueTag}`;
  
  // Ejecutar docker push
  const pushResult = dockerPush(imageName);
  
  check(pushResult, {
    'docker push exitoso': (r) => r.success,
    'docker push tiempo < 5s': (r) => r.duration < 5000,
  });
  
  // Si el push fue exitoso, ejecutar docker rmi después de un breve delay
  if (pushResult.success) {
    sleep(0.1); // Breve pausa antes de eliminar
    
    const rmResult = dockerRmi(imageName);
    
    check(rmResult, {
      'docker rmi exitoso': (r) => r.success,
      'docker rmi tiempo < 2s': (r) => r.duration < 2000,
    });
  }
  
  // Ajustar sleep para cumplir con la tasa de solicitudes por segundo
  sleep(1);
}

// Función de configuración inicial
export function setup() {
  console.log('=== CONFIGURACIÓN INICIAL ===');
  console.log(`Harbor URL: ${HARBOR_URL}`);
  console.log(`Proyecto: ${PROJECT}`);
  console.log(`Imagen: ${IMAGE}`);
  console.log(`Tag base: ${TAG}`);
  console.log(`Prometheus URL: ${PROMETHEUS_URL}`);
  console.log('================================');
  
  // Verificar conectividad
  if (!authenticateHarbor()) {
    throw new Error('No se pudo autenticar con Harbor');
  }
  
  console.log('✓ Autenticación con Harbor exitosa');
  return { startTime: Date.now() };
}

// Función de limpieza final
export function teardown(data) {
  const endTime = Date.now();
  const totalDuration = (endTime - data.startTime) / 1000;
  
  console.log('\n=== RESUMEN DE LA PRUEBA ===');
  console.log(`Duración total: ${totalDuration.toFixed(2)} segundos`);
  console.log(`Pushes totales: ${dockerPushCounter.value}`);
  console.log(`Eliminaciones totales: ${dockerRmCounter.value}`);
  console.log(`Tasa de éxito push: ${(dockerPushRate.value * 100).toFixed(2)}%`);
  console.log(`Tasa de éxito rm: ${(dockerRmRate.value * 100).toFixed(2)}%`);
  
  // Obtener métricas finales de Prometheus
  getPrometheusMetrics();
  
  console.log('\n=== MÉTRICAS DE HARBOR ===');
  console.log(`CPU promedio: ${harbourCpuUsage.avg ? harbourCpuUsage.avg.toFixed(2) : 'N/A'}%`);
  console.log(`Memoria promedio: ${harbourMemoryUsage.avg ? harbourMemoryUsage.avg.toFixed(2) : 'N/A'} MB`);
  console.log(`CPU máximo: ${harbourCpuUsage.max ? harbourCpuUsage.max.toFixed(2) : 'N/A'}%`);
  console.log(`Memoria máxima: ${harbourMemoryUsage.max ? harbourMemoryUsage.max.toFixed(2) : 'N/A'} MB`);
  
  console.log('\n=== MÉTRICAS DE RENDIMIENTO ===');
  console.log(`Tiempo promedio push: ${dockerPushDuration.avg ? dockerPushDuration.avg.toFixed(2) : 'N/A'} ms`);
  console.log(`Tiempo máximo push: ${dockerPushDuration.max ? dockerPushDuration.max.toFixed(2) : 'N/A'} ms`);
  console.log(`Percentil 95 push: ${dockerPushDuration.p95 ? dockerPushDuration.p95.toFixed(2) : 'N/A'} ms`);
  
  console.log('\n=== PETICIONES POR SEGUNDO ===');
  const rps = dockerPushCounter.value / totalDuration;
  console.log(`Promedio: ${rps.toFixed(2)} peticiones/segundo`);
  
  console.log('============================');
}