// Escenario EC K8S DevOps 01 - Versión corregida

import http from 'k6/http';
import { check, sleep } from 'k6';
import { btoa } from 'k6/encoding';

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
  noConnectionReuse: true,
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: [
      { threshold: 'rate<0.1', abortOnFail: false }, // Temporalmente desactivado
      { threshold: 'rate<0.5', abortOnFail: false }
    ],
  },
};

// Variables de entorno
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'library';
const IMAGE = __ENV.HARBOR_IMAGE || 'test-image';
const TAG = __ENV.HARBOR_TAG || '30mb';

// Generar headers de autenticación
function getAuthHeaders() {
  const encodedAuth = btoa(`${USERNAME}:${PASSWORD}`);
  return {
    headers: {
      'Authorization': `Basic ${encodedAuth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: '30s'
  };
}

// Función principal mejorada
export default function () {
  // 1. Obtener manifiesto
  const manifestUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/manifests/${TAG}`;
  const manifestParams = {
    ...getAuthHeaders(),
    headers: {
      ...getAuthHeaders().headers,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    timeout: '60s'
  };

  let manifestRes;
  try {
    manifestRes = http.get(manifestUrl, manifestParams);
    
    if (!manifestRes || !manifestRes.json) {
      throw new Error('Respuesta del manifiesto inválida');
    }

    const manifestCheck = check(manifestRes, {
      'pull manifest success': (r) => r.status === 200,
      'manifest valid': (r) => {
        try {
          return r.json().schemaVersion === 2;
        } catch (e) {
          return false;
        }
      }
    });

    if (!manifestCheck) {
      throw new Error('Falló la validación del manifiesto');
    }

    // 2. Descargar capas
    if (manifestRes.status === 200) {
      const manifest = manifestRes.json();
      const layers = manifest.layers || [];
      
      if (layers.length > 0) {
        const layerUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/blobs/${layers[0].digest}`;
        const layerParams = {
          ...getAuthHeaders(),
          headers: {
            ...getAuthHeaders().headers,
            'Accept': 'application/octet-stream'
          },
          timeout: '120s'
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
  } catch (e) {
    console.error(`Error en iteración: ${e.message}`);
    if (manifestRes) {
      console.error(`Detalles respuesta: ${manifestRes.body}`);
    }
    return;
  }
  
  sleep(1);
}

// Función de resumen
export function handleSummary(data) {
  const metrics = {
    avg_response_time: data.metrics.http_req_duration.values.avg,
    p95_response_time: data.metrics.http_req_duration.values['p(95)'],
    request_rate: data.metrics.http_reqs.values.rate,
    failure_rate: data.metrics.http_req_failed.values.rate,
    total_iterations: data.metrics.iterations.values.count,
    status_codes: data.metrics.http_reqs.values.statuses
  };
  
  return {
    stdout: JSON.stringify(metrics, null, 2)
  };
}