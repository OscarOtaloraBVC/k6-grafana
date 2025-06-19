import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Definimos las métricas personalizadas
const successfulPushes = new Counter('harbor_successful_pushes_total');
const failedPushes = new Counter('harbor_failed_pushes_total');
const pushDuration = new Trend('harbor_push_duration_ms');

export const options = {
    scenarios: {
        constant_load: {
            executor: 'constant-arrival-rate',
            rate: 10,
            timeUnit: '1s',
            duration: '5m',
            preAllocatedVUs: 10,
            maxVUs: 50,
        },
    },
    // Configuración extendida para Prometheus
    ext: {
        'loadimpact': {
            'name': 'Harbor Push Test',
        },
        'prometheus-rw': {
            'url': 'http://k6-prometheus-service:9090/api/v1/write',
            'tagsAsLabels': ['testid', 'vu', 'iter', 'url'],
            'sendInterval': '5s',
        }
    }
};

function simulateHarborPush() {
    const start = Date.now();
    const testid = `test-${__VU}`;
    
    // URL de ejemplo - reemplazar con tu endpoint real de Harbor
    const url = 'http://harbor-service/api/v2.0/projects';
    const payload = JSON.stringify({
        project_name: `test-project-${__VU}-${__ITER}`,
    });
    
    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa('username:password'),
        },
        tags: { testid: testid },
    };
    
    const res = http.post(url, payload, params);
    const duration = Date.now() - start;
    
    pushDuration.add(duration, { testid: testid });
    
    if (res.status === 201) {
        successfulPushes.add(1, { testid: testid });
    } else {
        failedPushes.add(1, { testid: testid });
    }
    
    check(res, {
        'status is 201': (r) => r.status === 201,
    });
    
    return duration;
}

export default function () {
    simulateHarborPush();
    sleep(0.1);
}