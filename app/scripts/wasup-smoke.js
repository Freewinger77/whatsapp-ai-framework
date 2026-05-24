#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs/promises';

const DEFAULT_BASE_URL = 'https://wasup2.northeurope.cloudapp.azure.com';
const DEFAULT_STATUS_FILE = '/var/log/wasup2-smoke-status.json';
const DEFAULT_REAL_DISCONNECTED_GRACE_MINUTES = 10;

const args = parseArgs(process.argv.slice(2));
const config = {
    baseUrl: trimTrailingSlash(args.baseUrl || process.env.WASUP_SMOKE_BASE_URL || DEFAULT_BASE_URL),
    apiKey: process.env.WASUP_SMOKE_API_KEY || '',
    publicDashboardMode: parseBoolean(
        args.publicDashboardMode ?? process.env.WASUP_SMOKE_PUBLIC_DASHBOARD,
        true
    ),
    timeoutMs: parseInteger(args.timeoutMs || process.env.WASUP_SMOKE_TIMEOUT_MS, 12000, 1000),
    qrPollMs: parseInteger(args.qrPollMs || process.env.WASUP_SMOKE_QR_POLL_MS, 12000, 1000),
    staleSmokeMaxAgeMs: parseInteger(
        args.staleSmokeMaxAgeMinutes || process.env.WASUP_SMOKE_STALE_MAX_AGE_MINUTES,
        60,
        5
    ) * 60 * 1000,
    statusFile: args.statusFile || process.env.WASUP_SMOKE_STATUS_FILE || DEFAULT_STATUS_FILE,
    writeStatusFile: parseBoolean(args.writeStatusFile ?? process.env.WASUP_SMOKE_WRITE_STATUS_FILE, true),
    connectForQr: parseBoolean(args.connectForQr ?? process.env.WASUP_SMOKE_CONNECT_QR, true),
    realInstanceCheck: parseBoolean(
        args.realInstanceCheck ?? process.env.WASUP_SMOKE_REAL_INSTANCE_CHECK,
        true
    ),
    reconnectReal: parseBoolean(
        args.reconnectReal ?? process.env.WASUP_SMOKE_RECONNECT_REAL,
        false
    ),
    realDisconnectedGraceMs: parseInteger(
        args.realDisconnectedGraceMinutes || process.env.WASUP_SMOKE_REAL_DISCONNECTED_GRACE_MINUTES,
        DEFAULT_REAL_DISCONNECTED_GRACE_MINUTES,
        0
    ) * 60 * 1000,
    buttonEndpoints: parseList(args.buttonEndpoints || process.env.WASUP_SMOKE_BUTTON_ENDPOINTS),
    logDebug: parseBoolean(args.debug ?? process.env.WASUP_SMOKE_DEBUG, false)
};

