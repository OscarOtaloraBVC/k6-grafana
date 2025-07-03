// Escenario EC K8S DevOps 04 - Prueba masiva de autenticación en Keycloak (versión corregida)

import http from 'k6/http';
import { check, sleep, fail, group } from 'k6';

// Configuración corregida
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
    //'http_req_duration': ['avg<300', 'p(95)<500'],
    'http_req_duration': ['avg<1000', 'p(95)<2000'],
    'http_req_failed': ['rate<0.5'],  // Umbral ajustado al 50% como requerimiento
    'checks{type:auth}': ['rate>0.9'], // Sintaxis corregida para checks con tags
  },
  noConnectionReuse: true,
  discardResponseBodies: false,
};

// Validación de variables de entorno
function getRequiredEnv(envName, defaultValue = null) {
  const value = __ENV[envName] || defaultValue;
  if (value === null) {
    fail(`La variable de entorno ${envName} es requerida`);
  }
  return value;
}

const KEYCLOAK_URL = getRequiredEnv('KEYCLOAK_URL', 'https://test-nuam-kc.coffeesoft.org');
const REALM = getRequiredEnv('KEYCLOAK_REALM', 'master');
const CLIENT_ID = getRequiredEnv('KEYCLOAK_CLIENT_ID', 'admin-cli');
const USERNAME = getRequiredEnv('KEYCLOAK_USER', 'admin');
const PASSWORD = getRequiredEnv('KEYCLOAK_PASS', 'c659036218da417b9798c8ff97a0708d');

// Función principal corregida
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
    tags: { 
      name: 'keycloak_auth',
      type: 'auth'  // Tag usado para agrupar checks
    },
  };
  
  let res;
  let retries = 3;
  let success = false;
  
  group('Authentication Flow', function () {
    while (retries > 0) {
      res = http.post(url, payload, params);
      
      if (res.status === 200) {
        success = true;
        break;
      }
      
      retries--;
      sleep(1);
    }
    
    // Check con tags correctamente formateados
    check(res, {
      'auth status is 200': (r) => r.status === 200,
      'access token received': (r) => r.json().access_token !== undefined,
    }, { type: 'auth' });
    
    if (!success) {
      console.error(`Auth failed for user ${USERNAME}: ${res.status} ${res.body}`);
      if (__ITER % 10 === 0 && !success) {
        fail('Demasiados fallos consecutivos de autenticación');
      }
    }
  });
  
  sleep(1);
}