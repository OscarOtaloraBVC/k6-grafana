// k6 script for testing Harbor Docker registry with enhanced metrics and error handling
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import encoding from 'k6/encoding';

// Métricas mejoradas
const harborCPU = new Gauge('harbor_cpu_usage');
const harborMemory = new Gauge('harbor_memory_usage');
const requestRate = new Rate('requests_per_second');
const operationDuration = new Trend('operation_duration');
const errorCount = new Counter('error_count');
const successCount = new Counter('success_count');
const dockerOperationDuration = new Trend('docker_operation_duration');

// Configuración de prueba
export let options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 25 },
    { duration: '1m', target: 15 },
    { duration: '2m', target: 10 },
  ],
  noConnectionReuse: true,
  thresholds: {
    'docker_operation_duration{operation:harbor_api}': ['p(95)<5000'],
    'error_count': ['count<20'],
    'http_req_duration': ['p(95)<10000'],
  },
};

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';
const HARBOR_URL = __ENV.HARBOR_URL || 'test-nuam-registry.coffeesoft.org';
const IMAGE_NAME = __ENV.IMAGE_NAME || 'test-devops/ubuntu:xk6-1749486052417';
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';

// Función para crear Basic Auth header
function createBasicAuthHeader(username, password) {
  return `Basic ${encoding.b64encode(username + ':' + password)}`;
}

// Consultas Prometheus específicas
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Función mejorada para parsear el nombre de imagen
function parseImageName(imageName) {
  try {
    // Formato esperado: proyecto/repo:tag
    const parts = imageName.split(':');
    let tag = 'latest';
    let projectRepo = imageName;
    
    if (parts.length > 1) {
      tag = parts[1];
      projectRepo = parts[0];
    }
    
    const repoParts = projectRepo.split('/');
    if (repoParts.length < 2) {
      throw new Error('Formato de imagen inválido. Esperado: proyecto/repo:tag');
    }
    
    const project = repoParts[0];
    const repo = repoParts.slice(1).join('/');
    
    return { project, repo, tag };
  } catch (e) {
    console.error(`Error parsing image name "${imageName}": ${e.message}`);
    return null;
  }
}

// Función para simular operaciones Docker mediante Harbor API
function simulateDockerOperation(operation, url, auth) {
  const start = Date.now();
  let success = false;
  let output = '';
  let response;

  try {
    const authHeader = createBasicAuthHeader(USERNAME, PASSWORD);
    
    console.log(`Ejecutando operación: ${operation}`);
    
    switch (operation) {
      case 'login':
        // Verificar autenticación con Harbor API
        const loginUrl = `https://${url}/api/v2.0/users/current`;
        console.log(`Login URL: ${loginUrl}`);
        
        response = http.get(loginUrl, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          timeout: '15s'
        });
        
        success = response.status === 200;
        output = success ? 'Login successful' : `Login failed: ${response.status}`;
        console.log(`Login result: ${output}`);
        break;
        
      case 'pull':
        // Simular pull verificando que la imagen existe
        const imageInfo = parseImageName(IMAGE_NAME);
        if (!imageInfo) {
          throw new Error(`No se pudo parsear el nombre de imagen: ${IMAGE_NAME}`);
        }
        
        const { project, repo, tag } = imageInfo;
        const pullUrl = `https://${url}/api/v2.0/projects/${project}/repositories/${repo}/artifacts/${tag}`;
        console.log(`Pull URL: ${pullUrl}`);
        console.log(`Buscando imagen: ${IMAGE_NAME} (proyecto: ${project}, repo: ${repo}, tag: ${tag})`);
        
        response = http.get(pullUrl, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          timeout: '15s'
        });
        
        success = response.status === 200;
        output = success ? `Pull simulation successful for ${IMAGE_NAME}` : `Pull failed: ${response.status}`;
        console.log(`Pull result: ${output}`);
        break;
        
      case 'rm':
        // Simular rm (operación local, siempre exitosa)
        success = true;
        output = 'Remove simulation successful';
        console.log(`RM result: ${output}`);
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    // Log de respuesta para debug
    if (response && response.status !== 200) {
      console.log(`Response status: ${response.status}`);
      console.log(`Response body: ${response.body ? response.body.substring(0, 500) : 'No body'}`);
    }
    
    if (success) {
      successCount.add(1, { operation });
    } else {
      errorCount.add(1, { operation });
      console.error(`Error en ${operation}: ${output}`);
    }
    
  } catch (e) {
    errorCount.add(1, { operation });
    output = e.message || 'Error desconocido';
    console.error(`Error en ${operation}: ${output}`);
    console.error(`Stack trace: ${e.stack}`);
  }

  const duration = (Date.now() - start) / 1000;
  dockerOperationDuration.add(duration, { operation });

  return { success, duration, output };
}