const run = {
    id: `smoke-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
    startedAt: new Date().toISOString(),
    checks: [],
    failures: [],
    cleanup: []
};

let tempInstanceId = null;

process.on('SIGINT', async () => {
    log('warn', 'Interrupted; cleanup will run before exit');
    if (tempInstanceId) {
        await deleteInstanceBestEffort(tempInstanceId, 'interrupted');
    }
    process.exit(130);
});

main()
    .then(async () => {
        run.finishedAt = new Date().toISOString();
        run.ok = run.failures.length === 0;
        await writeStatus();
        log(run.ok ? 'pass' : 'fail', 'Smoke run complete', summarizeRun());
        process.exit(run.ok ? 0 : 1);
    })
    .catch(async (error) => {
        fail('unhandled', error.message);
        run.finishedAt = new Date().toISOString();
        run.ok = false;
        await writeStatus();
        log('fail', 'Smoke run crashed', { error: error.message, ...summarizeRun() });
        process.exit(1);
    });

async function main() {
    log('info', 'Starting wasup smoke run', {
        runId: run.id,
        baseUrl: config.baseUrl,
        publicDashboardMode: config.publicDashboardMode,
        apiKeyConfigured: Boolean(config.apiKey),
        realInstanceCheck: config.realInstanceCheck,
        reconnectReal: config.reconnectReal
    });

    const previousStatus = await readPreviousStatus();

    await checkHttpsAndRedirect();
    await checkHealth();
    await checkDocsAndDashboard();

    const instances = await api('GET', '/api/instances');
    assert(instances.status === 200, 'instances_list_http', `Expected 200 from /api/instances, got ${instances.status}`);
    assert(instances.body?.success === true && Array.isArray(instances.body.instances), 'instances_list_shape', 'Invalid /api/instances response');
    const instanceList = instances.body?.instances || [];
    await cleanupStaleSmokeInstances(instanceList);
    await checkRealInstances(instanceList, previousStatus);

    tempInstanceId = run.id;
    try {
        await createTempInstance(tempInstanceId);
        await checkTempInstance(tempInstanceId);
        await checkDisconnectedSend(tempInstanceId);
        await checkDisconnectedLinkSend(tempInstanceId);
        await checkButtonNegativePath(tempInstanceId);
        await checkReactionNegativePath(tempInstanceId);
        await checkInteractiveValidation(tempInstanceId);

        if (config.connectForQr) {
            await checkConnectAndQr(tempInstanceId);
        } else {
            await checkQrEndpoint(tempInstanceId, ['disconnected']);
        }

        await checkLogs(tempInstanceId);
        await deleteTempInstance(tempInstanceId);
        tempInstanceId = null;
    } finally {
        if (tempInstanceId) {
            await deleteInstanceBestEffort(tempInstanceId, 'final_cleanup');
            tempInstanceId = null;
        }
    }
}

async function checkHttpsAndRedirect() {
    const parsed = new URL(config.baseUrl);
    const dashboard = await request('GET', '/', { expectJson: false });
    assert(dashboard.status === 200, 'https_dashboard_http', `Expected HTTPS dashboard 200, got ${dashboard.status}`);
    assert(
        /text\/html/i.test(dashboard.headers.get('content-type') || '') || /<!doctype html/i.test(dashboard.text || ''),
        'https_dashboard_html',
        'Dashboard did not return HTML'
    );
    pass('https_dashboard', { status: dashboard.status });

    if (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
        skip('http_redirect', 'Base URL is not a public HTTPS endpoint');
        return;
    }

    const httpUrl = `http://${parsed.host}/`;
    const redirect = await requestUrl('GET', httpUrl, { expectJson: false, redirect: 'manual' });
    assert([301, 302, 307, 308].includes(redirect.status), 'http_redirect_status', `Expected HTTP redirect, got ${redirect.status}`);
    const location = redirect.headers.get('location') || '';
    assert(location.startsWith('https://'), 'http_redirect_location', 'HTTP redirect did not target HTTPS');
    pass('http_redirect', { status: redirect.status, locationHost: safeLocationHost(location) });
}

async function checkHealth() {
    const response = await api('GET', '/api/health');
    assert(response.status === 200, 'health_http', `Expected /api/health 200, got ${response.status}`);
    assert(response.body?.status === 'ok', 'health_status', 'Health status was not ok');
    assert(Number.isFinite(Number(response.body?.uptime)), 'health_uptime', 'Health uptime missing');
    pass('health', {
        uptime: Math.round(Number(response.body.uptime)),
        instances: response.body.instances
    });
}

