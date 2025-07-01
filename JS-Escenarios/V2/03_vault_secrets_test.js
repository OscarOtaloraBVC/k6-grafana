//Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault
import http from 'k6/http';
import { check, fail } from 'k6';

// Configuración
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
    'http_req_duration{type:vault}': ['p(95)<500'], // 95% de las peticiones <500ms
    'http_req_failed{type:vault}': [
      { threshold: 'rate<0.1', abortOnFail: true }, // Umbral de error <10%
      { threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '10s' } // Parar si >50% errores
    ],
    'checks{type:vault}': ['rate>0.9'], // 90% de checks deben pasar
  },
  noConnectionReuse: true, // Evitar reuso de conexiones para prueba realista
};

// Variables de entorno
const VAULT_URL = __ENV.VAULT_URL || 'https://vault.example.com';
const TOKEN = __ENV.VAULT_TOKEN || 's.1234567890abcdef';
const SECRET_PATH = __ENV.VAULT_SECRET_PATH || 'secret/data/test';

// Función para verificar si debemos abortar la prueba
export function setup() {
  return {
    startTime: new Date().toISOString(),
    testAborted: false,
  };
}

// Función principal
export default function (data) {
  // Verificar si la prueba fue abortada
  if (data.testAborted) {
    fail('Prueba abortada debido a alta tasa de errores');
    return;
  }

  const url = `${VAULT_URL}/v1/${SECRET_PATH}`;
  
  const params = {
    headers: {
      'X-Vault-Token': TOKEN,
    },
    tags: { type: 'vault' }
  };
  
  const res = http.get(url, params);
  
  const checks = {
    'secret read success': (r) => r.status === 200,
    'secret data exists': (r) => r.json().data && r.json().data.data,
    'response time acceptable': (r) => r.timings.duration < 1000,
  };
  
  const allChecksPassed = check(res, checks, { tags: { type: 'vault' } });
  
  // Si fallan más del 50% de las verificaciones, marcar para abortar
  if (!allChecksPassed && __ITER % 10 === 0) { // Muestra cada 10 iteraciones
    console.warn(`Check failed at iteration ${__ITER}`);
  }
}

// Función para procesar resultados y notificar si es necesario abortar
export function handleSummary(data) {
  const failedRate = data.metrics['http_req_failed{type:vault}'].values.rate;
  if (failedRate > 0.5) {
    console.error(`ALERTA: Tasa de error del ${(failedRate * 100).toFixed(2)}% - Debería abortarse según requisitos`);
  }
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './summary.json': JSON.stringify(data),
  };
}