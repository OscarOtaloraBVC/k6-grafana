//Escenario EC K8S DevOps 02 - Prueba masiva de pull de binarios en Artifactory
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
const ARTIFACTORY_URL = __ENV.ARTIFACTORY_URL || 'https://test-nuam-artifactory.coffeesoft.org/';
const USERNAME = __ENV.ARTIFACTORY_USER || 'admin';
const PASSWORD = __ENV.ARTIFACTORY_PASS || 'Nuam123.*';
const REPO = __ENV.ARTIFACTORY_REPO || 'k6-prueba';
const FILE_PATHS = [
  'test/testfile-15mb.bin',
  'test/testfile-20mb.bin',
  'test/testfile-25mb.bin',
  'test/testfile-30mb.bin'
];
// Función principal
export default function () {
  const url = `${ARTIFACTORY_URL}/${REPO}/${FILE_PATH}`;
  
  const params = {
    auth: 'basic',
    username: USERNAME,
    password: PASSWORD,
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'download success': (r) => r.status === 200,
    'content length': (r) => r.body.length > 0,
  });
  
  sleep(1);
}