async function checkDocsAndDashboard() {
    const openapi = await request('GET', '/openapi.yaml', { expectJson: false });
    assert(openapi.status === 200, 'openapi_http', `Expected /openapi.yaml 200, got ${openapi.status}`);
    assert(/openapi:\s*3\./.test(openapi.text || ''), 'openapi_body', 'OpenAPI document did not look valid');
    assert(/\/api\/instances\/\{instanceId\}\/send\/interactive/.test(openapi.text || ''), 'openapi_interactive_path', 'OpenAPI is missing interactive send endpoint');
    assert(/\/api\/instances\/\{instanceId\}\/react/.test(openapi.text || ''), 'openapi_react_path', 'OpenAPI is missing react endpoint');
    assert(/QuickReplyButtons|ctaUrl|ReactionRequest/.test(openapi.text || ''), 'openapi_interactive_schema', 'OpenAPI is missing interactive/reaction schema');
    pass('openapi', { status: openapi.status });

    const docs = await request('GET', '/docs', { expectJson: false });
    assert(docs.status === 200, 'docs_http', `Expected /docs 200, got ${docs.status}`);
    assert(/Wasup API Documentation|api-reference/.test(docs.text || ''), 'docs_body', 'Docs page missing expected content');
    pass('docs', { status: docs.status });

    const playground = await request('GET', '/test', { expectJson: false });
    assert(playground.status === 200, 'playground_http', `Expected /test 200, got ${playground.status}`);
    assert(/interactive-message-playground|Quick Reply Buttons|CTA Link Button|Send reaction/i.test(playground.text || ''), 'playground_interactive_markers', 'Playground is missing interactive/reaction controls');
    pass('playground_interactive', { status: playground.status });

    const dashboardConfig = await request('GET', '/api/dashboard-config');
    assert(dashboardConfig.status === 200, 'dashboard_config_http', `Expected /api/dashboard-config 200, got ${dashboardConfig.status}`);
    assert(dashboardConfig.body?.success === true, 'dashboard_config_shape', 'Invalid dashboard config response');
    if (!config.apiKey && config.publicDashboardMode) {
        assert(
            dashboardConfig.body.allowPublicDashboard === true || dashboardConfig.body.dashboardRequiresApiKey === false,
            'dashboard_public_mode',
            'Public dashboard mode was requested but dashboard still requires an API key'
        );
    }
    pass('dashboard_config', {
        allowPublicDashboard: dashboardConfig.body.allowPublicDashboard,
        dashboardRequiresApiKey: dashboardConfig.body.dashboardRequiresApiKey
    });
}

async function cleanupStaleSmokeInstances(instances) {
    const now = Date.now();
    const stale = instances.filter((instance) => {
        if (!isSmokeInstance(instance)) return false;
        const createdAt = Date.parse(instance.createdAt || '');
        return !Number.isFinite(createdAt) || now - createdAt > config.staleSmokeMaxAgeMs;
    });

    for (const instance of stale) {
        await deleteInstanceBestEffort(instance.id, 'stale');
    }

    pass('stale_cleanup', { removed: stale.length });
}

