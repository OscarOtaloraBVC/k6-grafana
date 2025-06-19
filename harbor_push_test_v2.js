{
  "annotations": {
    "list": [
      {
        "builtIn": 1,
        "datasource": "-- Grafana --",
        "enable": true,
        "hide": true,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts",
        "type": "dashboard"
      }
    ]
  },
  "editable": true,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "panels": [
    {
      "title": "Total Requests",
      "type": "stat",
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 0,
        "y": 0
      },
      "targets": [
        {
          "expr": "sum(total_requests) by (testid)",
          "format": "time_series",
          "instant": true,
          "interval": "",
          "legendFormat": "Total Requests",
          "refId": "A"
        }
      ],
      "options": {
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": ["lastNotNull"],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              }
            ]
          }
        },
        "overrides": []
      }
    },
    {
      "title": "Checks Success Rate",
      "type": "stat",
      "gridPos": {
        "h": 4,
        "w": 6,
        "x": 6,
        "y": 0
      },
      "targets": [
        {
          "expr": "sum(checks_succeeded) / sum(checks_total) * 100",
          "format": "time_series",
          "instant": true,
          "interval": "",
          "legendFormat": "Success Rate",
          "refId": "A"
        }
      ],
      "options": {
        "colorMode": "value",
        "graphMode": "area",
        "justifyMode": "auto",
        "orientation": "auto",
        "reduceOptions": {
          "calcs": ["lastNotNull"],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 50
              },
              {
                "color": "green",
                "value": 90
              }
            ]
          },
          "unit": "percent"
        },
        "overrides": []
      }
    },
    {
      "title": "Virtual Users",
      "type": "graph",
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 12,
        "y": 0
      },
      "targets": [
        {
          "expr": "vus",
          "interval": "",
          "legendFormat": "Active VUs",
          "refId": "A"
        },
        {
          "expr": "vus_max",
          "interval": "",
          "legendFormat": "Max VUs",
          "refId": "B"
        }
      ],
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        }
      }
    },
    {
      "title": "Authentication Metrics",
      "type": "graph",
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 8
      },
      "targets": [
        {
          "expr": "auth_duration{p=95}",
          "interval": "",
          "legendFormat": "Auth Duration p95",
          "refId": "A"
        },
        {
          "expr": "300",
          "interval": "",
          "legendFormat": "Threshold (300ms)",
          "refId": "B"
        },
        {
          "expr": "auth_success",
          "interval": "",
          "legendFormat": "Auth Success Rate",
          "refId": "C"
        }
      ],
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "ms"
        },
        "overrides": [
          {
            "matcher": {
              "id": "byName",
              "options": "Auth Success Rate"
            },
            "properties": [
              {
                "id": "unit",
                "value": "percentunit"
              }
            ]
          }
        ]
      }
    },
    {
      "title": "HTTP Request Metrics",
      "type": "graph",
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 12,
        "y": 8
      },
      "targets": [
        {
          "expr": "http_req_duration{p=95}",
          "interval": "",
          "legendFormat": "HTTP Req Duration p95",
          "refId": "A"
        },
        {
          "expr": "500",
          "interval": "",
          "legendFormat": "Threshold (500ms)",
          "refId": "B"
        },
        {
          "expr": "http_req_failed",
          "interval": "",
          "legendFormat": "Failed Requests Rate",
          "refId": "C"
        }
      ],
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "ms"
        },
        "overrides": [
          {
            "matcher": {
              "id": "byName",
              "options": "Failed Requests Rate"
            },
            "properties": [
              {
                "id": "unit",
                "value": "percentunit"
              }
            ]
          }
        ]
      }
    },
    {
      "title": "Manifest Pull Metrics",
      "type": "graph",
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 16
      },
      "targets": [
        {
          "expr": "manifest_pull_duration{p=95}",
          "interval": "",
          "legendFormat": "Manifest Pull Duration p95",
          "refId": "A"
        },
        {
          "expr": "400",
          "interval": "",
          "legendFormat": "Threshold (400ms)",
          "refId": "B"
        },
        {
          "expr": "manifest_pull_success",
          "interval": "",
          "legendFormat": "Manifest Pull Success Rate",
          "refId": "C"
        }
      ],
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "ms"
        },
        "overrides": [
          {
            "matcher": {
              "id": "byName",
              "options": "Manifest Pull Success Rate"
            },
            "properties": [
              {
                "id": "unit",
                "value": "percentunit"
              }
            ]
          }
        ]
      }
    },
    {
      "title": "Iteration Duration",
      "type": "graph",
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 12,
        "y": 16
      },
      "targets": [
        {
          "expr": "iteration_duration{p=95}",
          "interval": "",
          "legendFormat": "p95",
          "refId": "A"
        },
        {
          "expr": "iteration_duration{avg}",
          "interval": "",
          "legendFormat": "avg",
          "refId": "B"
        }
      ],
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        }
      },
      "fieldConfig": {
        "defaults": {
          "unit": "ms"
        },
        "overrides": []
      }
    },
    {
      "title": "Checks Summary",
      "type": "table",
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 24
      },
      "targets": [
        {
          "expr": "sum(checks_total) by (testid)",
          "format": "table",
          "instant": true,
          "interval": "",
          "legendFormat": "Total Checks",
          "refId": "A"
        },
        {
          "expr": "sum(checks_succeeded) by (testid)",
          "format": "table",
          "instant": true,
          "interval": "",
          "legendFormat": "Succeeded Checks",
          "refId": "B"
        },
        {
          "expr": "sum(checks_failed) by (testid)",
          "format": "table",
          "instant": true,
          "interval": "",
          "legendFormat": "Failed Checks",
          "refId": "C"
        },
        {
          "expr": "sum(checks_succeeded) / sum(checks_total) * 100",
          "format": "table",
          "instant": true,
          "interval": "",
          "legendFormat": "Success Rate",
          "refId": "D"
        }
      ],
      "options": {
        "showHeader": true,
        "sortBy": []
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 50
              },
              {
                "color": "green",
                "value": 90
              }
            ]
          },
          "unit": "percent"
        },
        "overrides": [
          {
            "matcher": {
              "id": "byName",
              "options": "Success Rate"
            },
            "properties": [
              {
                "id": "unit",
                "value": "percent"
              }
            ]
          },
          {
            "matcher": {
              "id": "byName",
              "options": "Total Checks"
            },
            "properties": [
              {
                "id": "unit",
                "value": "none"
              }
            ]
          },
          {
            "matcher": {
              "id": "byName",
              "options": "Succeeded Checks"
            },
            "properties": [
              {
                "id": "unit",
                "value": "none"
              }
            ]
          },
          {
            "matcher": {
              "id": "byName",
              "options": "Failed Checks"
            },
            "properties": [
              {
                "id": "unit",
                "value": "none"
              }
            ]
          }
        ]
      }
    }
  ],
  "refresh": "5s",
  "schemaVersion": 26,
  "style": "dark",
  "tags": ["k6", "performance", "monitoring"],
  "templating": {
    "list": [
      {
        "description": null,
        "error": null,
        "hide": 0,
        "includeAll": false,
        "label": "Test ID",
        "multi": false,
        "name": "testid",
        "options": [],
        "query": "label_values(checks_total, testid)",
        "refresh": 1,
        "regex": "",
        "skipUrlSync": false,
        "type": "query"
      }
    ]
  },
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "timepicker": {},
  "timezone": "",
  "title": "k6 Performance Dashboard",
  "version": 1
}