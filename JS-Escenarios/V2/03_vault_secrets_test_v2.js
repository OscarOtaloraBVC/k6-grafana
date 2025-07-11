// Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault (Versión mejorada)
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// ======================
// Métricas personalizadas
// ======================
const responseTrend = new Trend('response_time');
const successRate = new Rate('successful_requests');
const errorRate = new Rate('error_requests');
const errorCounter = new Counter('total_errors');

// ======================
// Configuración principal
// ======================
export let options = {
  stages: [
    { duration: '1m', target: 100 },  // Rampa a 100 peticiones/segundo
    { duration: '2m', target: 100 },  // Mantener 100 peticiones/segundo
    { duration: '1m', target: 50 },   // Reducir a 50 peticiones/segundo
    { duration: '2m', target: 50 },   // Mantener 50 peticiones/segundo
    { duration: '1m', target: 25 },   // Reducir a 25 peticiones/segundo
    { duration: '2m', target: 25 },   // Mantener 25 peticiones/segundo
    { duration: '1m', target: 15 },   // Reducir a 15 peticiones/segundo
    { duration: '2m', target: 15 },   // Mantener 15 peticiones/segundo
    { duration: '1m', target: 0 },    // Enfriamiento
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],    // Tasa de error menor al 5%
    'successful_requests': ['rate>0.95'], // 95% de éxito
    'error_requests': ['rate<0.05'],      // Menos del 5% de errores
    'checks{secret_read_success}': ['rate>0.95'],
    'checks{secret_data_valid}': ['rate>0.95'],
    'checks{response_time_acceptable}': ['rate>0.90'],
    'total_errors': ['count<100']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  noConnectionReuse: true // Para evitar reutilización de conexiones que pueda afectar métricas
};

// ======================
// Configuración de Vault
// ======================
const VAULT_URL = __ENV.VAULT_URL || 'http://localhost:8200';
const TOKEN = __ENV.VAULT_TOKEN || 'hvs.wy9yDkSXpszNTDWfNxNMswQo';
const SECRET_PATHS = [
  __ENV.VAULT_SECRET_PATH || '/v1/kv_Production/data/data/testingk6',
  '/v1/kv_Production/data/data/app1',
  '/v1/kv_Production/data/data/app2'
];

// ======================
// Función de validación de respuesta
// ======================
function validateSecretResponse(response) {
  try {
    if (!response) return false;
    
    // Validar estructura básica de la respuesta
    if (response.status !== 200) {
      console.error(`Código de estado inválido: ${response.status}`);
      return false;
    }

    // Validar estructura JSON
    const jsonData = response.json();
    if (!jsonData) {
      console.error('Respuesta no es JSON válido');
      return false;
    }

    // Validar estructura específica de Vault
    if (!jsonData.data || !jsonData.data.data) {
      console.error('Estructura de datos de Vault inválida');
      return false;
    }

    // Validar contenido mínimo del secreto
    const secretData = jsonData.data.data;
    if (typeof secretData !== 'object' || Object.keys(secretData).length === 0) {
      console.error('Secreto no contiene datos');
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error validando respuesta: ${error.message}`);
    return false;
  }
}

// ======================
// Función principal
// ======================
export default function () {
  let response;
  const secretPath = SECRET_PATHS[Math.floor(Math.random() * SECRET_PATHS.length)];
  const url = `${VAULT_URL}${secretPath}`;
  
  const params = {
    headers: {
      'X-Vault-Token': TOKEN,
      'Content-Type': 'application/json'
    },
    tags: {
      secret_path: secretPath,
      test_type: 'secret_retrieval'
    },
    timeout: '30s' // Timeout aumentado para entornos con alta latencia
  };

  // Ejecutar la petición dentro de un grupo para mejor organización en los reportes
  group('Vault Secret Retrieval', function () {
    // Verificar tasa de error y abortar si es >50%
    if (__ITER > 0 && __VU * 0.5 < http_req.failed) {
      console.log(`Abortando: Tasa de fallo excede 50% (${http_req.failed})`);
      errorCounter.add(1);
      return;
    }

    response = http.get(url, params);
    
    // Registrar métricas
    responseTrend.add(response.timings.duration);
    
    // Validar respuesta
    const isResponseValid = validateSecretResponse(response);
    
    // Registrar checks
    const checkResults = check(response, {
      'secret_read_success': (r) => r.status === 200,
      'secret_data_valid': () => isResponseValid,
      'response_time_acceptable': (r) => r.timings.duration < 800
    });

    // Actualizar métricas de éxito/error
    if (checkResults && isResponseValid) {
      successRate.add(1);
    } else {
      errorRate.add(1);
      errorCounter.add(1);
      console.error(`Error en petición a ${url}: ${response.status} - ${response.body}`);
    }
  });

  sleep(1);
}

// ======================
// Función de manejo de resumen (opcional)
// ======================
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './summary.json': JSON.stringify(data),
  };
}