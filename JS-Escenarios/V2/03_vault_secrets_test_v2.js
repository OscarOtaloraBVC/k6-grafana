// Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault (Versión corregida)
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

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
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '1m', target: 25 },
    { duration: '2m', target: 25 },
    { duration: '1m', target: 15 },
    { duration: '2m', target: 15 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],
    'successful_requests': ['rate>0.95'],
    'error_requests': ['rate<0.05'],
    'checks': ['rate>0.95'], // Umbral global para todas las checks
    'errors': ['count<100']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  noConnectionReuse: true
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
    if (response.status !== 200) return false;
    
    const jsonData = response.json();
    if (!jsonData || !jsonData.data || !jsonData.data.data) return false;
    
    const secretData = jsonData.data.data;
    return typeof secretData === 'object' && Object.keys(secretData).length > 0;
  } catch (error) {
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
    timeout: '30s'
  };

  group('Vault Secret Retrieval', function () {
    if (__ITER > 0 && __VU * 0.5 < http_req.failed) {
      errorCounter.add(1);
      return;
    }

    response = http.get(url, params);
    responseTrend.add(response.timings.duration);
    
    const isResponseValid = validateSecretResponse(response);
    
    // Checks con nombres válidos (sin espacios ni caracteres especiales)
    check(response, {
      'secret_read_success': (r) => r.status === 200,
      'secret_data_valid': () => isResponseValid,
      'acceptable_response_time': (r) => r.timings.duration < 800
    });

    if (response.status === 200 && isResponseValid) {
      successRate.add(1);
    } else {
      errorRate.add(1);
      errorCounter.add(1);
    }
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './summary.json': JSON.stringify(data),
  };
}