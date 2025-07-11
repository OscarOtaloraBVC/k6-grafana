// Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados
import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuración
export let options = {
  stages: [
    // Escenario 1 - 1 minuto
    { duration: '1m', target: 100 },  // Total de VUs para cumplir con todos los servicios
    
    // Escenario 2 - 2 minutos
    { duration: '2m', target: 50 },   // Reducción de VUs
    
    // Escenario 3 - 2 minutos
    { duration: '2m', target: 25 },   // Reducción adicional de VUs
    
    { duration: '1m', target: 0 },    // Enfriamiento
  ],
  thresholds: {
    'http_req_duration{type:harbor}': ['p(95)<500'],
    'http_req_duration{type:artifactory}': ['p(95)<500'],
    'http_req_duration{type:vault}': ['p(95)<500'],
    'http_req_duration{type:keycloak}': ['p(95)<500'],
    'http_req_failed': ['rate<0.5'], // Umbral del 50% para detener la prueba
  },
};

// Variables de entorno actualizadas
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const ARTIFACTORY_URL = (__ENV.ARTIFACTORY_URL || 'https://test-nuam-artifactory.coffeesoft.org/ui/native/k6-prueba/').replace(/\/$/, '');
const VAULT_URL = (__ENV.VAULT_URL || 'http://localhost:8200').replace(/\/$/, '');
const KEYCLOAK_URL = (__ENV.KEYCLOAK_URL || 'https://test-nuam-kc.coffeesoft.org').replace(/\/$/, '');

// Credenciales actualizadas
const CREDENTIALS = {
  harbor: {
    user: __ENV.HARBOR_USER || 'admin',
    pass: __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0',
    project: __ENV.HARBOR_PROJECT || 'library',
    image: __ENV.HARBOR_IMAGE || 'test-image',
    tags: ['30mb', '40mb', '50mb'], // Variación de tags para diferentes tamaños
  },
  artifactory: {
    user: __ENV.ARTIFACTORY_USER || 'admin',
    pass: __ENV.ARTIFACTORY_PASS || 'Nuam123.*',
    repo: __ENV.ARTIFACTORY_REPO || 'k6-prueba',
    files: [
      'test/testfile-15mb.bin',
      'test/testfile-20mb.bin',
      'test/testfile-25mb.bin',
      'test/testfile-30mb.bin'
    ],
  },
  vault: {
    token: __ENV.VAULT_TOKEN || 'hvs.wy9yDkSXpszNTDWfNxNMswQo',
    secrets: [
      'kv_Production/data/data/testingk6'
    ],
  },
  keycloak: {
    realm: __ENV.KEYCLOAK_REALM || 'master',
    client: __ENV.KEYCLOAK_CLIENT_ID || 'admin-cli',
    user: __ENV.KEYCLOAK_USER || 'admin',
    pass: __ENV.KEYCLOAK_PASS || 'c659036218da417b9798c8ff97a0708d',
  },
};

// Funciones auxiliares actualizadas
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function harborPull() {
  const tag = getRandomElement(CREDENTIALS.harbor.tags);
  const manifestUrl = `${HARBOR_URL}/v2/${CREDENTIALS.harbor.project}/${CREDENTIALS.harbor.image}/manifests/${tag}`;
  
  const params = {
    headers: {
      'Authorization': `Bearer ${getHarborToken()}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    tags: { type: 'harbor' },
  };
  
  const res = http.get(manifestUrl, params);
  
  check(res, {
    'harbor pull success': (r) => r.status === 200,
  });
}

function artifactoryPull() {
  const file = getRandomElement(CREDENTIALS.artifactory.files);
  const url = `${ARTIFACTORY_URL}/${CREDENTIALS.artifactory.repo}/${file}`;
  
  const params = {
    auth: 'basic',
    username: CREDENTIALS.artifactory.user,
    password: CREDENTIALS.artifactory.pass,
    tags: { type: 'artifactory' },
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'artifactory download success': (r) => r.status === 200,
  });
}

function vaultSecret() {
  const secret = getRandomElement(CREDENTIALS.vault.secrets);
  const url = `${VAULT_URL}/v1/${secret}`;
  
  const params = {
    headers: {
      'X-Vault-Token': CREDENTIALS.vault.token,
    },
    tags: { type: 'vault' },
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'vault secret read success': (r) => r.status === 200,
  });
}

function keycloakAuth() {
  const url = `${KEYCLOAK_URL}/realms/${CREDENTIALS.keycloak.realm}/protocol/openid-connect/token`;
  
  const payload = {
    client_id: CREDENTIALS.keycloak.client,
    username: CREDENTIALS.keycloak.user,
    password: CREDENTIALS.keycloak.pass,
    grant_type: 'password',
  };
  
  const params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    tags: { type: 'keycloak' },
  };
  
  const res = http.post(url, payload, params);
  
  check(res, {
    'keycloak auth success': (r) => r.status === 200,
  });
}

function getHarborToken() {
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: CREDENTIALS.harbor.user,
    password: CREDENTIALS.harbor.pass
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  const res = http.post(url, payload, params);
  check(res, {
    'harbor login success': (r) => r.status === 200,
  });
  
  return res.json().token;
}

// Función principal actualizada
export default function () {
  // Determinar qué servicio ejecutar basado en el escenario y distribución de carga
  const vuId = __VU % 100; // ID único virtual para cada VU
  
  // Distribución de peticiones según los escenarios
  if (__ENV.SCENARIO === '1' || !__ENV.SCENARIO) {
    // Escenario 1: 25 Harbor, 25 Artifactory, 100 Vault, 100 Keycloak (total 250 peticiones/s)
    if (vuId < 10) { // 10% para Harbor (~25 peticiones/s)
      harborPull();
    } else if (vuId < 20) { // 10% para Artifactory (~25 peticiones/s)
      artifactoryPull();
    } else if (vuId < 60) { // 40% para Vault (~100 peticiones/s)
      vaultSecret();
    } else { // 40% para Keycloak (~100 peticiones/s)
      keycloakAuth();
    }
  } else if (__ENV.SCENARIO === '2') {
    // Escenario 2: 15 Harbor, 15 Artifactory, 50 Vault, 50 Keycloak (total 130 peticiones/s)
    if (vuId < 12) { // ~12% para Harbor (~15 peticiones/s)
      harborPull();
    } else if (vuId < 23) { // ~11% para Artifactory (~15 peticiones/s)
      artifactoryPull();
    } else if (vuId < 61) { // ~38% para Vault (~50 peticiones/s)
      vaultSecret();
    } else { // ~39% para Keycloak (~50 peticiones/s)
      keycloakAuth();
    }
  } else if (__ENV.SCENARIO === '3') {
    // Escenario 3: 10 Harbor, 10 Artifactory, 25 Vault, 25 Keycloak (total 70 peticiones/s)
    if (vuId < 14) { // ~14% para Harbor (~10 peticiones/s)
      harborPull();
    } else if (vuId < 29) { // ~15% para Artifactory (~10 peticiones/s)
      artifactoryPull();
    } else if (vuId < 64) { // ~35% para Vault (~25 peticiones/s)
      vaultSecret();
    } else { // ~36% para Keycloak (~25 peticiones/s)
      keycloakAuth();
    }
  }
  
  sleep(1);
}