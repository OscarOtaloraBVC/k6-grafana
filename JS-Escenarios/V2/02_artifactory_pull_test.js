//Escenario EC K8S DevOps 02 - Prueba masiva de pull de binarios en Artifactory
import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuración
export let options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '1m', target: 25 },
    { duration: '2m', target: 25 },
    { duration: '1m', target: 15 },
    { duration: '2m', target: 15 },
    { duration: '1m', target: 10 },
    { duration: '2m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
    // Threshold para detener si >50% fallan
    'http_req_failed{type:pull}': ['rate<0.5'],
  },
  // Tags para identificar tipos de requests
  tags: {
    type: 'pull',
  },
};

// Variables de entorno
const ARTIFACTORY_URL = __ENV.ARTIFACTORY_URL || 'https://artifactory.example.com';
const USERNAME = __ENV.ARTIFACTORY_USER || 'admin';
const PASSWORD = __ENV.ARTIFACTORY_PASS || 'password';
const REPO = __ENV.ARTIFACTORY_REPO || 'generic-local';
const FILE_PATHS = [
  'test/testfile-15mb.bin',
  'test/testfile-20mb.bin',
  'test/testfile-25mb.bin',
  'test/testfile-30mb.bin'
];

// Función principal
export default function () {
  // Seleccionar archivo aleatorio para simular diferentes tamaños
  const randomFile = FILE_PATHS[Math.floor(Math.random() * FILE_PATHS.length)];
  const url = `${ARTIFACTORY_URL}/${REPO}/${randomFile}`;
  
  const params = {
    auth: 'basic',
    username: USERNAME,
    password: PASSWORD,
    tags: { type: 'pull' } // Tag para identificar tipo de request
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'download success': (r) => r.status === 200,
    'content length': (r) => r.body.length > 0,
  });
  
  sleep(1);
}