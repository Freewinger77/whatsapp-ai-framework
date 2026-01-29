#!/usr/bin/env node
/**
 * Export all WhatsApp credentials from Railway container
 * Run this BEFORE deploying: node export-creds.js > backup.json
 */

const fs = require('fs');
const path = require('path');

const instancesDir = '/app/instances';
const instancesFile = path.join(instancesDir, 'instances.json');

if (!fs.existsSync(instancesFile)) {
    console.error('No instances.json found');
    process.exit(1);
}

const instances = JSON.parse(fs.readFileSync(instancesFile, 'utf8'));
const backup = {
    exportedAt: new Date().toISOString(),
    instances: instances,
    credentials: {}
};

for (const instance of instances) {
    const authDir = path.join(instancesDir, instance.id, 'auth');
    if (fs.existsSync(authDir)) {
        backup.credentials[instance.id] = {};
        const files = fs.readdirSync(authDir);
        for (const file of files) {
            const filePath = path.join(authDir, file);
            if (fs.statSync(filePath).isFile()) {
                backup.credentials[instance.id][file] = fs.readFileSync(filePath, 'utf8');
            }
        }
    }
}

console.log(JSON.stringify(backup));
