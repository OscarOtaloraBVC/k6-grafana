//Escenario EC K8S DevOps 04 - Prueba masiva de autenticación en Keycloak

import http from 'k6/http';
import { check, sleep, fail } from 'k6';

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
    http_req_duration: ['avg<300', 'p(95)<500'],
    http_req_failed: ['rate<0.1'],    // Tasa de error menor al 10%
    'checks{auth success}': ['rate>0.9'], // 90% de autenticaciones exitosas
  },
  noConnectionReuse: true,
};

// Variables de entorno - Validación
const KEYCLOAK_URL = __ENV.KEYCLOAK_URL || fail('KEYCLOAK_URL is required');
const REALM = __ENV.KEYCLOAK_REALM || 'master';
const CLIENT_ID = __ENV.KEYCLOAK_CLIENT_ID || 'admin-cli';
const USERNAME = __ENV.KEYCLOAK_USER || fail('KEYCLOAK_USER is required');
const PASSWORD = __ENV.KEYCLOAK_PASS || fail('KEYCLOAK_PASS is required');

// Función principal con reintentos
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
    timeout: '30s',
  };
  
  let res;
  let retries = 3;
  
  while (retries > 0) {
    res = http.post(url, payload, params);
    
    if (res.status === 200) {
      break;
    }
    
    retries--;
    sleep(1);
  }
  
  const success = check(res, {
    'auth success': (r) => r.status === 200,
    'access token received': (r) => r.json().access_token !== undefined,
  });
  
  if (!success) {
    console.error(`Auth failed for user ${USERNAME}: ${res.status} ${res.body}`);
  }
  
  sleep(1);
}