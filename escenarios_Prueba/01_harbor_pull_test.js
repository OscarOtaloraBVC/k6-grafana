//Escenario EC K8S DevOps 01 - Prueba masiva de pull de imágenes en Harbor

import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuración
export let options = {
  stages: [
    { duration: '1m', target: 50 },  // Rampa a 50 peticiones/segundo
    { duration: '2m', target: 50 },  // Mantener 50 peticiones/segundo
    { duration: '1m', target: 25 },  // Reducir a 25 peticiones/segundo
    { duration: '2m', target: 25 },  // Mantener 25 peticiones/segundo
    { duration: '1m', target: 15 },  // Reducir a 15 peticiones/segundo
    { duration: '2m', target: 15 },  // Mantener 15 peticiones/segundo
    { duration: '1m', target: 10 },  // Reducir a 10 peticiones/segundo
    { duration: '2m', target: 10 },  // Mantener 10 peticiones/segundo
    { duration: '1m', target: 0 },   // Enfriamiento
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% de las peticiones deben responder en menos de 500ms
    http_req_failed: ['rate<0.1'],    // Tasa de error menor al 10%
  },
};

// Variables de entorno
const HARBOR_URL = __ENV.HARBOR_URL || 'https://harbor.example.com';
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'password';
const PROJECT = __ENV.HARBOR_PROJECT || 'library';
const IMAGE = __ENV.HARBOR_IMAGE || 'nginx';
const TAG = __ENV.HARBOR_TAG || 'latest';

// Autenticación en Harbor
function getAuthToken() {
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: USERNAME,
    password: PASSWORD
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  const res = http.post(url, payload, params);
  check(res, {
    'login successful': (r) => r.status === 200,
  });
  
  return res.json().token;
}

// Función principal
export default function () {
  const token = getAuthToken();
  const manifestUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/manifests/${TAG}`;
  
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
  };
  
  const res = http.get(manifestUrl, params);
  
  check(res, {
    'pull manifest success': (r) => r.status === 200,
  });
  
  sleep(1);
}