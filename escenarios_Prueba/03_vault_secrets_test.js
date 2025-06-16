//Escenario EC K8S DevOps 03 - Prueba masiva de consulta de secretos en Vault
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
  },
};

// Variables de entorno
const VAULT_URL = __ENV.VAULT_URL || 'https://vault.example.com';
const TOKEN = __ENV.VAULT_TOKEN || 's.1234567890abcdef';
const SECRET_PATH = __ENV.VAULT_SECRET_PATH || 'secret/data/test';

// Función principal
export default function () {
  const url = `${VAULT_URL}/v1/${SECRET_PATH}`;
  
  const params = {
    headers: {
      'X-Vault-Token': TOKEN,
    },
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'secret read success': (r) => r.status === 200,
    'secret data exists': (r) => r.json().data && r.json().data.data,
  });
  
  sleep(1);
}