async function checkRealInstances(instances, previousStatus) {
    if (!config.realInstanceCheck) {
        run.realInstances = {
            enabled: false,
            checkedAt: new Date().toISOString()
        };
        skip('real_instances', 'Real instance check disabled');
        return;
    }

    const realInstances = instances.filter((instance) => !isSmokeInstance(instance));
    const previousById = new Map(
        (previousStatus?.realInstances?.instances || [])
            .filter((instance) => instance?.id)
            .map((instance) => [instance.id, instance])
    );
    const now = Date.now();
    const checkedAt = new Date(now).toISOString();
    const summaries = [];

    for (const instance of realInstances) {
        const status = getConnectionStatus(instance);
        const hasSavedCredentials = typeof instance.hasSavedCredentials === 'boolean'
            ? instance.hasSavedCredentials
            : null;
        const previous = previousById.get(instance.id);
        const previousNotConnected = previous && previous.status !== 'connected';
        const notConnected = status !== 'connected';
        const disconnectedSince = notConnected
            ? (previousNotConnected && previous.disconnectedSince ? previous.disconnectedSince : checkedAt)
            : null;
        const disconnectedMs = disconnectedSince ? Math.max(0, now - Date.parse(disconnectedSince)) : 0;
        const logsResult = notConnected ? await fetchInstanceLogs(instance.id) : { logs: [] };
        const manualRepairReason = getManualRepairReason(instance, logsResult.logs);
        const reconnectAttempt = await maybeReconnectRealInstance(instance, status, hasSavedCredentials, manualRepairReason);
        const graceExceeded = notConnected &&
            hasSavedCredentials === true &&
            !manualRepairReason &&
            disconnectedMs >= config.realDisconnectedGraceMs;
        const authUnknownFailure = notConnected &&
            hasSavedCredentials === null &&
            !manualRepairReason;

        const summary = {
            id: instance.id,
            name: instance.name || instance.id,
            status,
            authState: hasSavedCredentials === null
                ? 'unknown'
                : (hasSavedCredentials ? 'present' : 'missing'),
            classification: classifyRealInstance(status, hasSavedCredentials, manualRepairReason),
            disconnectedSince,
            disconnectedSeconds: Math.round(disconnectedMs / 1000),
            graceExceeded,
            manualRepairReason,
            reconnectAttempt,
            logReadError: logsResult.error
        };
        summaries.push(summary);

        if (graceExceeded) {
            fail(
                'real_instance_disconnected',
                `${instance.id} has saved credentials but has not been connected for ${Math.round(disconnectedMs / 1000)}s`
            );
        } else if (authUnknownFailure) {
            fail(
                'real_instance_auth_unknown',
                `${instance.id} is not connected and the API did not report whether saved credentials exist`
            );
        }
    }

    const counts = summaries.reduce((acc, instance) => {
        acc[instance.classification] = (acc[instance.classification] || 0) + 1;
        return acc;
    }, {});

    run.realInstances = {
        enabled: true,
        checkedAt,
        graceSeconds: Math.round(config.realDisconnectedGraceMs / 1000),
        reconnectEnabled: config.reconnectReal,
        count: summaries.length,
        counts,
        instances: summaries
    };

    pass('real_instances', {
        count: summaries.length,
        connected: counts.connected || 0,
        credentialedDisconnected: counts.credentialed_disconnected || 0,
        manualQrRequired: counts.manual_qr_required || 0,
        authUnknown: counts.auth_unknown_not_connected || 0,
        reconnectAttempts: summaries.filter((instance) => instance.reconnectAttempt?.attempted).length
    });
}

async function maybeReconnectRealInstance(instance, status, hasSavedCredentials, manualRepairReason) {
    if (
        !config.reconnectReal ||
        hasSavedCredentials !== true ||
        manualRepairReason ||
        status === 'connected' ||
        status === 'connecting' ||
        status === 'reconnecting'
    ) {
        return { attempted: false };
    }

    try {
        const response = await api('POST', `/api/instances/${encodeURIComponent(instance.id)}/connect`);
        const result = {
            attempted: true,
            status: response.status,
            success: response.body?.success === true,
            message: summarizeError(response.body?.message || response.body?.error || response.text)
        };
        log(result.success ? 'pass' : 'warn', 'Real instance reconnect attempted', {
            id: instance.id,
            status: result.status,
            success: result.success,
            result: result.message
        });
        return result;
    } catch (error) {
        log('warn', 'Real instance reconnect failed to call API', {
            id: instance.id,
            error: error.message
        });
        return {
            attempted: true,
            success: false,
            error: summarizeError(error.message)
        };
    }
}

async function createTempInstance(id) {
    const response = await api('POST', '/api/instances', {
        id,
        name: `Smoke Test ${id}`,
        webhookUrl: ''
    });
    assert([200, 201].includes(response.status), 'create_instance_http', `Expected create 201, got ${response.status}`);
    assert(response.body?.success === true && response.body.instance?.id === id, 'create_instance_shape', 'Invalid create instance response');
    pass('create_instance', { id, status: response.body.instance.status });
}

async function checkTempInstance(id) {
    const response = await api('GET', `/api/instances/${encodeURIComponent(id)}`);
    assert(response.status === 200, 'get_instance_http', `Expected get instance 200, got ${response.status}`);
    assert(response.body?.instance?.id === id, 'get_instance_shape', 'Invalid get instance response');
    assert(response.body.instance.status === 'disconnected', 'new_instance_disconnected', 'New temp instance was not disconnected');
    pass('get_instance', { id, status: response.body.instance.status });
}

