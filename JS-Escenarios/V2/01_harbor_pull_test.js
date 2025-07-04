// Escenario EC K8S DevOps 01 - Prueba masiva de pull de imágenes en Harbor.

import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuración
export let options = {
  stages: [
    { duration: '1m', target: 50 },  // Reducir a 50 peticiones/segundo
    { duration: '2m', target: 50 },  // Mantener 50 peticiones/segundo
    { duration: '1m', target: 25 },  // Reducir a 25 peticiones/segundo
    { duration: '2m', target: 25 },  // Mantener 25 peticiones/segundo
    { duration: '1m', target: 15 },  // Reducir a 15 peticiones/segundo
    { duration: '2m', target: 15 },  // Mantener 15 peticiones/segundo
    { duration: '1m', target: 10 },  // Reducir a 10 peticiones/segundo
    { duration: '2m', target: 10 },  // Mantener 10 peticiones/segundo
    { duration: '1m', target: 0 },   // Enfriamiento
  ],
  noConnectionReuse: true,
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% de las peticiones deben responder en menos de 500ms
    http_req_failed: [
      { threshold: 'rate<0.1', abortOnFail: true }, // Umbral de alerta
      { threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '10s' } // Detener prueba si >50% de fallos
    ],
  },
};

// Variables de entorno
const HARBOR_URL = __ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org/';
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'library'; // Proyecto de prueba
const IMAGE = __ENV.HARBOR_IMAGE || 'test-image'; // Imagen grande predefinida
const TAG = __ENV.HARBOR_TAG || '30mb'; // Tag que indica el tamaño

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
    timeout: '30s'
  };
  
  const res = http.post(url, payload, params);
  check(res, {
    'login successful': (r) => r.status === 200,
  });
  
  return res.json().token;
}

// Función principal
export default function () {
  // 1. Autenticación
  const token = getAuthToken();
  
  // 2. Obtener manifiesto de la imagen
  const manifestUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/manifests/${TAG}`;
  const manifestParams = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    timeout: '60s'
  };
  
  const manifestRes = http.get(manifestUrl, manifestParams);
  
  check(manifestRes, {
    'pull manifest success': (r) => r.status === 200,
    'manifest valid': (r) => r.json().schemaVersion === 2
  });
  
  // 3. Descargar capas de la imagen (simulando pull completo)
  if (manifestRes.status === 200) {
    const manifest = manifestRes.json();
    const layers = manifest.layers || [];
    
    // Descargar la primera capa (asumiendo que es la principal)
    if (layers.length > 0) {
      const layerUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/blobs/${layers[0].digest}`;
      const layerParams = {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/octet-stream'
        },
        timeout: '120s' // Tiempo mayor para descarga de capas grandes
      };
      
      const layerRes = http.get(layerUrl, layerParams);
      
      check(layerRes, {
        'layer download success': (r) => r.status === 200,
        'layer size valid': (r) => {
          const size = parseInt(r.headers['Content-Length'] || '0');
          return size >= 28*1024*1024 && size <= 50*1024*1024;
        }
      });
    }
  }
  
  sleep(1);
}

// Función de manejo de métricas (ejemplo para integración con Prometheus)
export function handleSummary(data) {
  // Aquí se podrían enviar métricas a un sistema de monitoreo
  const metrics = {
    cpu_usage: "N/A", // Requeriría integración con API de Harbor/K8s
    memory_usage: "N/A", // Requeriría integración con API de Harbor/K8s
    avg_response_time: data.metrics.http_req_duration.values.avg,
    p95_response_time: data.metrics.http_req_duration.values['p(95)'],
    request_rate: data.metrics.http_reqs.values.rate,
    failure_rate: data.metrics.http_req_failed.values.rate
  };
  
  console.log(JSON.stringify(metrics, null, 2));
  
  return {
    'stdout': `Resumen de prueba: ${JSON.stringify(metrics, null, 2)}`
  };
}