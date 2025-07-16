import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';  
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';
const DOCKER_HOST = __ENV.DOCKER_HOST || 'unix:///var/run/docker.sock';

// Consultas Prometheus
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Generador de imágenes aleatorias
function generateRandomImage() {
    const minSize = 28 * 1024 * 1024; // 28MB
    const maxSize = 50 * 1024 * 1024; // 50MB
    const size = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    return new Uint8Array(size).map(() => Math.floor(Math.random() * 256));
}

// Autenticación en Harbor
function getHarborToken() {
    const url = `${HARBOR_URL}/service/token?service=harbor-registry&scope=repository:${PROJECT}/${IMAGE}:pull,push`;
    const credentials = `${USERNAME}:${PASSWORD}`;
    const headers = {
        'Authorization': `Basic ${btoa(credentials)}`,
    };
    
    const res = http.get(url, { headers: headers });
    if (res.status !== 200) {
        throw new Error(`Failed to get Harbor token: ${res.body}`);
    }
    
    return JSON.parse(res.body).token;
}

// Subir imagen a Harbor
function uploadImage(token, imageData, tag) {
    const url = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/blobs/uploads/`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
    };
    
    // Iniciar upload
    const initRes = http.post(url, null, { headers: headers });
    if (initRes.status !== 202) {
        throw new Error(`Failed to init upload: ${initRes.body}`);
    }
    
    // Obtener URL de upload
    const uploadUrl = initRes.headers['Location'];
    
    // Subir datos
    const uploadRes = http.put(`${uploadUrl}&digest=sha256:${createSHA256Hash(imageData)}`, imageData, {
        headers: headers,
    });
    
    if (uploadRes.status !== 201) {
        throw new Error(`Failed to upload image: ${uploadRes.body}`);
    }
    
    return uploadRes;
}

// Función simulada para crear hash (en producción usaría una librería adecuada)
function createSHA256Hash(data) {
    // Esto es una simulación - en un caso real usarías crypto.subtle.digest()
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
}

// Obtener métricas de Prometheus
async function getPrometheusMetrics(query) {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = http.get(url);
    
    if (res.status !== 200) {
        console.error(`Error querying Prometheus: ${res.body}`);
        return null;
    }
    
    return JSON.parse(res.body).data.result;
}

// Eliminar imagen Docker
function dockerRm(imageRef) {
    try {
        const cmd = `docker -H ${DOCKER_HOST} rmi ${imageRef}`;
        const result = exec(cmd, { output: 'inherit' });
        return result.status === 0;
    } catch (error) {
        console.error(`Error deleting image ${imageRef}: ${error}`);
        return false;
    }
}

export const options = {
    stages: [
        { duration: '1m25s', target: 50 },
        { duration: '1m25s', target: 25 },
        { duration: '1m25s', target: 15 },
        { duration: '1m25s', target: 10 }
    ],
    thresholds: {
        http_req_duration: ['p(95)<1000'],
        http_req_failed: ['rate<0.01'],
    },
    duration: '5m',
};

export default function () {
    // Obtener token de Harbor
    const token = getHarborToken();
    const imageData = generateRandomImage();
    const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const imageRef = `${HARBOR_URL}/${PROJECT}/${IMAGE}:${randomTag}`;
    
    // Subir imagen
    const uploadStart = Date.now();
    let uploadSuccess = false;
    try {
        const uploadRes = uploadImage(token, imageData, randomTag);
        uploadSuccess = uploadRes.status === 201;
    } catch (e) {
        console.error(`Upload failed: ${e.message}`);
        uploadSuccess = false;
    }
    
    const uploadDuration = Date.now() - uploadStart;
    
    // Eliminar imagen
    sleep(0.5);
    const deleteSuccess = dockerRm(imageRef);
    
    // Métricas
    return {
        upload_duration: uploadDuration,
        upload_success: uploadSuccess,
        delete_success: deleteSuccess,
    };
}

export function handleSummary(data) {
    // Obtener métricas de Prometheus
    const cpuMetrics = getPrometheusMetrics(CPU_QUERY);
    const memoryMetrics = getPrometheusMetrics(MEMORY_QUERY);
    
    // Procesar métricas
    let prometheusData = {};
    if (cpuMetrics) {
        cpuMetrics.forEach((m) => {
            prometheusData[`cpu_usage_${m.metric.container}`] = m.value[1];
        });
    }
    
    if (memoryMetrics) {
        memoryMetrics.forEach((m) => {
            prometheusData[`memory_usage_${m.metric.container}`] = m.value[1];
        });
    }
    
    // Resumen consolidado
    const combinedData = {
        ...data,
        prometheus: prometheusData,
    };
    
    return {
        stdout: textSummary(combinedData, { indent: ' ', enableColors: true }),
        'summary.json': JSON.stringify(combinedData),
    };
}