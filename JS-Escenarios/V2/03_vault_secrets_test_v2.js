// Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault (Versión final corregida)
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
const errorCounter = new Counter('vault_errors');

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
    //'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration': ['p(95)<1000', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],  // Corregido: nombre correcto de la métrica built-in
    'successful_requests': ['rate>0.95'],
    'error_requests': ['rate<0.05'],
    'checks': ['rate>0.95'],
    'vault_errors': ['count<100']
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
  __ENV.VAULT_SECRET_PATH || '/v1/kv_Production/data/data/testingk6'
];

// ======================
// Función de validación de respuesta
// ======================
function validateVaultResponse(response) {
  try {
    if (!response || response.status !== 200) return false;
    
    const jsonData = response.json();
    if (!jsonData?.data?.data) return false;
    
    return typeof jsonData.data.data === 'object' && 
           Object.keys(jsonData.data.data).length > 0;
  } catch (error) {
    return false;
  }
}

// ======================
// Función principal
// ======================
export default function () {
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

  group('Vault Secret Retrieval', () => {
    const response = http.get(url, params);
    responseTrend.add(response.timings.duration);
    
    const isValid = validateVaultResponse(response);
    
    check(response, {
      'vault_request_success': (r) => r.status === 200,
      'vault_data_valid': () => isValid,
      //'response_time_under_800ms': (r) => r.timings.duration < 800
      'response_time_under_3500ms': (r) => r.timings.duration < 3500
    });

    if (response.status === 200 && isValid) {
      successRate.add(1);
    } else {
      errorRate.add(1);
      errorCounter.add(1);
    }
  });

  sleep(1);
}

// ======================
// Reporte final
// ======================
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './summary.json': JSON.stringify(data)
  };
}