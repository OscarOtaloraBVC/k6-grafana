import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Métricas
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
    
    const res = http.post(
        'http://harbor-service/api/v2.0/projects',
        JSON.stringify({ project_name: `test-project-${__VU}-${__ITER}` }),
        {
            headers: { 'Content-Type': 'application/json' },
            tags: { testid }
        }
    );
    
    const duration = Date.now() - start;
    pushDuration.add(duration, { testid });
    
    if (res.status === 201) {
        successfulPushes.add(1, { testid });
    } else {
        failedPushes.add(1, { testid });
    }
    
    check(res, { 'status is 201': (r) => r.status === 201 });
    
    return duration;
}

export default function () {
    simulateHarborPush();
    sleep(0.1);
}