// k6 script for testing Harbor Docker registry with enhanced metrics and error handling
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

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

// Consultas Prometheus específicas
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Función para simular operaciones Docker mediante Harbor API
function simulateDockerOperation(operation, url, auth) {
  const start = Date.now();
  let success = false;
  let output = '';

  try {
    let response;
    
    switch (operation) {
      case 'login':
        // Verificar autenticación con Harbor API
        response = http.get(`https://${url}/api/v2.0/users/current`, {
          headers: {
            'Authorization': `Basic ${__ENV.HARBOR_AUTH || btoa(USERNAME + ':' + PASSWORD)}`,
            'Content-Type': 'application/json'
          },
          timeout: '30s'
        });
        success = response.status === 200;
        output = success ? 'Login successful' : `Login failed: ${response.status}`;
        break;
        
      case 'pull':
        // Simular pull verificando que la imagen existe
        response = http.get(`https://${url}/api/v2.0/projects/${IMAGE_NAME.split('/')[0]}/repositories/${IMAGE_NAME.split('/')[1].split(':')[0]}/artifacts/${IMAGE_NAME.split(':')[1] || 'latest'}`, {
          headers: {
            'Authorization': `Basic ${__ENV.HARBOR_AUTH || btoa(USERNAME + ':' + PASSWORD)}`,
            'Content-Type': 'application/json'
          },
          timeout: '30s'
        });
        success = response.status === 200;
        output = success ? 'Pull simulation successful' : `Pull failed: ${response.status}`;
        break;
        
      case 'rm':
        // Simular rm (operación local, siempre exitosa)
        success = true;
        output = 'Remove simulation successful';
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
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

  try {
    // Consultar CPU
    const cpuRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(CPU_QUERY)}`, {
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
      console.error(`Error en consulta CPU: ${cpuRes?.status || 'No response'}`);
    }

    // Consultar Memoria
    const memRes = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(MEMORY_QUERY)}`, {
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
      console.error(`Error en consulta Memoria: ${memRes?.status || 'No response'}`);
    }

  } catch (e) {
    errorCount.add(1, { operation: 'metrics' });
    console.error(`Error obteniendo métricas: ${e.message}`);
  }

  return metrics;
}

// Función principal
export default function () {
  // 1. Obtener métricas de Harbor
  const metrics = getHarborMetrics();
  harborCPU.add(metrics.cpu.core, { component: 'core' });
  harborCPU.add(metrics.cpu.registry, { component: 'registry' });
  harborMemory.add(metrics.memory.core, { component: 'core' });
  harborMemory.add(metrics.memory.registry, { component: 'registry' });

  // 2. Simular Login a Harbor
  const loginResult = simulateDockerOperation('login', HARBOR_URL, { username: USERNAME, password: PASSWORD });

  // 3. Simular operación Docker Pull (solo si login fue exitoso)
  let pullResult = { success: false, duration: 0 };
  if (loginResult.success) {
    pullResult = simulateDockerOperation('pull', HARBOR_URL, { username: USERNAME, password: PASSWORD });
  }

  // 4. Simular operación Docker RM (solo si pull fue exitoso)
  let rmResult = { success: false, duration: 0 };
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

  sleep(1);
}

// Función de resumen completo en consola
export function handleSummary(data) {
  console.log('Data structure:', JSON.stringify(data, null, 2));
  
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
  return { stdout: summary };
}