async function checkDisconnectedSend(id) {
    const response = await api('POST', `/api/instances/${encodeURIComponent(id)}/send`, {
        to: '15555550123',
        message: `wasup smoke ${run.id}`,
        skipContactSave: true,
        delayEnabled: false,
        typingSimulation: false
    });
    assert(response.status === 400, 'send_negative_http', `Expected disconnected send 400, got ${response.status}`);
    assert(/not connected|disconnect/i.test(response.body?.error || response.text || ''), 'send_negative_message', 'Disconnected send did not fail cleanly');
    pass('send_negative', { status: response.status, errorClass: 'not_connected' });
}

async function checkDisconnectedLinkSend(id) {
    const response = await api('POST', `/api/instances/${encodeURIComponent(id)}/send`, {
        to: '15555550123',
        message: `wasup link smoke ${run.id}`,
        link: { url: 'https://example.com/wasup-smoke' },
        linkPreview: true,
        skipContactSave: true,
        delayEnabled: false,
        typingSimulation: false
    });
    assert(response.status === 400, 'link_send_negative_http', `Expected disconnected link send 400, got ${response.status}`);
    assert(/not connected|disconnect/i.test(response.body?.error || response.text || ''), 'link_send_negative_message', 'Disconnected link send did not fail cleanly');
    pass('link_send_negative', { status: response.status, errorClass: 'not_connected' });
}

async function checkButtonNegativePath(id) {
    const endpoints = await discoverButtonEndpoints();
    if (endpoints.length === 0) {
        skip('button_negative', 'No button/custom send endpoint advertised');
        return;
    }

    for (const endpoint of endpoints) {
        const concreteEndpoint = endpoint
            .replace('{instanceId}', encodeURIComponent(id))
            .replace('{id}', encodeURIComponent(id))
            .replace(':id', encodeURIComponent(id));
        const response = await api('POST', concreteEndpoint, {
            to: '15555550123',
            message: `wasup button smoke ${run.id}`,
            text: `wasup button smoke ${run.id}`,
            ctaUrl: { url: 'https://example.com/wasup-smoke', label: 'Open' },
            buttons: [{ id: 'ok', text: 'OK' }],
            skipContactSave: true
        });
        assert(response.status >= 400 && response.status < 500, 'button_negative_http', `Expected clean 4xx from ${concreteEndpoint}, got ${response.status}`);
        assert(/not connected|disconnect/i.test(response.body?.error || response.text || ''), 'button_negative_message', 'Disconnected button send did not fail cleanly');
        pass('button_negative', { endpoint: concreteEndpoint, status: response.status });
    }
}

async function checkReactionNegativePath(id) {
    const response = await api('POST', `/api/instances/${encodeURIComponent(id)}/react`, {
        to: '15555550123',
        messageId: `wasup-react-smoke-${run.id}`,
        emoji: '👍',
        fromMe: false
    });
    assert(response.status >= 400 && response.status < 500, 'reaction_negative_http', `Expected clean 4xx from react endpoint, got ${response.status}`);
    assert(/not connected|disconnect/i.test(response.body?.error || response.text || ''), 'reaction_negative_message', 'Disconnected reaction send did not fail cleanly');
    pass('reaction_negative', { status: response.status });
}

async function checkInteractiveValidation(id) {
    const response = await api('POST', `/api/instances/${encodeURIComponent(id)}/send/interactive`, {
        to: '15555550123',
        message: `bad interactive smoke ${run.id}`,
        link: { url: 'ftp://example.com/not-allowed' },
        buttons: [{ id: 'too-long', text: 'This button label is too long' }],
        skipContactSave: true
    });
    assert(response.status === 400, 'interactive_validation_http', `Expected validation 400, got ${response.status}`);
    assert(Array.isArray(response.body?.details), 'interactive_validation_shape', 'Validation error did not include details array');
    assert(
        response.body.details.some((detail) => /http|button/i.test(detail)),
        'interactive_validation_details',
        'Validation details did not mention URL/button errors'
    );
    pass('interactive_validation', { status: response.status, details: response.body.details.length });
}

