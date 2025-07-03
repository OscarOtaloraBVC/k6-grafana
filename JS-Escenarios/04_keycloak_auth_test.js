//Escenario EC K8S DevOps 04 - Prueba masiva de autenticación en Keycloak
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
const KEYCLOAK_URL = __ENV.KEYCLOAK_URL || 'https://test-nuam-kc.coffeesoft.org';
const REALM = __ENV.KEYCLOAK_REALM || 'master';
const CLIENT_ID = __ENV.KEYCLOAK_CLIENT_ID || 'admin-cli';
const USERNAME = __ENV.KEYCLOAK_USER || 'admin';
const PASSWORD = __ENV.KEYCLOAK_PASS || 'c659036218da417b9798c8ff97a0708d';

// Función principal
export default function () {
  const url = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;
  
  const payload = {
    client_id: CLIENT_ID,
    username: USERNAME,
    password: PASSWORD,
    grant_type: 'password',
  };
  
  const params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  
  const res = http.post(url, payload, params);
  
  check(res, {
    'auth success': (r) => r.status === 200,
    'access token received': (r) => r.json().access_token !== undefined,
  });
  
  sleep(1);
}