import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Definimos las métricas personalizadas
const successfulPushes = new Counter('harbor_successful_pushes_total');
const failedPushes = new Counter('harbor_failed_pushes_total');
const pushDuration = new Trend('harbor_push_duration_ms');

// Configuración común
const testid = `test-${__ENV.TEST_ID || Date.now()}`;
const harborUrl = __ENV.HARBOR_URL || 'http://harbor-service/api/v2.0/projects';

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
    // Configuración para Prometheus
    ext: {
        'loadimpact': {
            'name': 'Harbor Push Test',
        },
        'prometheus-rw': {
            'url': __ENV.PROMETHEUS_URL || 'http://k6-prometheus-service:9090/api/v1/write',
            'tagsAsLabels': ['testid', 'vu', 'iter', 'url'],
            'sendInterval': '5s',
        }
    },
    tags: {
        testid: testid
    }
};

function simulateHarborPush() {
    const start = Date.now();
    
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
    
    try {
        const res = http.post(harborUrl, payload, params);
        const duration = Date.now() - start;
        
        pushDuration.add(duration, { testid: testid });
        
        if (res.status === 201) {
            successfulPushes.add(1, { testid: testid });
            return duration;
        } else {
            failedPushes.add(1, { testid: testid });
            return null;
        }
        
        check(res, {
            'status is 201': (r) => r.status === 201,
        });
    } catch (e) {
        failedPushes.add(1, { testid: testid });
        return null;
    }
}

export default function () {
    const duration = simulateHarborPush();
    if (duration !== null) {
        sleep(0.1);
    }
}