async function discoverButtonEndpoints() {
    if (config.buttonEndpoints.length > 0) {
        return config.buttonEndpoints;
    }

    const openapi = await request('GET', '/openapi.yaml', { expectJson: false });
    if (openapi.status !== 200 || !openapi.text) {
        return [];
    }

    const endpoints = [];
    const pathMatches = openapi.text.matchAll(/^\s{2}(\/api\/[^:\n]*(?:button|interactive|template)[^:\n]*):\s*$/gim);
    for (const match of pathMatches) {
        endpoints.push(match[1]);
    }
    return [...new Set(endpoints)];
}

async function checkConnectAndQr(id) {
    const connect = await api('POST', `/api/instances/${encodeURIComponent(id)}/connect`);
    assert([200, 400].includes(connect.status), 'connect_http', `Expected connect 200 or clean 400, got ${connect.status}`);
    if (connect.status === 400) {
        assert(connect.body?.error, 'connect_error_shape', 'Connect failed without JSON error');
        pass('connect_negative', { status: connect.status, error: summarizeError(connect.body.error) });
        await checkQrEndpoint(id, ['disconnected', 'connecting']);
        return;
    }

    pass('connect_started', { status: connect.body?.instance?.status || connect.body?.status });

    const deadline = Date.now() + config.qrPollMs;
    let lastQr = null;
    while (Date.now() < deadline) {
        lastQr = await checkQrEndpoint(id, ['connecting', 'connected', 'disconnected']);
        if (lastQr?.body?.qrCode || lastQr?.body?.status === 'connected') {
            return;
        }
        await sleep(1500);
    }

    assert(lastQr?.status === 200, 'qr_poll_http', `QR endpoint did not stay healthy; last status ${lastQr?.status}`);
    pass('qr_poll_no_code_yet', { status: lastQr.body?.status, message: lastQr.body?.message });
}

async function checkQrEndpoint(id, allowedStatuses) {
    const response = await api('GET', `/api/instances/${encodeURIComponent(id)}/qr`);
    assert(response.status === 200, 'qr_http', `Expected QR endpoint 200, got ${response.status}`);
    assert(response.body?.success === true, 'qr_shape', 'Invalid QR response');
    assert(allowedStatuses.includes(response.body.status), 'qr_status', `Unexpected QR status ${response.body.status}`);
    pass('qr_endpoint', {
        status: response.body.status,
        hasQrCode: Boolean(response.body.qrCode),
        message: response.body.qrCode ? undefined : response.body.message
    });
    return response;
}

async function checkLogs(id) {
    const response = await api('GET', `/api/instances/${encodeURIComponent(id)}/logs?limit=25`);
    assert(response.status === 200, 'logs_http', `Expected logs 200, got ${response.status}`);
    assert(response.body?.success === true && Array.isArray(response.body.logs), 'logs_shape', 'Invalid logs response');
    pass('logs_endpoint', { count: response.body.logs.length });
}

async function deleteTempInstance(id) {
    const response = await api('DELETE', `/api/instances/${encodeURIComponent(id)}`);
    assert(response.status === 200, 'delete_instance_http', `Expected delete 200, got ${response.status}`);
    assert(response.body?.success === true, 'delete_instance_shape', 'Invalid delete response');
    run.cleanup.push({ id, result: 'deleted' });
    pass('delete_instance', { id });
}

