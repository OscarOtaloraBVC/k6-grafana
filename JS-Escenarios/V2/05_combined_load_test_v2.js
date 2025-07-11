// Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Métricas personalizadas
const harborResponseTime = new Trend('harbor_response_time');
const artifactoryResponseTime = new Trend('artifactory_response_time');
const vaultResponseTime = new Trend('vault_response_time');
const keycloakResponseTime = new Trend('keycloak_response_time');

const harborErrorRate = new Rate('harbor_error_rate');
const artifactoryErrorRate = new Rate('artifactory_error_rate');
const vaultErrorRate = new Rate('vault_error_rate');
const keycloakErrorRate = new Rate('keycloak_error_rate');

// Configuración de escenarios (igual que en la versión anterior)
export let options = {
  scenarios: {
    // ... (configuración de escenarios sin cambios)
  },
  thresholds: {
    // ... (thresholds sin cambios)
  },
  discardResponseBodies: false,
};

// Variables de entorno HARBOR
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const HARBOR_USER = __ENV.HARBOR_USER || 'admin';
const HARBOR_PASS = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const HARBOR_PROJECT = __ENV.HARBOR_PROJECT || 'library';
const HARBOR_IMAGE = __ENV.HARBOR_IMAGE || 'test-image';
const HARBOR_TAG = __ENV.HARBOR_TAG || '30mb';

// Variables de entorno ARTIFACTORY
const ARTIFACTORY_URL = (__ENV.ARTIFACTORY_URL || 'https://test-nuam-artifactory.coffeesoft.org/artifactory').replace(/\/$/, '');
const ARTIFACTORY_USER = __ENV.ARTIFACTORY_USER || 'admin';
const ARTIFACTORY_PASS = __ENV.ARTIFACTORY_PASS || 'Nuam123.*';
const ARTIFACTORY_REPO = __ENV.ARTIFACTORY_REPO || 'k6-prueba';
const ARTIFACTORY_FILE_PATHS = [
  'testfile-15mb.bin',
  'testfile-20mb.bin',
  'testfile-25mb.bin',
  'testfile-30mb.bin'
];

// ... (resto de variables de entorno sin cambios)

// Función para Harbor - Pull de imágenes (versión corregida)
export function harborPull() {
  // Primero obtenemos el token
  const token = getHarborToken();
  if (!token) return; // Si falla el login, salimos
  
  const manifestUrl = `${HARBOR_URL}/v2/${HARBOR_PROJECT}/${HARBOR_IMAGE}/manifests/${HARBOR_TAG}`;
  
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    tags: { type: 'harbor' },
    timeout: '90s'
  };
  
  const start = Date.now();
  const res = http.get(manifestUrl, params);
  const duration = Date.now() - start;
  harborResponseTime.add(duration);
  
  const success = check(res, {
    'harbor pull success': (r) => r.status === 200,
  });
  
  if (!success) {
    harborErrorRate.add(1);
    console.log(`Harbor pull failed with status: ${res.status}, response: ${res.body}`);
  } else {
    harborErrorRate.add(0);
  }
}

// Función para Artifactory - Descarga de artefactos (versión corregida)
export function artifactoryPull() {
  const filePath = getRandomElement(ARTIFACTORY_FILE_PATHS);
  const url = `${ARTIFACTORY_URL}/${ARTIFACTORY_REPO}/${filePath}`;
  
  const params = {
    auth: 'basic',
    username: ARTIFACTORY_USER,
    password: ARTIFACTORY_PASS,
    tags: { type: 'artifactory' },
    timeout: '90s'
  };
  
  const start = Date.now();
  const res = http.get(url, params);
  const duration = Date.now() - start;
  artifactoryResponseTime.add(duration);
  
  const success = check(res, {
    'artifactory download success': (r) => r.status === 200,
    'artifactory has content': (r) => r.body.length > 0
  });
  
  if (!success) {
    artifactoryErrorRate.add(1);
    console.log(`Artifactory download failed. Status: ${res.status}, Headers: ${JSON.stringify(res.headers)}`);
  } else {
    artifactoryErrorRate.add(0);
  }
}

// Función auxiliar para obtener token de Harbor (versión corregida)
function getHarborToken() {
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: HARBOR_USER,
    password: HARBOR_PASS
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '30s'
  };
  
  const res = http.post(url, payload, params);
  
  // Manejo mejorado de errores
  if (!check(res, {
    'harbor login success': (r) => r.status === 200,
    'harbor has token': (r) => r.json().token !== undefined
  })) {
    console.log(`Harbor login failed. Status: ${res.status}, Response: ${res.body}`);
    return null;
  }
  
  return res.json().token;
}

// ... (resto de funciones sin cambios)

// Función de inicialización para verificar conectividad (versión mejorada)
export function setup() {
  console.log('Validando conectividad con los servicios...');
  
  // Verificar Harbor
  const harborRes = http.get(`${HARBOR_URL}/api/v2.0/ping`);
  if (!check(harborRes, { 'Harbor available': (r) => r.status === 200 })) {
    console.log(`Harbor ping failed. Status: ${harborRes.status}, Response: ${harborRes.body}`);
  }

  // Verificar Artifactory
  const artifactoryRes = http.get(`${ARTIFACTORY_URL}/api/system/ping`);
  if (!check(artifactoryRes, { 'Artifactory available': (r) => r.status === 200 })) {
    console.log(`Artifactory ping failed. Status: ${artifactoryRes.status}, Response: ${artifactoryRes.body}`);
  }

  // ... (verificaciones para Vault y Keycloak)

  console.log('Validación de conectividad completada');
}