#!/usr/bin/env node
/**
 * Apply descriptive copy + tag text to openapi.yaml
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import {
  ENDPOINT_DESCRIPTIONS,
  INFO_DESCRIPTION,
  TAG_DESCRIPTIONS,
} from './openapi-endpoint-copy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(__dirname, '..', 'openapi.yaml');

const doc = yaml.parse(fs.readFileSync(target, 'utf8'));

doc.info = doc.info || {};
doc.info.description = INFO_DESCRIPTION;

if (Array.isArray(doc.tags)) {
  for (const tag of doc.tags) {
    if (TAG_DESCRIPTIONS[tag.name]) {
      tag.description = TAG_DESCRIPTIONS[tag.name];
    }
  }
}

const methods = ['get', 'post', 'put', 'delete', 'patch'];

for (const [route, item] of Object.entries(doc.paths || {})) {
  for (const method of methods) {
    const op = item?.[method];
    if (!op) continue;
    const key = `${method.toUpperCase()} ${route}`;
    if (ENDPOINT_DESCRIPTIONS[key]) {
      op.description = ENDPOINT_DESCRIPTIONS[key];
    }
  }
}

fs.writeFileSync(target, yaml.stringify(doc, { lineWidth: 0 }));
console.log(`Enriched ${target}`);