// Función para obtener métricas de Harbor
function getHarborMetrics() {
  const metrics = {
    cpu: { core: 0, registry: 0 },
    memory: { core: 0, registry: 0 }
  };

  // Verificar si Prometheus está disponible
  if (!PROMETHEUS_URL || PROMETHEUS_URL === 'http://localhost:9090') {
    console.log('Prometheus URL no configurada o usando localhost, saltando métricas...');
    return metrics;
  }

  try {
    // Consultar CPU
    const cpuUrl = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`;
    const cpuRes = http.get(cpuUrl, {
      timeout: '10s',
      tags: { query: 'cpu_usage' }
    });

    if (cpuRes && cpuRes.status === 200) {
      const data = cpuRes.json();
      if (data && data.data && data.data.result && Array.isArray(data.data.result)) {
        data.data.result.forEach(item => {
          if (item && item.value && Array.isArray(item.value) && item.value.length > 1) {
            const value = parseFloat(item.value[1]) || 0;
            if (item.metric && item.metric.container) {
              if (item.metric.container === 'core') {
                metrics.cpu.core = value;
              } else if (item.metric.container === 'registry') {
                metrics.cpu.registry = value;
              }
            }
          }
        });
      }
    } else {
      console.warn(`Error en consulta CPU: ${cpuRes?.status || 'No response'}`);
    }

    // Consultar Memoria
    const memUrl = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`;
    const memRes = http.get(memUrl, {
      timeout: '10s',
      tags: { query: 'memory_usage' }
    });

    if (memRes && memRes.status === 200) {
      const data = memRes.json();
      if (data && data.data && data.data.result && Array.isArray(data.data.result)) {
        data.data.result.forEach(item => {
          if (item && item.value && Array.isArray(item.value) && item.value.length > 1) {
            const value = parseFloat(item.value[1]) || 0;
            if (item.metric && item.metric.container) {
              if (item.metric.container === 'core') {
                metrics.memory.core = value;
              } else if (item.metric.container === 'registry') {
                metrics.memory.registry = value;
              }
            }
          }
        });
      }
    } else {
      console.warn(`Error en consulta Memoria: ${memRes?.status || 'No response'}`);
    }

  } catch (e) {
    console.warn(`Error obteniendo métricas de Prometheus: ${e.message}`);
    // No incrementar errorCount aquí ya que las métricas son opcionales
  }

  return metrics;
}

