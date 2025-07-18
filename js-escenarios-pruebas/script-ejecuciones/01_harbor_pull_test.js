// Escenario EC K8S DevOps 01 
// Construccion de imágenes en Harbor 
//  # Construir la imagen
//      docker build -t test-image:30mb .
//  # Taggear para Harbor
//      docker tag test-image:30mb test-nuam-registry.coffeesoft.org/library/test-image:30mb
//  # Login a Harbor (Para carga de imagenes)
//      docker login test-nuam-registry.coffeesoft.org -u admin -p r7Y5mQBwsM2lIj0
//  # Push a Harbor
//      docker push test-nuam-registry.coffeesoft.org/library/test-image:30mb
//
// ejecucion k6 run 01_harbor_pull_test.js

import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuración
export let options = {
  stages: [
    { duration: '1s', target: 50 },
    //{ duration: '2m', target: 50 },
    { duration: '1s', target: 25 },
    //{ duration: '2m', target: 25 },
    { duration: '1s', target: 15 },
    //{ duration: '2m', target: 15 },
    { duration: '1s', target: 10 },
    //{ duration: '2m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  noConnectionReuse: true,
  thresholds: {
    //http_req_duration: ['p(95)<500'],
    http_req_duration: ['p(95)<3500'],
    http_req_failed: [
      { threshold: 'rate<0.1', abortOnFail: true },
      { threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '10s' }
    ],
  },
};

// Variables de entorno
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';

// Función de codificación Base64 
function toBase64(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i);
    const b = str.charCodeAt(i + 1);
    const c = str.charCodeAt(i + 2);
    
    const enc1 = a >> 2;
    const enc2 = ((a & 3) << 4) | (b >> 4);
    const enc3 = isNaN(b) ? 64 : ((b & 15) << 2) | (c >> 6);
    const enc4 = isNaN(c) ? 64 : c & 63;
    
    output += chars.charAt(enc1) + chars.charAt(enc2) + chars.charAt(enc3) + chars.charAt(enc4);
  }
  
  return output;
}

// Generar headers de autenticación 
function getAuthHeaders() {
  try {
    if (!USERNAME || !PASSWORD) {
      throw new Error('Credenciales no definidas');
    }
    
    const authString = `${USERNAME}:${PASSWORD}`;
    const encodedAuth = toBase64(authString);
    
    return {
      headers: {
        'Authorization': `Basic ${encodedAuth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: '30s'
    };
  } catch (e) {
    console.error(`Error generando headers: ${e.message}`);
    return {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: '30s'
    };
  }
}

// Función principal 
export default function () {
  let manifestRes;
  
  try {
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

    manifestRes = http.get(manifestUrl, manifestParams);
    
    if (!manifestRes) {
      throw new Error('No se recibió respuesta del servidor');
    }

    const manifestCheck = check(manifestRes, {
      'pull manifest success': (r) => r.status === 200,
      'manifest valid': (r) => {
        try {
          const json = r.json();
          return json && json.schemaVersion === 2;
        } catch (e) {
          console.error(`Error parseando manifiesto: ${e.message}`);
          return false;
        }
      }
    });

    if (!manifestCheck) {
      throw new Error(`Falló la validación del manifiesto. Código: ${manifestRes.status}`);
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
            const compressedSize = parseInt(r.headers['Content-Length'] || '0');
            // Factor de descompresión estimado (10x es común para datos binarios)
            const uncompressedSize = compressedSize * 10; 
            return uncompressedSize >= 28*1024*1024 && uncompressedSize <= 50*1024*1024;
          }
        });
      }
    }
  } catch (e) {
    console.error(`Error en iteración: ${e.message}`);
    if (manifestRes) {
      console.error(`Detalles respuesta: ${manifestRes.status} - ${manifestRes.body}`);
    }
  }
  
  sleep(1);
}

// Función de resumen 
export function handleSummary(data) {
  const safeMetrics = {
    avg_response_time: data.metrics?.http_req_duration?.values?.avg || 'N/A',
    p95_response_time: data.metrics?.http_req_duration?.values?.['p(95)'] || 'N/A',
    request_rate: data.metrics?.http_reqs?.values?.rate || 'N/A',
    failure_rate: data.metrics?.http_req_failed?.values?.rate || 'N/A',
    total_iterations: data.metrics?.iterations?.values?.count || 0,
    status_codes: data.metrics?.http_reqs?.values?.statuses || {},
    error_messages: data.metrics?.errors?.values || []
  };

  // Resultados de checks
  const checksResults = {
    'pull manifest success': data.metrics?.checks?.values?.['pull manifest success'] || 0,
    'manifest valid': data.metrics?.checks?.values?.['manifest valid'] || 0,
    'layer download success': data.metrics?.checks?.values?.['layer download success'] || 0,
    'layer size valid': data.metrics?.checks?.values?.['layer size valid'] || 0
  };

  const summary = {
    metrics: safeMetrics,
    checks: checksResults,
    thresholds: {
      http_req_duration: data.metrics?.http_req_duration?.thresholds || {},
      http_req_failed: data.metrics?.http_req_failed?.thresholds || {}
    }
  };

  console.log('Resumen completo:', JSON.stringify(summary, null, 2));
  
  return {
    'stdout': `Resumen de prueba: ${JSON.stringify(summary, null, 2)}`,
    'summary.json': JSON.stringify(summary)
  };
}