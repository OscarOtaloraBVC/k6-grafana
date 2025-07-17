import { textSummary } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
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

// Función para obtener métricas de Prometheus
function fetchPrometheusMetrics() {
  if (!PROMETHEUS_URL || PROMETHEUS_URL === 'http://localhost:9090') return;

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
}

// Teardown - Obtener métricas finales
export function teardown() {
  fetchPrometheusMetrics();
}

// Resumen final 
export function handleSummary(data) {
  // Debug: Verificar qué contiene data
  console.log('Data object keys:', Object.keys(data || {}));
  
  // Asegurarse de tener las métricas más recientes
  fetchPrometheusMetrics();

  // Validar que data existe y tiene estructura mínima
  if (!data || typeof data !== 'object') {
    console.error('Data object is invalid or missing');
    return {
      "summary.txt": "Error: No se pudo generar el resumen - datos inválidos"
    };
  }

  // Función para manejar métricas potencialmente no definidas
  const safeMetric = (metric, prop = 'count', defaultValue = 0) => {
    if (!data.metrics || !data.metrics[metric]) return defaultValue;
    return data.metrics[metric][prop] || defaultValue;
  };

  // Calcular métricas básicas - Validación segura de data.state
  let duration = 0;
  if (data && data.state && typeof data.state.testRunDurationMs === 'number') {
    duration = data.state.testRunDurationMs / 1000;
  } else if (data && data.metrics && data.metrics.iteration_duration && data.metrics.iteration_duration.values) {
    // Alternativa: calcular duración aproximada basada en iteraciones
    const iterationData = data.metrics.iteration_duration.values;
    duration = (iterationData.max || 0) * (data.metrics.iterations ? data.metrics.iterations.count : 1);
  }
  
  const durationInMinutes = (duration / 60).toFixed(2);
  
  // Obtener información adicional de métricas
  const iterations = safeMetric('iterations', 'count', 0);
  const httpReqs = safeMetric('http_reqs', 'count', 0);
  const httpReqFailed = safeMetric('http_req_failed', 'rate', 0);
  const avgIterationDuration = safeMetric('iteration_duration', 'avg', 0);
  
  // Formatear métricas de Prometheus
  const formatPrometheus = (data) => {
    if (!Array.isArray(data) || data.length === 0) return 'No disponible';
    return data.map(item => `  ${item.container.padEnd(10)}: ${item.usage}`).join('\n');
  };

  // Resumen expandido
  const summaryText = `
============================== RESUMEN =================================
Duración:          ${durationInMinutes} minutos (${duration.toFixed(2)}s)
Iteraciones:       ${iterations}
VUs máximos:       ${vusMax}
HTTP Requests:     ${httpReqs}
HTTP Failed Rate:  ${(httpReqFailed * 100).toFixed(2)}%
Avg Iteration:     ${(avgIterationDuration / 1000).toFixed(2)}s
Data Sent:         ${dataSent} bytes
Data Received:     ${dataReceived} bytes

Uso de CPU Harbor:
${formatPrometheus(prometheusData.cpu)}

Uso de Memoria Harbor:
${formatPrometheus(prometheusData.memory)}

Última actualización métricas: ${prometheusData.lastUpdated || 'No disponible'}
=======================================================================
`;

  // Mostrar en consola
  console.log(summaryText);
  
  // Retornar el resumen de manera segura
  const result = {
    "summary.txt": summaryText
  };
  
  // Intentar generar textSummary con más validaciones
  try {
    if (data && data.metrics && Object.keys(data.metrics).length > 0) {
      // Intentar con diferentes configuraciones de textSummary
      result.stdout = textSummary(data, { 
        indent: ' ', 
        enableColors: false  // Desactivar colores para evitar problemas
      });
    } else {
      console.log('No hay métricas disponibles para textSummary');
      result.stdout = summaryText; // Usar nuestro resumen personalizado
    }
  } catch (error) {
    console.error('Error generando textSummary:', JSON.stringify(error));
    // En lugar de mostrar toda la estructura, usar nuestro resumen personalizado
    result.stdout = summaryText; // Usar nuestro resumen personalizado como fallback
  }
  
  return result;
}