async function deleteInstanceBestEffort(id, reason) {
    if (!id) return;
    try {
        const response = await api('DELETE', `/api/instances/${encodeURIComponent(id)}`);
        if (response.status === 200) {
            run.cleanup.push({ id, result: 'deleted', reason });
            log('info', 'Deleted smoke instance', { id, reason });
        } else if (response.status === 404) {
            run.cleanup.push({ id, result: 'not_found', reason });
        } else {
            run.cleanup.push({ id, result: 'failed', reason, status: response.status });
            log('warn', 'Failed to delete smoke instance', { id, reason, status: response.status });
        }
    } catch (error) {
        run.cleanup.push({ id, result: 'failed', reason, error: error.message });
        log('warn', 'Delete smoke instance threw', { id, reason, error: error.message });
    }
}

async function api(method, endpoint, body) {
    return request(method, endpoint, { body });
}

async function request(method, endpoint, options = {}) {
    return requestUrl(method, `${config.baseUrl}${endpoint}`, options);
}

async function requestUrl(method, url, options = {}) {
    const headers = {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': 'wasup2-smoke/1.0'
    };

    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    if (config.apiKey) {
        headers['X-API-Key'] = config.apiKey;
    } else if (config.publicDashboardMode) {
        const origin = new URL(config.baseUrl).origin;
        headers.Origin = origin;
        headers.Referer = `${origin}/`;
        headers['Sec-Fetch-Site'] = 'same-origin';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
        const response = await fetch(url, {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            redirect: options.redirect || 'follow',
            signal: controller.signal
        });
        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        const shouldParseJson = options.expectJson !== false && /json/i.test(contentType);
        let parsedBody = null;
        if (shouldParseJson && text) {
            try {
                parsedBody = JSON.parse(text);
            } catch (error) {
                if (config.logDebug) {
                    log('warn', 'JSON parse failed', { url: redactUrl(url), error: error.message });
                }
            }
        }

        return {
            status: response.status,
            headers: response.headers,
            body: parsedBody,
            text
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`${method} ${redactUrl(url)} timed out after ${config.timeoutMs}ms`);
        }
        throw new Error(`${method} ${redactUrl(url)} failed: ${error.message}`);
    } finally {
        clearTimeout(timeout);
    }
}

function pass(name, details = {}) {
    run.checks.push({ name, ok: true, details });
    log('pass', name, details);
}

function skip(name, reason) {
    run.checks.push({ name, ok: true, skipped: true, details: { reason } });
    log('skip', name, { reason });
}

function assert(condition, name, message) {
    if (condition) return;
    fail(name, message);
    throw new Error(message);
}

function fail(name, message) {
    run.failures.push({ name, message });
    log('fail', name, { message });
}

function summarizeRun() {
    return {
        runId: run.id,
        ok: run.failures.length === 0,
        checks: run.checks.length,
        failures: run.failures.length,
        cleanup: run.cleanup
    };
}

async function writeStatus() {
    if (!config.writeStatusFile || !config.statusFile) return;
    const status = {
        ok: run.failures.length === 0,
        runId: run.id,
        baseUrl: config.baseUrl,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        checks: run.checks.length,
        failures: run.failures,
        cleanup: run.cleanup,
        realInstances: run.realInstances || null
    };

    try {
        await fs.writeFile(config.statusFile, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o644 });
    } catch (error) {
        log('warn', 'Could not write status file', { path: config.statusFile, error: error.message });
    }
}

async function readPreviousStatus() {
    if (!config.statusFile) return null;
    try {
        const data = await fs.readFile(config.statusFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code !== 'ENOENT' && config.logDebug) {
            log('warn', 'Could not read previous status file', { path: config.statusFile, error: error.message });
        }
        return null;
    }
}

function log(level, message, fields = {}) {
    const cleanFields = sanitize(fields);
    if (Object.prototype.hasOwnProperty.call(cleanFields, 'message')) {
        cleanFields.detailMessage = cleanFields.message;
        delete cleanFields.message;
    }
    const record = {
        ts: new Date().toISOString(),
        level,
        message,
        ...cleanFields
    };
    process.stdout.write(`${JSON.stringify(record)}\n`);
}

