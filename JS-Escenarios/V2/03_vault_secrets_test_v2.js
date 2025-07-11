// Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault (Versión final)
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
    'http_req_failed': ['rate<0.05'],
    'successful_requests': ['rate>0.95'],
    'error_requests': ['rate<0.05'],
    'checks': ['rate>0.95'],          // Umbral global para todas las checks
    'vault_errors': ['count<100']     // Corregido: usando el nombre correcto de la métrica
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
    // Verificar tasa de error antes de continuar
    if (__ITER > 0 && http_req.failed > 0.5) {
      errorCounter.add(1);
      return;
    }

    const response = http.get(url, params);
    responseTrend.add(response.timings.duration);
    
    const isValid = validateVaultResponse(response);
    
    // Checks con nombres consistentes
    check(response, {
      'vault_request_success': (r) => r.status === 200,
      'vault_data_valid': () => isValid,
      'response_time_under_800ms': (r) => r.timings.duration < 800
    });

    // Actualizar métricas
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
    './summary.json': JSON.stringify(data),
    './summary.html': generateHtmlReport(data)
  };
}

// Función opcional para generar reporte HTML
function generateHtmlReport(data) {
  return `
    <html>
      <head><title>Vault Load Test Report</title></head>
      <body>
        <h1>Vault Performance Test Results</h1>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      </body>
    </html>
  `;
}