// Función principal
export default function () {
  try {
    // 1. Obtener métricas de Harbor
    const metrics = getHarborMetrics();
    harborCPU.add(metrics.cpu.core, { component: 'core' });
    harborCPU.add(metrics.cpu.registry, { component: 'registry' });
    harborMemory.add(metrics.memory.core, { component: 'core' });
    harborMemory.add(metrics.memory.registry, { component: 'registry' });

    // 2. Simular Login a Harbor
    const loginResult = simulateDockerOperation('login', HARBOR_URL, { username: USERNAME, password: PASSWORD });

    // 3. Simular operación Docker Pull (solo si login fue exitoso)
    let pullResult = { success: false, duration: 0, output: 'Skipped due to login failure' };
    if (loginResult.success) {
      pullResult = simulateDockerOperation('pull', HARBOR_URL, { username: USERNAME, password: PASSWORD });
    }

    // 4. Simular operación Docker RM (solo si pull fue exitoso)
    let rmResult = { success: false, duration: 0, output: 'Skipped due to pull failure' };
    if (pullResult.success) {
      rmResult = simulateDockerOperation('rm', HARBOR_URL, { username: USERNAME, password: PASSWORD });
    }

    // 5. Registrar métricas y checks
    requestRate.add(1);
    
    const checkResults = check(null, {
      'docker login succeeded': () => loginResult.success,
      'docker pull succeeded': () => pullResult.success,
      'docker rm succeeded': () => rmResult.success,
      'cpu core under threshold': () => metrics.cpu.core < 80,
      'cpu registry under threshold': () => metrics.cpu.registry < 80,
      'memory core under threshold': () => metrics.memory.core < 4096,
      'memory registry under threshold': () => metrics.memory.registry < 4096,
    });

    // Log de resultados para debug
    console.log(`Results - Login: ${loginResult.success}, Pull: ${pullResult.success}, RM: ${rmResult.success}`);

  } catch (e) {
    console.error(`Error en función principal: ${e.message}`);
    console.error(`Stack: ${e.stack}`);
    errorCount.add(1, { operation: 'main' });
  }

  sleep(1);
}

// Función de resumen completo en consola
export function handleSummary(data) {
  console.log('=== INICIO DEL RESUMEN ===');
  
  // Función para obtener valores de forma segura
  const getValue = (obj, path, defaultValue = 0) => {
    try {
      const keys = path.split('.');
      let current = obj;
      for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
          current = current[key];
        } else {
          return defaultValue;
        }
      }
      return current !== undefined ? current : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  // Calcular métricas básicas
  const totalChecks = getValue(data, 'metrics.checks.values.count', 0);
  const passedChecks = getValue(data, 'metrics.checks.values.passes', 0);
  const successRate = totalChecks > 0 ? (passedChecks / totalChecks * 100).toFixed(2) : '0.00';

  // Obtener duración de la prueba
  const testDuration = getValue(data, 'state.testDuration', 0);
  const durationSeconds = testDuration > 0 ? (testDuration / 1000000000).toFixed(0) : '0';

  // Obtener errores
  const errorCountValue = getValue(data, 'metrics.error_count.values.count', 0);
  const successCountValue = getValue(data, 'metrics.success_count.values.count', 0);

  // Obtener métricas HTTP
  const httpReqDuration = getValue(data, 'metrics.http_req_duration.values.avg', 0);
  const httpReqs = getValue(data, 'metrics.http_reqs.values.count', 0);

  // Construir resumen legible
  const summary = `
╔══════════════════════════════════════════════╗
║           RESUMEN DE PRUEBA HARBOR           ║
╠══════════════════════════════════════════════╣
║ • DURACIÓN TOTAL: ${durationSeconds} segundos
║ • CHECKS TOTALES: ${totalChecks}
║ • CHECKS EXITOSOS: ${passedChecks}
║ • TASA DE ÉXITO: ${successRate}%
║ • ERRORES: ${errorCountValue}
║ • ÉXITOS: ${successCountValue}
║ • REQUESTS HTTP: ${httpReqs}
║ • DURACIÓN HTTP PROMEDIO: ${httpReqDuration.toFixed(2)}ms
╠══════════════════════════════════════════════╣
║            MÉTRICAS DE RECURSOS              ║
╠══════════════════════════════════════════════╣
║ • CPU CORE: Monitorizada vía Prometheus
║ • CPU REGISTRY: Monitorizada vía Prometheus
║ • MEMORIA CORE: Monitorizada vía Prometheus
║ • MEMORIA REGISTRY: Monitorizada vía Prometheus
╠══════════════════════════════════════════════╣
║            INFORMACIÓN ADICIONAL             ║
╠══════════════════════════════════════════════╣
║ • Harbor URL: ${HARBOR_URL}
║ • Imagen: ${IMAGE_NAME}
║ • Usuario: ${USERNAME}
║ • Prometheus: ${PROMETHEUS_URL}
╚══════════════════════════════════════════════╝
`;

  console.log(summary);
  console.log('=== FIN DEL RESUMEN ===');
  
  return { 
    'stdout': summary,
    'summary.json': JSON.stringify(data, null, 2)
  };
}