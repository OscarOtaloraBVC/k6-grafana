// Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault (Valores predefinidos)
import http from 'k6/http';
import { check, sleep } from 'k6';

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
    http_req_duration: ['p(95)<500'], // 95% de las peticiones deben responder en menos de 500ms
    http_req_failed: ['rate<0.1'],    // Tasa de error menor al 10%
    'checks{secret read success}': ['rate>0.9'], // 90% de éxito en lectura de secretos
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'], // Métricas adicionales
};

// Valores predefinidos (pueden ser sobrescritos por variables de entorno)
const VAULT_URL = __ENV.VAULT_URL || 'http://localhost:8200';
const TOKEN = __ENV.VAULT_TOKEN || 'hvs.wy9yDkSXpszNTDWfNxNMswQo';
const SECRET_PATHS = [
  __ENV.VAULT_SECRET_PATH || '/v1/kv_Production/data/data/testingk6'
];

// Función principal
export default function () {
  // Verificar tasa de error y abortar si es >50%
  if (__ITER > 0 && __VU * 0.5 < http_req.failed) {
    console.log(`Abortando: Tasa de fallo excede 50% (${http_req.failed})`);
    return;
  }

  // Seleccionar path de secreto aleatorio
  const secretPath = SECRET_PATHS[Math.floor(Math.random() * SECRET_PATHS.length)];
  const url = `${VAULT_URL}${secretPath}`;
  
  const params = {
    headers: {
      'X-Vault-Token': TOKEN,
    },
    tags: {
      secret_path: secretPath,
    },
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'secret read success': (r) => r.status === 200,
    'secret data exists': (r) => r.json().data && r.json().data.data,
    'response time acceptable': (r) => r.timings.duration < 1000,
  });
  
  sleep(1);
}