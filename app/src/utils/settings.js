/**
 * Settings Manager for WhatsApp Bot
 *
 * Handles persistent storage of configuration settings:
 * - Anti-ban rate limits
 * - Other configurable options
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../settings.json');

// Default settings
const DEFAULT_SETTINGS = {
    antiBan: {
        preset: 'balanced',
        messagesPerHour: 200,
        messagesPerDay: 5000,
        uniqueChatsPerHour: 50,
        uniqueChatsPerDay: 500
    },
    n8nWebhookUrl: ''
};

let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Load settings from file
 */
async function loadSettings() {
    try {
        if (fsSync.existsSync(SETTINGS_FILE)) {
            const data = await fs.readFile(SETTINGS_FILE, 'utf8');
            const loaded = JSON.parse(data);
            currentSettings = mergeDeep(DEFAULT_SETTINGS, loaded);
            console.log('[Settings] Loaded from file');
        } else {
            // Create default settings file
            await saveSettings();
            console.log('[Settings] Created default settings file');
        }
    } catch (error) {
        console.error('[Settings] Error loading settings:', error.message);
        currentSettings = { ...DEFAULT_SETTINGS };
    }
    return currentSettings;
}

/**
 * Save current settings to file
 */
async function saveSettings() {
    try {
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2));
        console.log('[Settings] Saved to file');
        return true;
    } catch (error) {
        console.error('[Settings] Error saving settings:', error.message);
        return false;
    }
}

/**
 * Get all settings
 */
function getSettings() {
    return { ...currentSettings };
}

/**
 * Get specific setting by path (e.g., 'antiBan.preset')
 */
function getSetting(path) {
    const keys = path.split('.');
    let value = currentSettings;
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return undefined;
        }
    }
    return value;
}

/**
 * Update settings
 * @param {string} section - Settings section (e.g., 'antiBan')
 * @param {Object} updates - New values to merge
 */
async function updateSettings(section, updates) {
    if (section && currentSettings[section]) {
        currentSettings[section] = { ...currentSettings[section], ...updates };
    } else if (!section) {
        currentSettings = mergeDeep(currentSettings, updates);
    }
    await saveSettings();
    return currentSettings;
}

/**
 * Update anti-ban settings specifically
 * @param {Object} updates - { preset?, messagesPerHour?, messagesPerDay?, etc. }
 */
async function updateAntiBanSettings(updates) {
    const { PRESETS } = require('./anti-ban');

    // If a preset is selected, apply preset values
    if (updates.preset && PRESETS[updates.preset]) {
        currentSettings.antiBan = {
            preset: updates.preset,
            ...PRESETS[updates.preset]
        };
    } else if (updates.preset === 'custom') {
        // Custom settings
        currentSettings.antiBan = {
            preset: 'custom',
            messagesPerHour: updates.messagesPerHour || currentSettings.antiBan.messagesPerHour,
            messagesPerDay: updates.messagesPerDay || currentSettings.antiBan.messagesPerDay,
            uniqueChatsPerHour: updates.uniqueChatsPerHour || currentSettings.antiBan.uniqueChatsPerHour,
            uniqueChatsPerDay: updates.uniqueChatsPerDay || currentSettings.antiBan.uniqueChatsPerDay
        };
    } else {
        // Partial update
        currentSettings.antiBan = { ...currentSettings.antiBan, ...updates };
    }

    await saveSettings();
    return currentSettings.antiBan;
}

/**
 * Get anti-ban settings
 */
function getAntiBanSettings() {
    return { ...currentSettings.antiBan };
}

/**
 * Deep merge utility
 */
function mergeDeep(target, source) {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = mergeDeep(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}

module.exports = {
    loadSettings,
    saveSettings,
    getSettings,
    getSetting,
    updateSettings,
    updateAntiBanSettings,
    getAntiBanSettings,
    DEFAULT_SETTINGS
};