function sanitize(value) {
    if (Array.isArray(value)) {
        return value.map(sanitize);
    }
    if (value && typeof value === 'object') {
        const clean = {};
        for (const [key, entry] of Object.entries(value)) {
            if (/api[-_]?key|authorization|token|secret|password/i.test(key)) {
                clean[key] = entry ? '[redacted]' : entry;
            } else {
                clean[key] = sanitize(entry);
            }
        }
        return clean;
    }
    if (typeof value === 'string') {
        return value.replace(/(api[-_]?key|authorization|token|secret|password)=([^&\s]+)/gi, '$1=[redacted]');
    }
    return value;
}

function parseArgs(rawArgs) {
    const parsed = {};
    for (let i = 0; i < rawArgs.length; i += 1) {
        const arg = rawArgs[i];
        if (!arg.startsWith('--')) continue;
        const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
        const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const nextValue = rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--') ? rawArgs[i + 1] : undefined;
        parsed[key] = inlineValue ?? nextValue ?? 'true';
        if (inlineValue === undefined && rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--')) {
            i += 1;
        }
    }
    return parsed;
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback, min) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
}

function parseList(value) {
    if (!value) return [];
    return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function isSmokeInstance(instance) {
    return String(instance?.id || '').startsWith('smoke-');
}

function getConnectionStatus(instance) {
    return String(
        instance?.status ||
        instance?.state ||
        instance?.connectionState ||
        ''
    ).toLowerCase() || 'unknown';
}

async function fetchInstanceLogs(id) {
    try {
        const response = await api('GET', `/api/instances/${encodeURIComponent(id)}/logs?limit=30`);
        if (response.status === 200 && Array.isArray(response.body?.logs)) {
            return { logs: response.body.logs };
        }
        return { logs: [], error: `HTTP ${response.status}` };
    } catch (error) {
        return { logs: [], error: error.message };
    }
}

function getManualRepairReason(instance, logs = []) {
    if (instance?.hasSavedCredentials === false) {
        return 'missing-auth';
    }
    if (instance?.qrCode || instance?.pairingCode) {
        return 'qr-or-pairing-required';
    }

    const textFields = [
        instance?.status,
        instance?.state,
        instance?.connectionState,
        instance?.statusMessage,
        instance?.message,
        instance?.error,
        instance?.lastError,
        instance?.disconnectReason,
        instance?.lastDisconnectReason,
        instance?.reason,
        ...logs.map((entry) => entry?.message)
    ];
    const joined = textFields
        .filter((value) => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    if (/401|logged\s*out|invalid\s*auth|bad\s*session|missing\s*auth|scan\s*qr|pair\s*again/.test(joined)) {
        return 'logged-out-or-invalid-auth';
    }
    return null;
}

function classifyRealInstance(status, hasSavedCredentials, manualRepairReason) {
    if (status === 'connected') return 'connected';
    if (manualRepairReason || hasSavedCredentials === false) return 'manual_qr_required';
    if (hasSavedCredentials === true) return 'credentialed_disconnected';
    return 'auth_unknown_not_connected';
}

function trimTrailingSlash(value) {
    return String(value).replace(/\/+$/, '');
}

function safeLocationHost(location) {
    try {
        const parsed = new URL(location);
        return `${parsed.protocol}//${parsed.host}`;
    } catch (error) {
        return '[invalid-location]';
    }
}

function summarizeError(error) {
    return String(error || '').slice(0, 120);
}

function redactUrl(value) {
    try {
        const parsed = new URL(value);
        parsed.username = '';
        parsed.password = '';
        for (const key of [...parsed.searchParams.keys()]) {
            if (/api[-_]?key|authorization|token|secret|password/i.test(key)) {
                parsed.searchParams.set(key, '[redacted]');
            }
        }
        return parsed.toString();
    } catch (error) {
        return String(value);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

process.once('beforeExit', async () => {
    if (tempInstanceId) {
        await deleteInstanceBestEffort(tempInstanceId, 'before_exit');
    }
});
