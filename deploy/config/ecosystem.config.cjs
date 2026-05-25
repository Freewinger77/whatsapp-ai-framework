/**
 * PM2 — single fork process (do NOT use cluster mode: one Node owns all WhatsApp sockets).
 *
 * wait_ready + process.send('ready') in server.js lets PM2 wait until instances are loaded
 * before considering the app "up". kill_timeout gives gracefulShutdown time to close sockets.
 *
 * Optional VM env (systemd or /etc/environment):
 *   WASUP_SIGHUP_BEHAVIOR_RELOAD=1  → kill -HUP <pid> re-applies behaviorSettings from instances.json
 */
module.exports = {
  apps: [{
    name: 'whatsapp-api',
    script: 'server.js',
    cwd: '/opt/whatsapp-ai/app',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    wait_ready: true,
    listen_timeout: 120000,
    kill_timeout: 60000,
    max_restarts: 15,
    min_uptime: '10s',
    exp_backoff_restart_delay: 2000,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: '/opt/whatsapp-ai/logs/error.log',
    out_file: '/opt/whatsapp-ai/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
